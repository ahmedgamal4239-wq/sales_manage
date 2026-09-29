import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, users, sessions } from "@workspace/db";
import { LoginBody, ChangePasswordBody } from "@workspace/api-zod";
import { requireEmployee, createSession, logoutSession, hashPassword, verifyPassword, publicUser } from "../lib/ops-auth";

const router: IRouter = Router();
const failures = new Map<string,{count:number;until:number}>();
router.post("/auth/login", async (req,res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"Employee ID and password required"}); return; }
  const key = `${req.ip}:${parsed.data.employeeId}`;
  const attempt = failures.get(key);
  if (attempt && attempt.count >= 8 && attempt.until > Date.now()) { res.status(429).json({error:"Too many attempts. Try later."}); return; }
  const [user] = await db.select().from(users).where(eq(users.employeeId,parsed.data.employeeId));
  const valid = await verifyPassword(parsed.data.password,user?.passwordHash ?? null);
  if (!user || !valid || !user.active || user.role === "PENDING") {
    failures.set(key,{count:(attempt?.until && attempt.until > Date.now() ? attempt.count : 0)+1,until:Date.now()+15*60000});
    res.status(401).json({error:"Invalid credentials"}); return;
  }
  failures.delete(key);
  await createSession(res,user);
  res.json(publicUser(user));
});
router.post("/auth/mobile-login", async (req,res): Promise<void> => {
  const parsed=LoginBody.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error:"Employee ID and password required"});return;}
  const key=`${req.ip}:${parsed.data.employeeId}`;
  const attempt=failures.get(key);
  if (attempt && attempt.count>=8 && attempt.until>Date.now()) {res.status(429).json({error:"Too many attempts. Try later."});return;}
  const [user]=await db.select().from(users).where(eq(users.employeeId,parsed.data.employeeId));
  if (!user || !(await verifyPassword(parsed.data.password,user.passwordHash)) || !user.active || user.role==="PENDING") {
    failures.set(key,{count:(attempt?.until && attempt.until>Date.now()?attempt.count:0)+1,until:Date.now()+15*60000});
    res.status(401).json({error:"Invalid credentials"});return;
  }
  failures.delete(key);
  const token=await createSession(res,user,false);
  res.json({user:publicUser(user),token});
});
router.post("/auth/logout", async (req,res): Promise<void> => {
  await logoutSession(req,res);
  res.json({message:"Signed out"});
});
router.get("/auth/me", async (req,res): Promise<void> => {
  const user = await requireEmployee(req,res,true);
  if (user) res.json(publicUser(user));
});
router.post("/auth/password", async (req,res): Promise<void> => {
  const user = await requireEmployee(req,res,true);
  if (!user) return;
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success || !(await verifyPassword(parsed.data.currentPassword,user.passwordHash))) {
    res.status(400).json({error:"Invalid password change"}); return;
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) { res.status(400).json({error:"Choose a different password"}); return; }
  await db.update(users).set({passwordHash:await hashPassword(parsed.data.newPassword),mustChangePassword:false,sessionVersion:user.sessionVersion+1}).where(eq(users.id,user.id));
  await db.delete(sessions).where(eq(sessions.userId,user.id));
  await logoutSession(req,res);
  res.json({message:"Password updated. Please sign in again."});
});
export default router;