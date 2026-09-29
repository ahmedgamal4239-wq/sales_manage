import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { db, pool, users } from "@workspace/db";
import { eq } from "drizzle-orm";

const scrypt = promisify(scryptCallback);
async function main() {
  const id=process.env.BOOTSTRAP_MANAGER_ID?.trim();
  const password=process.env.BOOTSTRAP_MANAGER_PASSWORD;
  const name=process.env.BOOTSTRAP_MANAGER_NAME?.trim() || "Higher Management";
  if (!id || !password || password.length<12) throw new Error("Set BOOTSTRAP_MANAGER_ID and a BOOTSTRAP_MANAGER_PASSWORD of at least 12 characters in workspace Secrets.");
  await db.transaction(async tx=>{
    const existingManagers=await tx.select({id:users.id}).from(users).where(eq(users.role,"HIGHER_MANAGEMENT"));
    if (existingManagers.length) throw new Error("A higher-management account already exists; bootstrap cannot run twice.");
    const salt=randomBytes(16).toString("hex");
    const hash=(await scrypt(password,salt,64) as Buffer).toString("hex");
    const [existing]=await tx.select().from(users).where(eq(users.employeeId,id));
    if (existing && (existing.role!=="PENDING" || existing.passwordHash || existing.active)) throw new Error("This employee ID is already configured");
    if (existing) await tx.update(users).set({role:"HIGHER_MANAGEMENT",active:true,passwordHash:`${salt}:${hash}`,mustChangePassword:true}).where(eq(users.id,existing.id));
    else await tx.insert(users).values({employeeId:id,nameAr:name,role:"HIGHER_MANAGEMENT",active:true,passwordHash:`${salt}:${hash}`,mustChangePassword:true});
  });
  process.stdout.write("First higher-management account created. Sign in and change the temporary password.\n");
}
main().catch(e=>{process.stderr.write(`${e instanceof Error?e.message:"Bootstrap failed"}\n`);process.exitCode=1}).finally(()=>pool.end());