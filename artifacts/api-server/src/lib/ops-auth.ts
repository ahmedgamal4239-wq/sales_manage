import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, users, sessions, customers, branches, sales, attendance } from "@workspace/db";

const scrypt = promisify(scryptCallback);
const cookieName = "ops_session";
export type User = typeof users.$inferSelect;
export const PERMISSIONS = [
  "dashboard.view", "users.view", "users.manage", "customers.view", "customers.manage",
  "branches.view", "branches.manage", "products.view", "products.manage", "imports.manage",
  "exports.view", "sales.view", "sales.write", "attendance.view", "attendance.write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const ROLE_DEFAULTS: Record<string, readonly Permission[]> = {
  HIGHER_MANAGEMENT: PERMISSIONS,
  AREA_MANAGER: ["dashboard.view", "customers.view", "customers.manage", "branches.view", "sales.view", "attendance.view", "exports.view"],
  RETAIL_AGENT: ["dashboard.view", "customers.view", "customers.manage", "sales.view"],
  HYPER_AGENT: ["dashboard.view", "branches.view", "sales.view", "attendance.view", "exports.view"],
  HYPER_SELLER: ["dashboard.view", "branches.view", "products.view", "sales.view", "sales.write", "attendance.view", "attendance.write"],
  WAREHOUSE: ["dashboard.view", "products.view", "products.manage"],
  PENDING: [],
};
export const isManager = (user: User) => user.role === "HIGHER_MANAGEMENT";
export function permissionsForRole(role: string, permissions: readonly string[] | null | undefined): Permission[] {
  const ceiling = new Set(ROLE_DEFAULTS[role] ?? []);
  return (permissions == null ? [...ceiling] : permissions.filter((value): value is Permission =>
    (PERMISSIONS as readonly string[]).includes(value),
  )).filter((permission) => ceiling.has(permission));
}
export function effectivePermissions(user: User): Permission[] {
  return permissionsForRole(user.role,user.permissions);
}
export function permissionsWithinRoleCeiling(role: string, permissions: readonly string[] | null | undefined): boolean {
  const ceiling = ROLE_DEFAULTS[role];
  if (!ceiling) return permissions == null || permissions.length === 0;
  if (permissions == null) return true;
  const allowed = new Set(ceiling);
  return permissions.every((permission) =>
    (PERMISSIONS as readonly string[]).includes(permission) && allowed.has(permission as Permission),
  );
}
export function permissionSetHasMatchingViews(role: string, permissions: readonly string[] | null | undefined): boolean {
  const ceiling = new Set(ROLE_DEFAULTS[role] ?? []);
  const selected = permissions == null
    ? [...ceiling]
    : permissions.filter((permission): permission is Permission =>
      (PERMISSIONS as readonly string[]).includes(permission) && ceiling.has(permission as Permission),
    );
  const effective = new Set(selected);
  return (
    (!effective.has("users.manage") || effective.has("users.view")) &&
    (!effective.has("customers.manage") || effective.has("customers.view")) &&
    (!effective.has("branches.manage") || effective.has("branches.view")) &&
    (!effective.has("products.manage") || effective.has("products.view")) &&
    (!effective.has("sales.write") || effective.has("sales.view")) &&
    (!effective.has("attendance.write") || effective.has("attendance.view"))
  );
}
export function hasPermission(user: User, permission: Permission): boolean {
  return effectivePermissions(user).includes(permission);
}
export function requirePermission(user: User, permission: Permission, res: Response): boolean {
  if (hasPermission(user, permission)) return true;
  res.status(403).json({error:"Not permitted"}); return false;
}
export const publicUser = ({passwordHash: _passwordHash, sessionVersion: _sessionVersion, ...user}: User) => ({
  ...user,
  effectivePermissions: effectivePermissions(user as User),
});
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string | null) {
  if (!stored) return false;
  const [salt, encoded] = stored.split(":");
  if (!salt || !encoded || encoded.length !== 128) return false;
  const expected = Buffer.from(encoded, "hex");
  const actual = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(expected, actual);
}
export async function createSession(res: Response, user: User, setCookie = true) {
  const token = randomBytes(32).toString("hex");
  await db.insert(sessions).values({
    tokenHash: tokenHash(token), userId: user.id, version: user.sessionVersion,
    expiresAt: new Date(Date.now() + 7 * 86400000),
  });
  if (setCookie) res.cookie(cookieName, token, {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 86400000, path: "/api",
  });
  return token;
}
export async function logoutSession(req: Request, res: Response) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : req.cookies?.[cookieName];
  if (typeof token === "string" && /^[0-9a-f]{64}$/.test(token)) await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  res.clearCookie(cookieName, {path:"/api", sameSite:"strict", secure:process.env.NODE_ENV === "production"});
}
export async function requireEmployee(req: Request, res: Response, allowPasswordChange = false): Promise<User | null> {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : req.cookies?.[cookieName];
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    res.status(401).json({error:"Authentication required"}); return null;
  }
  const [record] = await db.select({session:sessions, user:users}).from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())));
  if (!record || !record.user.active || record.user.role === "PENDING" || record.user.sessionVersion !== record.session.version) {
    res.status(401).json({error:"Authentication required"}); return null;
  }
  if (!allowPasswordChange && record.user.mustChangePassword) {
    res.status(403).json({error:"Change your password before continuing"}); return null;
  }
  return record.user;
}
export function requireManager(user: User, res: Response): boolean {
  if (isManager(user)) return true;
  res.status(403).json({error:"Not permitted"}); return false;
}
export async function scopedCustomers(user: User) {
  if (isManager(user)) return db.select().from(customers).orderBy(customers.id);
  return db.select().from(customers).where(eq(customers.ownerId,user.id)).orderBy(customers.id);
}
export async function scopedBranches(user: User) {
  if (isManager(user)) return db.select().from(branches).orderBy(branches.id);
  if (user.role === "HYPER_AGENT") return db.select().from(branches).where(eq(branches.agentId,user.id)).orderBy(branches.id);
  if (user.role === "HYPER_SELLER" && user.branchId) return db.select().from(branches).where(eq(branches.id,user.branchId)).orderBy(branches.id);
  if (user.role === "AREA_MANAGER" && user.areaId) return db.select().from(branches).where(eq(branches.areaId,user.areaId)).orderBy(branches.id);
  return [];
}
export async function scopedSales(user: User) {
  if (isManager(user)) return db.select().from(sales).orderBy(sales.id);
  if (user.role === "HYPER_SELLER") return db.select().from(sales).where(eq(sales.sellerId,user.id)).orderBy(sales.id);
  const permitted = new Set((await scopedBranches(user)).map(x=>x.id));
  return (await db.select().from(sales).orderBy(sales.id)).filter(x=>permitted.has(x.branchId));
}
export async function scopedAttendance(user: User) {
  if (isManager(user)) return db.select().from(attendance).orderBy(attendance.id);
  if (user.role === "HYPER_SELLER") return db.select().from(attendance).where(eq(attendance.sellerId,user.id)).orderBy(attendance.id);
  const permitted = new Set((await scopedBranches(user)).map(x=>x.id));
  return (await db.select().from(attendance).orderBy(attendance.id)).filter(x=>permitted.has(x.branchId));
}