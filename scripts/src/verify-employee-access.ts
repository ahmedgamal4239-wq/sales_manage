import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { audit, branches, db, sessions, users } from "@workspace/db";

// Development-only API regression check. Creates isolated temporary accounts and always
// removes them, so it does not depend on or expose the real first-manager credentials.
const scrypt = promisify(scryptCallback);
const base = "http://localhost:80/api";
const tag = `verify-${randomBytes(7).toString("hex")}`;
const password = `Temp-${randomBytes(18).toString("hex")}`;
const nextPassword = `Next-${randomBytes(18).toString("hex")}`;
const insertedUsers: number[] = [];
const insertedBranches: number[] = [];
let managerId = 0;

async function request(path: string, method = "GET", body?: unknown, token?: string) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : {"content-type": "application/json"}),
      ...(token ? {authorization: `Bearer ${token}`} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  return {status: response.status, data};
}

async function login(employeeId: string, secret: string) {
  const result = await request("/auth/mobile-login", "POST", {employeeId, password: secret});
  assert.equal(result.status, 200, `login: ${JSON.stringify(result.data)}`);
  return result.data.token as string;
}

async function check() {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64) as Buffer).toString("hex");
  const [manager] = await db.insert(users).values({
    employeeId: `${tag}-manager`, nameAr: "مدير اختبار الصلاحيات",
    role: "HIGHER_MANAGEMENT", active: true, mustChangePassword: false,
    passwordHash: `${salt}:${hash}`, permissions: null,
  }).returning();
  managerId = manager.id;
  insertedUsers.push(managerId);
  const managerToken = await login(manager.employeeId, password);
  const branch = await request("/branches", "POST", {
    name: tag, chain: "Verification", radiusMeters: 150, timezone: "UTC",
    areaId: null, agentId: null, latitude: null, longitude: null,
  }, managerToken);
  assert.equal(branch.status, 201, `branch: ${JSON.stringify(branch.data)}`);
  insertedBranches.push(branch.data.id);

  const id = `${tag}-seller`;
  const created = await request("/users", "POST", {
    employeeId: id, nameAr: "بائع اختبار الصلاحيات", role: "HYPER_SELLER",
    branchId: branch.data.id, password, permissions: ["dashboard.view", "sales.view"],
  }, managerToken);
  assert.equal(created.status, 201, `create: ${JSON.stringify(created.data)}`);
  insertedUsers.push(created.data.id);
  assert.deepEqual(created.data.effectivePermissions, ["dashboard.view", "sales.view"]);
  assert.equal(created.data.mustChangePassword, true);
  assert.equal("passwordHash" in created.data, false);
  assert.equal((await request("/users", "POST", {
    employeeId: `${tag}-invalid`, nameAr: "Invalid", role: "HYPER_SELLER",
    branchId: branch.data.id, password, permissions: ["users.manage"],
  }, managerToken)).status, 400, "role ceiling must reject excess permissions");

  const initialToken = await login(id, password);
  assert.equal((await request("/sales", "GET", undefined, initialToken)).status, 403, "first login must force password change");
  assert.equal((await request("/auth/password", "POST", {
    currentPassword: password, newPassword: nextPassword,
  }, initialToken)).status, 200);
  const sellerToken = await login(id, nextPassword);
  assert.equal((await request("/sales", "GET", undefined, sellerToken)).status, 200);
  assert.equal((await request("/products", "GET", undefined, sellerToken)).status, 403);
  assert.equal((await request("/sales", "POST", {}, sellerToken)).status, 403);
  assert.equal((await request("/exports/sales", "GET", undefined, sellerToken)).status, 403);
  assert.equal((await request("/dashboard", "GET", undefined, sellerToken)).data.products, 0);

  const renamed = `${tag}-renamed`;
  assert.equal((await request(`/users/${created.data.id}`, "PATCH", {
    employeeId: renamed, permissions: [],
  }, managerToken)).status, 200);
  assert.equal((await request("/auth/me", "GET", undefined, sellerToken)).status, 401, "access update must revoke sessions");
  assert.equal((await request("/auth/mobile-login", "POST", {
    employeeId: id, password: nextPassword,
  })).status, 401, "old employee ID must stop working");
  const restrictedToken = await login(renamed, nextPassword);
  assert.equal((await request("/dashboard", "GET", undefined, restrictedToken)).status, 403);
  assert.equal((await request(`/users/${created.data.id}`, "PATCH", {
    password,
  }, managerToken)).status, 200);
  assert.equal((await request("/auth/me", "GET", undefined, restrictedToken)).status, 401, "password reset must revoke sessions");
  assert.equal((await request(`/users/${managerId}`, "PATCH", {active: false}, managerToken)).status, 400);
  assert.equal((await request(`/users/${managerId}`, "PATCH", {permissions: []}, managerToken)).status, 400);

  const limited = await request("/users", "POST", {
    employeeId: `${tag}-limited`, nameAr: "مدير محدود", role: "HIGHER_MANAGEMENT",
    password, permissions: ["users.view", "users.manage"],
  }, managerToken);
  assert.equal(limited.status, 201, `limited manager: ${JSON.stringify(limited.data)}`);
  insertedUsers.push(limited.data.id);
  const limitedInitial = await login(limited.data.employeeId, password);
  assert.equal((await request("/auth/password", "POST", {
    currentPassword: password, newPassword: nextPassword,
  }, limitedInitial)).status, 200);
  const limitedToken = await login(limited.data.employeeId, nextPassword);
  assert.equal((await request("/users", "GET", undefined, limitedToken)).status, 200);
  assert.equal((await request("/branches", "GET", undefined, limitedToken)).status, 403);
  assert.equal((await request("/users", "POST", {
    employeeId: `${tag}-forged`, nameAr: "Forged manager",
    role: "HIGHER_MANAGEMENT", password, permissions: null,
  }, limitedToken)).status, 403, "restricted manager must not create full-access account");
  assert.equal((await request(`/users/${limited.data.id}`, "PATCH", {
    permissions: null,
  }, limitedToken)).status, 403, "restricted manager must not expand own permissions");
  assert.equal((await request(`/users/${managerId}`, "PATCH", {
    password: nextPassword,
  }, limitedToken)).status, 403, "restricted manager must not reset full manager password");

  const agent = await request("/users", "POST", {
    employeeId: `${tag}-agent`, nameAr: "وكيل اختبار الصلاحيات", role: "HYPER_AGENT",
    branchId: branch.data.id, password,
  }, managerToken);
  assert.equal(agent.status, 201, `agent: ${JSON.stringify(agent.data)}`);
  insertedUsers.push(agent.data.id);
  const agentToken = await login(agent.data.employeeId, password);
  assert.equal((await request("/auth/password", "POST", {
    currentPassword: password, newPassword: nextPassword,
  }, agentToken)).status, 200);
  const assignedToken = await login(agent.data.employeeId, nextPassword);
  const reassigned = await request(`/branches/${branch.data.id}`, "PATCH", {
    name: tag, chain: "Verification", radiusMeters: 150, timezone: "UTC",
    areaId: null, agentId: null, latitude: null, longitude: null,
  }, managerToken);
  assert.equal(reassigned.status, 200, `branch reassignment: ${JSON.stringify(reassigned.data)}`);
  assert.equal((await request("/auth/me", "GET", undefined, assignedToken)).status, 401, "branch reassignment must revoke agent session");

  const [pending] = await db.insert(users).values({
    employeeId: `${tag}-pending`, nameAr: "موظف مستورد", role: "PENDING", active: false,
    mustChangePassword: true,
  }).returning();
  insertedUsers.push(pending.id);
  assert.equal((await request(`/users/${pending.id}`, "PATCH", {
    role: "HYPER_SELLER", branchId: branch.data.id, active: true,
  }, managerToken)).status, 400, "pending activation requires temporary password");
  assert.equal((await request(`/users/${pending.id}`, "PATCH", {
    role: "HYPER_SELLER", branchId: branch.data.id, active: true, password,
  }, managerToken)).status, 200);
  const activated = await login(pending.employeeId, password);
  assert.equal((await request("/sales", "GET", undefined, activated)).status, 403, "activated employee must change password");
  process.stdout.write("Employee access API regression checks passed.\n");
}

try {
  await check();
} finally {
  if (insertedUsers.length) {
    await db.delete(sessions).where(inArray(sessions.userId, insertedUsers));
    await db.delete(audit).where(eq(audit.actorId, managerId));
    if (insertedBranches.length) await db.delete(branches).where(inArray(branches.id, insertedBranches));
    await db.delete(users).where(inArray(users.id, insertedUsers));
  }
}