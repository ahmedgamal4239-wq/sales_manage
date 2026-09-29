import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import multer from "multer";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  audit,
  db,
  importBatches,
  products,
  users,
} from "@workspace/db";
import {
  publicUser,
  hasPermission,
  requirePermission,
  requireEmployee,
  scopedAttendance,
  scopedBranches,
  scopedCustomers,
  scopedSales,
} from "../lib/ops-auth";

type Employee = NonNullable<Awaited<ReturnType<typeof requireEmployee>>>;
type ImportKind = "products" | "users";
function canManageImport(employee: Employee, kind: ImportKind): boolean {
  return hasPermission(employee,"imports.manage") &&
    hasPermission(employee,kind === "users" ? "users.manage" : "products.manage");
}
type ImportRow = {
  code: string;
  name: string;
  nameEn?: string;
  price?: string;
  change: string;
};

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function normalizedHeader(value: ExcelJS.CellValue): string {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value && typeof value === "object" && "text" in value) {
    return String(value.text ?? "").trim();
  }
  if (value && typeof value === "object" && "result" in value) {
    return String(value.result ?? "").trim();
  }
  return String(value ?? "").trim();
}

function rowValue(
  row: ExcelJS.Row,
  columns: Map<string, number>,
  ...names: string[]
): string {
  const index = names.map((name) => columns.get(name)).find((value) => value !== undefined);
  return index === undefined ? "" : cellText(row.getCell(index).value);
}

async function getEmployee(req: Parameters<typeof requireEmployee>[0], res: Parameters<typeof requireEmployee>[1]): Promise<Employee | null> {
  return await requireEmployee(req, res);
}

function asRecords<T extends object>(rows: T[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row)));
}
function duplicateEmployeeId(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}

function uploadXlsx(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "XLSX upload exceeds the 5 MB limit" });
      return;
    }
    if (error) {
      res.status(400).json({ error: "Unable to process uploaded file" });
      return;
    }
    next();
  });
}

router.post(
  "/imports/preview",
  uploadXlsx,
  async (req, res): Promise<void> => {
    const employee = await getEmployee(req, res);
    if (!employee) return;
    if (!requirePermission(employee,"imports.manage",res)) {
      return;
    }
    const kind = req.body?.kind as ImportKind | undefined;
    if (kind !== "products" && kind !== "users") {
      res.status(400).json({ error: "kind must be products or users" });
      return;
    }
    if (!canManageImport(employee,kind)) {
      res.status(403).json({ error: "Not permitted" });
      return;
    }
    if (!req.file || !req.file.originalname.toLowerCase().endsWith(".xlsx")) {
      res.status(400).json({ error: "An .xlsx file is required" });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(req.file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      res.status(400).json({ error: "The uploaded file is not a valid XLSX workbook" });
      return;
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      res.status(400).json({ error: "Workbook must contain a worksheet" });
      return;
    }

    const headerRow = sheet.getRow(1);
    const columns = new Map<string, number>();
    headerRow.eachCell((cell, column) => {
      const header = normalizedHeader(cell.value);
      if (header) columns.set(header, column);
    });
    const required = kind === "products"
      ? [["code","كودصنف"], ["namear", "name","اسمالصنف"], ["price","السعر"]]
      : [["employeeid", "code","كوداساسية"], ["namear", "name","اسماساسية"]];
    if (required.some((alternatives) => !alternatives.some((name) => columns.has(name)))) {
      res.status(400).json({
        error: kind === "products"
          ? "Worksheet headers must include code, nameAr (or name), and price"
          : "Worksheet headers must include employeeId (or code) and nameAr (or name)",
      });
      return;
    }

    const rows: ImportRow[] = [];
    const seen = new Set<string>();
    for (let index = 2; index <= sheet.rowCount; index += 1) {
      const row = sheet.getRow(index);
      const code = rowValue(row, columns, kind === "users" ? "employeeid" : "كودصنف", "code", kind === "users" ? "كوداساسية" : "كودصنف").trim();
      const name = rowValue(row, columns, "namear", "name", kind === "users" ? "اسماساسية" : "اسمالصنف").trim();
      const nameEn = rowValue(row, columns, "nameen","enname");
      const price = rowValue(row, columns, "price","السعر");
      if (!code && !name && !price && !nameEn) continue;
      if (!code || !name) {
        res.status(400).json({ error: `Row ${index} must include an identifier and name` });
        return;
      }
      if (seen.has(code)) {
        res.status(400).json({ error: `Duplicate identifier "${code}" in worksheet` });
        return;
      }
      seen.add(code);
      if (kind === "products") {
        const parsedPrice = Number(price);
        if (!price || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
          res.status(400).json({ error: `Row ${index} has an invalid or negative price` });
          return;
        }
      }
      rows.push({
        code,
        name,
        ...(nameEn ? { nameEn } : {}),
        ...(kind === "products" ? { price: Number(price).toFixed(2) } : {}),
        change: "new",
      });
    }
    if (rows.length === 0) {
      res.status(400).json({ error: "Worksheet contains no import rows" });
      return;
    }

    const identifiers = rows.map((row) => row.code);
    const existing = kind === "products"
      ? await db.select({ code: products.code }).from(products).where(inArray(products.code, identifiers))
      : await db.select({ code: users.employeeId }).from(users).where(inArray(users.employeeId, identifiers));
    const existingCodes = new Set(existing.map((row) => row.code));
    for (const row of rows) row.change = existingCodes.has(row.code) ? "update" : "new";

    const token = randomUUID();
    await db.insert(importBatches).values({
      token,
      kind,
      sheet: sheet.name,
      filename: req.file.originalname,
      actorId: employee.id,
      rows,
    });
    const newCount = rows.filter((row) => row.change === "new").length;
    res.json({
      token,
      sheet: sheet.name,
      total: rows.length,
      newCount,
      updateCount: rows.length - newCount,
      rows,
    });
  },
);

router.post("/imports/confirm", async (req, res): Promise<void> => {
  const employee = await getEmployee(req, res);
  if (!employee) return;
  if (!requirePermission(employee,"imports.manage",res)) return;
  const token = req.body?.token;
  if (typeof token !== "string" || !token.trim()) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  let outcome:
    | {status:"missing"}
    | {status:"actor"}
    | {status:"confirmed"}
    | {status:"permission"}
    | {status:"ok";created:number;updated:number};
  try {
  outcome = await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(eq(importBatches.token, token))
      .for("update");
    if (!batch) return { status: "missing" as const };
    if (batch.actorId !== employee.id) return { status: "actor" as const };
    if (batch.confirmedAt) return { status: "confirmed" as const };
    if ((batch.kind !== "products" && batch.kind !== "users") || !canManageImport(employee,batch.kind)) return {status:"permission" as const};

    let created = 0;
    let updated = 0;
    for (const row of batch.rows as ImportRow[]) {
      if (batch.kind === "products") {
        const [existing] = await tx.select({ id: products.id }).from(products).where(eq(products.code, row.code));
        if (existing) {
          await tx.update(products).set({
            nameAr: row.name,
            nameEn: row.nameEn ?? null,
            price: row.price ?? "0",
            priceReview: row.price === "0.00",
          }).where(eq(products.id, existing.id));
          updated += 1;
        } else {
          await tx.insert(products).values({
            code: row.code,
            nameAr: row.name,
            nameEn: row.nameEn ?? null,
            price: row.price ?? "0",
            priceReview: row.price === "0.00",
          });
          created += 1;
        }
      } else if (batch.kind === "users") {
        const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.employeeId, row.code));
        if (existing) {
          await tx.update(users).set({
            nameAr: row.name,
            nameEn: row.nameEn ?? null,
          }).where(eq(users.id, existing.id));
          updated += 1;
        } else {
          await tx.insert(users).values({
            employeeId: row.code,
            nameAr: row.name,
            nameEn: row.nameEn ?? null,
            role: "PENDING",
            active: false,
            passwordHash: null,
            mustChangePassword: true,
          });
          created += 1;
        }
      }
    }
    await tx.update(importBatches)
      .set({ confirmedAt: new Date() })
      .where(and(eq(importBatches.token, token), isNull(importBatches.confirmedAt)));
    await tx.insert(audit).values({
      actorId: employee.id,
      action: "IMPORT_CONFIRMED",
      target: `${batch.kind}:${batch.token}`,
    });
    return { status: "ok" as const, created, updated };
  });
  } catch (error) {
    if (duplicateEmployeeId(error)) {res.status(409).json({error:"Employee ID already exists"});return;}
    throw error;
  }

  if (outcome.status === "missing") {
    res.status(404).json({ error: "Import batch not found" });
    return;
  }
  if (outcome.status === "actor") {
    res.status(403).json({ error: "Import batch belongs to another employee" });
    return;
  }
  if (outcome.status === "confirmed") {
    res.status(409).json({ error: "Import batch has already been confirmed" });
    return;
  }
  if (outcome.status === "permission") {
    res.status(403).json({error:"Not permitted"});
    return;
  }
  res.json({ created: outcome.created, updated: outcome.updated });
});

