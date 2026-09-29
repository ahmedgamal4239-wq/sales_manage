import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, attendance, products, sales } from "@workspace/db";
import {
  ListAttendanceResponse,
  ListSalesResponse,
  PunchAttendanceBody,
  PunchAttendanceResponse,
  SaveSalesBody,
  SaveSalesResponse,
} from "@workspace/api-zod";
import {
  requireEmployee,
  requirePermission,
  scopedAttendance,
  scopedBranches,
  scopedSales,
} from "../lib/ops-auth";

const router: IRouter = Router();

function localDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Invalid branch timezone");
  return `${year}-${month}-${day}`;
}

function cents(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function money(value: number): string {
  return (value / 100).toFixed(2);
}

function haversineMeters(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = radians(latitude2 - latitude1);
  const deltaLongitude = radians(longitude2 - longitude1);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(latitude1)) *
      Math.cos(radians(latitude2)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

router.get("/sales", async (req, res): Promise<void> => {
  const user = await requireEmployee(req, res);
  if (!user || !requirePermission(user,"sales.view",res)) return;

  const [reports, scopedRows] = await Promise.all([
    db.select().from(sales).orderBy(desc(sales.businessDate), desc(sales.id)),
    scopedSales(user),
  ]);
  const allowedIds = new Set(scopedRows.map((row) => row.id));
  res.json(ListSalesResponse.parse(reports.filter((report) => allowedIds.has(report.id))));
});

router.post("/sales", async (req, res): Promise<void> => {
  const user = await requireEmployee(req, res);
  if (!user || !requirePermission(user,"sales.write",res)) return;

  const parsed = SaveSalesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const input = parsed.data;
  if (user.role !== "HYPER_SELLER") {
    res.status(403).json({ error: "Seller role required" });
    return;
  }
  if (!user.branchId || user.branchId !== input.branchId) {
    res.status(403).json({ error: "Sales can only be recorded for your assigned branch" });
    return;
  }
  const branchRows = await scopedBranches(user);
  const branch = branchRows.find((row) => row.id === input.branchId);
  if (!branch) {
    res.status(403).json({ error: "Branch is not within your authorized scope" });
    return;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) {
    res.status(400).json({ error: "businessDate must be a valid YYYY-MM-DD date" });
    return;
  }
  const date = new Date(`${input.businessDate}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.businessDate
  ) {
    res.status(400).json({ error: "businessDate must be a valid YYYY-MM-DD date" });
    return;
  }
  let branchDate: string;
  try {
    branchDate = localDateInTimezone(new Date(), branch.timezone);
  } catch {
    res.status(500).json({ error: "Branch timezone is invalid" });
    return;
  }
  if (input.businessDate !== branchDate) {
    res.status(400).json({ error: "businessDate must be today's date in the branch timezone" });
    return;
  }
  if (input.submitted && input.lines.length === 0) {
    res.status(400).json({ error: "A submitted sales report must contain at least one line" });
    return;
  }

  const productIds = input.lines.map((line) => line.productId);
  if (new Set(productIds).size !== productIds.length) {
    res.status(400).json({ error: "A product may appear only once in a sales report" });
    return;
  }
  let grossCents = 0;
  let returnsCents = 0;
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      res.status(400).json({ error: "Each product quantity must be a positive integer" });
      return;
    }
    const amount = cents(line.amount);
    const returned = cents(line.returns);
    if (amount === null || returned === null || returned > amount) {
      res.status(400).json({ error: "Line amounts and returns must be valid nonnegative monetary values, with returns no greater than amount" });
      return;
    }
    grossCents += amount;
    returnsCents += returned;
    if (!Number.isSafeInteger(grossCents) || !Number.isSafeInteger(returnsCents)) {
      res.status(400).json({ error: "Sales report totals are too large" });
      return;
    }
  }
  if (productIds.length > 0) {
    const activeProducts = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.active, true), inArray(products.id, productIds)));
    const activeIds = new Set(activeProducts.map((product) => product.id));
    if (productIds.some((id) => !activeIds.has(id))) {
      res.status(400).json({ error: "Every sales line must reference an active product" });
      return;
    }
  }

  const reportValues = {
    sellerId: user.id,
    branchId: input.branchId,
    businessDate: input.businessDate,
    status: input.submitted ? "SUBMITTED" : "DRAFT",
    gross: money(grossCents),
    returns: money(returnsCents),
    net: money(grossCents - returnsCents),
    lines: input.lines.map((line) => ({
      ...line,
      amount: money(cents(line.amount)!),
      returns: money(cents(line.returns)!),
    })),
    notes: input.notes ?? null,
    updatedAt: new Date(),
  };

  try {
    const report = await db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(sales)
        .where(and(
          eq(sales.sellerId, user.id),
          eq(sales.branchId, input.branchId),
          eq(sales.businessDate, input.businessDate),
        ))
        .for("update")
        .limit(1);
      if (existing?.status === "SUBMITTED") {
        return { error: "This sales report has already been submitted" as const };
      }
      if (existing) {
        const [updated] = await transaction
          .update(sales)
          .set(reportValues)
          .where(eq(sales.id, existing.id))
          .returning();
        return { report: updated };
      }
      const [created] = await transaction.insert(sales).values(reportValues).returning();
      return { report: created };
    });
    if ("error" in report) {
      res.status(409).json({ error: report.error });
      return;
    }
    res.status(201).json(SaveSalesResponse.parse(report.report));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "A sales report already exists for this date" });
      return;
    }
    throw error;
  }
});

router.get("/attendance", async (req, res): Promise<void> => {
  const user = await requireEmployee(req, res);
  if (!user || !requirePermission(user,"attendance.view",res)) return;

  const punches = await db
    .select({
      id: attendance.id,
      sellerId: attendance.sellerId,
      branchId: attendance.branchId,
      type: attendance.type,
      status: attendance.status,
      receivedAt: attendance.receivedAt,
      distanceMeters: attendance.distanceMeters,
    })
    .from(attendance)
    .orderBy(desc(attendance.receivedAt));
  const scopedRows = await scopedAttendance(user);
  const allowedIds = new Set(scopedRows.map((row) => row.id));
  res.json(ListAttendanceResponse.parse(
    punches
      .filter((punch) => allowedIds.has(punch.id))
      .map((punch) => ({
        ...punch,
        receivedAt: punch.receivedAt.toISOString(),
      })),
  ));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const user = await requireEmployee(req, res);
  if (!user || !requirePermission(user,"attendance.write",res)) return;

  const parsed = PunchAttendanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (user.role !== "HYPER_SELLER") {
    res.status(403).json({ error: "Seller role required" });
    return;
  }
  if (!user.branchId || user.branchId !== input.branchId) {
    res.status(403).json({ error: "Attendance can only be recorded for your assigned branch" });
    return;
  }
  const branchRows = await scopedBranches(user);
  const branch = branchRows.find((row) => row.id === input.branchId);
  if (!branch) {
    res.status(403).json({ error: "Branch is not within your authorized scope" });
    return;
  }

  const now = new Date();
  const capturedAtDate = new Date(input.capturedAt);
  const capturedAtValid =
    !Number.isNaN(capturedAtDate.getTime()) &&
    Math.abs(now.getTime() - capturedAtDate.getTime()) <= 120_000;
  const coordinatesValid =
    Number.isFinite(input.latitude) &&
    input.latitude >= -90 &&
    input.latitude <= 90 &&
    Number.isFinite(input.longitude) &&
    input.longitude >= -180 &&
    input.longitude <= 180;
  const accuracyValid = Number.isFinite(input.accuracy) && input.accuracy >= 0 && input.accuracy <= 100;
  const hasGeofence =
    branch.latitude !== null &&
    branch.longitude !== null &&
    Number.isFinite(branch.latitude) &&
    Number.isFinite(branch.longitude);
  const distanceMeters =
    hasGeofence && coordinatesValid
      ? Math.round(haversineMeters(
          input.latitude,
          input.longitude,
          branch.latitude!,
          branch.longitude!,
        ))
      : null;

  const [lastValidPunch] = await db
    .select({ type: attendance.type })
    .from(attendance)
    .where(and(
      eq(attendance.sellerId, user.id),
      eq(attendance.branchId, input.branchId),
      eq(attendance.status, "VALID"),
    ))
    .orderBy(desc(attendance.receivedAt))
    .limit(1);
  const sessionValid = input.type === "IN"
    ? lastValidPunch?.type !== "IN"
    : lastValidPunch?.type === "IN";
  const geofenceValid =
    distanceMeters !== null && distanceMeters <= branch.radiusMeters;
  const status =
    capturedAtValid &&
    coordinatesValid &&
    accuracyValid &&
    geofenceValid &&
    sessionValid
      ? "VALID"
      : "EXCEPTION";
  const [punch] = await db
    .insert(attendance)
    .values({
      sellerId: user.id,
      branchId: input.branchId,
      type: input.type,
      status,
      capturedAt: Number.isNaN(capturedAtDate.getTime()) ? now : capturedAtDate,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      distanceMeters,
    })
    .returning({
      id: attendance.id,
      sellerId: attendance.sellerId,
      branchId: attendance.branchId,
      type: attendance.type,
      status: attendance.status,
      receivedAt: attendance.receivedAt,
      distanceMeters: attendance.distanceMeters,
    });
  res.status(201).json(PunchAttendanceResponse.parse({
    ...punch,
    receivedAt: punch.receivedAt.toISOString(),
  }));
});

export default router;