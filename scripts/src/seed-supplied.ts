import ExcelJS from "exceljs";
import { db, pool, products, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../.local/conversation-workspace/files/attached_assets/", import.meta.url));
const productFile = `${dir}/22_1790634054412.xlsx`;
const employeeFile = `${dir}/مندوبين_1790634054413.xlsx`;
const text = (value: ExcelJS.CellValue) => String(value ?? "").trim();

async function main() {
  const productBook = new ExcelJS.Workbook();
  const employeeBook = new ExcelJS.Workbook();
  await productBook.xlsx.readFile(productFile);
  await employeeBook.xlsx.readFile(employeeFile);
  const productSheet = productBook.getWorksheet("22");
  const employeeSheet = employeeBook.worksheets[0];
  if (!productSheet || !employeeSheet) throw new Error("Expected worksheets not found");
  if (["كود_صنف","اسم_الصنف","السعر"].some((h,i)=>text(productSheet.getRow(1).getCell(i+1).value)!==h)) throw new Error("Unexpected product headers");
  if (["كود_اساسية","اسم_اساسية","en_name"].some((h,i)=>text(employeeSheet.getRow(1).getCell(i+1).value)!==h)) throw new Error("Unexpected employee headers");
  const productRows: {code:string;nameAr:string;price:string}[] = [];
  const employeeRows: {employeeId:string;nameAr:string;nameEn:string|null}[] = [];
  const productCodes = new Set<string>(), employeeCodes = new Set<string>();
  productSheet.eachRow((r,i)=>{
    if (i===1) return;
    const code=text(r.getCell(1).value),nameAr=text(r.getCell(2).value),price=Number(r.getCell(3).value);
    if (!code || !nameAr || !Number.isFinite(price) || price<0 || productCodes.has(code)) throw new Error(`Invalid product row ${i}`);
    productCodes.add(code);productRows.push({code,nameAr,price:price.toFixed(2)});
  });
  employeeSheet.eachRow((r,i)=>{
    if (i===1) return;
    const employeeId=text(r.getCell(1).value), nameAr=text(r.getCell(2).value),nameEn=text(r.getCell(3).value)||null;
    if (!employeeId || !nameAr || employeeCodes.has(employeeId)) throw new Error(`Invalid employee row ${i}`);
    employeeCodes.add(employeeId);employeeRows.push({employeeId,nameAr,nameEn});
  });
  if (productRows.length!==310 || employeeRows.length!==53) throw new Error("Unexpected count in supplied source files");
  await db.transaction(async tx=>{
    for (const row of productRows) {
      await tx.insert(products).values({...row,priceReview:Number(row.price)===0}).onConflictDoUpdate({
        target:products.code,set:{nameAr:row.nameAr,price:row.price,priceReview:Number(row.price)===0},
      });
    }
    for (const row of employeeRows) {
      await tx.insert(users).values({...row,role:"PENDING",active:false,passwordHash:null}).onConflictDoUpdate({
        target:users.employeeId,set:{nameAr:row.nameAr,nameEn:row.nameEn},
      });
    }
  });
  const [zero] = await db.select().from(products).where(eq(products.code,"38021"));
  if (!zero || !zero.priceReview || Number(zero.price)!==0) throw new Error("Zero-price product review flag missing");
  process.stdout.write(`Imported ${productRows.length} product rows and ${employeeRows.length} pending employee rows. No accounts activated.\n`);
}
main().catch(e=>{process.stderr.write(`${e instanceof Error?e.message:"Import failed"}\n`);process.exitCode=1}).finally(()=>pool.end());