router.get("/exports/:kind", async (req, res): Promise<void> => {
  const employee = await getEmployee(req, res);
  if (!employee) return;
  const kind = Array.isArray(req.params.kind) ? req.params.kind[0] : req.params.kind;
  const allowed = ["users", "customers", "products", "branches", "sales", "attendance"];
  if (!allowed.includes(kind)) {
    res.status(400).json({ error: "Unsupported export kind" });
    return;
  }
  if (!requirePermission(employee,"exports.view",res)) return;
  const permissionByKind = {
    users:"users.view", customers:"customers.view", products:"products.view",
    branches:"branches.view", sales:"sales.view", attendance:"attendance.view",
  } as const;
  if (!requirePermission(employee,permissionByKind[kind as keyof typeof permissionByKind],res)) return;

  let records: Record<string, unknown>[];
  switch (kind) {
    case "users":
      records = asRecords((await db.select().from(users)).map(publicUser));
      break;
    case "customers":
      records = asRecords(await scopedCustomers(employee));
      break;
    case "products":
      records = asRecords(await db.select().from(products));
      break;
    case "branches":
      records = asRecords(await scopedBranches(employee));
      break;
    case "sales":
      records = asRecords(await scopedSales(employee));
      break;
    default:
      records = asRecords((await scopedAttendance(employee)).map(({latitude: _lat,longitude: _lon,accuracy: _accuracy,capturedAt: _capturedAt,...record})=>record));
      break;
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(kind);
  if (records.length > 0) {
    const keys = Object.keys(records[0]);
    worksheet.columns = keys.map((key) => ({ header: key, key, width: Math.min(Math.max(key.length + 4, 14), 32) }));
    worksheet.addRows(records.map(record => Object.fromEntries(Object.entries(record).map(([key,value]) => [key, typeof value === "object" && value !== null ? JSON.stringify(value) : value]))));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  res
    .status(200)
    .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .setHeader("Content-Disposition", `attachment; filename="${kind}.xlsx"`)
    .send(Buffer.from(buffer));
});

export default router;