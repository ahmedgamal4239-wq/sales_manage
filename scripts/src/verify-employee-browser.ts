import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { audit, branches, db, sessions, users } from "@workspace/db";

// Run against the development workflows: pnpm --filter @workspace/scripts verify-employee-browser
// Uses only randomly generated, isolated accounts. Never record traces, screenshots, or passwords.
const scrypt = promisify(scryptCallback);
const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:80";
const apiOrigin = process.env.SMOKE_API_ORIGIN ?? origin;
const web = `${origin}/sales-operations/`;
const mobile = process.env.SMOKE_MOBILE_URL ??
  (process.env.REPLIT_EXPO_DEV_DOMAIN ? `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}/` : "");
const tag = `browser-${randomBytes(7).toString("hex")}`;
const password = `Temp-${randomBytes(18).toString("hex")}`;
const newPassword = `Next-${randomBytes(18).toString("hex")}`;
const createdUsers: number[] = [];
const createdBranches: number[] = [];
let managerId = 0;
let browser: Browser | undefined;
const contexts: BrowserContext[] = [];

async function api<T>(path: string, method: string, token: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiOrigin}/api${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : {"content-type": "application/json"}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Never include a response body in failures: it could echo credentials.
  assert.ok(response.ok, `${method} ${path} failed (${response.status})`);
  return response.json() as Promise<T>;
}

async function webSignIn(page: Page, employeeId: string, secret: string) {
  await page.getByTestId("input-employee-id").fill(employeeId);
  await page.getByTestId("input-password").fill(secret);
  await page.getByTestId("button-auth-submit").click();
}

async function newContext() {
  const context = await browser!.newContext({ignoreHTTPSErrors: origin.startsWith("https://localhost:")});
  contexts.push(context);
  await context.addInitScript(() => localStorage.setItem("sales-lang", "en"));
  return context;
}

async function check() {
  if (!mobile) throw new Error("Set SMOKE_MOBILE_URL or run with REPLIT_EXPO_DEV_DOMAIN to check the mobile roster");
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64) as Buffer).toString("hex");
  const [manager] = await db.insert(users).values({
    employeeId: `${tag}-manager`, nameAr: "مدير اختبار المتصفح",
    role: "HIGHER_MANAGEMENT", active: true, mustChangePassword: false,
    passwordHash: `${salt}:${hash}`, permissions: null,
  }).returning();
  managerId = manager.id;
  createdUsers.push(manager.id);

  // The bearer token is held only in memory. Do not log it or save browser storage.
  const loginResponse = await fetch(`${apiOrigin}/api/auth/mobile-login`, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({employeeId: manager.employeeId, password}),
  });
  assert.equal(loginResponse.status, 200, "Temporary manager login failed");
  const token = ((await loginResponse.json()) as {token: string}).token;
  const branch = await api<{id: number}>("/branches", "POST", token, {
    name: tag, chain: "Browser smoke", radiusMeters: 150, timezone: "UTC",
    areaId: null, agentId: null, latitude: null, longitude: null,
  });
  createdBranches.push(branch.id);
  const [pending] = await db.insert(users).values({
    employeeId: `${tag}-pending`, nameAr: "موظف اختبار المتصفح",
    role: "PENDING", active: false, mustChangePassword: true,
  }).returning();
  createdUsers.push(pending.id);

  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? {executablePath: process.env.CHROMIUM_PATH}
      : existsSync("/repl/tools/bin/chromium")
        ? {executablePath: "/repl/tools/bin/chromium"}
        : {}),
    args: ["--no-sandbox"],
  });
  const managerContext = await newContext();
  const managerPage = await managerContext.newPage();
  await managerPage.goto(web);
  await webSignIn(managerPage, manager.employeeId, password);
  // This transition previously failed despite a successful login response.
  await managerPage.locator('aside [data-testid="link-users"]').waitFor();
  await managerPage.locator('aside [data-testid="link-users"]').click();
  const pendingRow = managerPage.getByTestId(`row-users-${pending.id}`);
  await pendingRow.waitFor();
  await managerPage.getByTestId(`button-edit-users-${pending.id}`).click();
  await managerPage.getByTestId("input-users-role").selectOption("HYPER_SELLER");
  await managerPage.getByTestId("input-users-active").selectOption("true");
  await managerPage.getByTestId("input-users-branchId").selectOption(String(branch.id));
  await managerPage.getByTestId("input-users-password").fill(password);
  await managerPage.getByTestId("button-save-users").click();
  await managerPage.getByTestId("status-users-success").waitFor();
  await managerPage.getByTestId(`row-users-${pending.id}`).getByText("Hyper seller").waitFor();

  const employeeContext = await newContext();
  const employeePage = await employeeContext.newPage();
  await employeePage.goto(web);
  await webSignIn(employeePage, pending.employeeId, password);
  await employeePage.getByTestId("input-current-password").waitFor();
  await employeePage.getByTestId("input-current-password").fill(password);
  await employeePage.getByTestId("input-new-password").fill(newPassword);
  await employeePage.getByTestId("input-confirm-password").fill(newPassword);
  await employeePage.getByTestId("button-auth-submit").click();
  await employeePage.getByTestId("status-password-changed").waitFor();
  await webSignIn(employeePage, pending.employeeId, newPassword);
  await employeePage.locator('aside [data-testid="link-products"]').waitFor();
  assert.equal(await employeePage.locator('aside [data-testid="link-users"]').count(), 0);

  const renamed = `${tag}-renamed`;
  await managerPage.getByTestId(`button-edit-users-${pending.id}`).click();
  await managerPage.getByTestId("input-users-employeeId").fill(renamed);
  await managerPage.getByTestId("button-permissions-custom").click();
  for (const permission of ["products.view", "sales.write", "attendance.view", "attendance.write"]) {
    await managerPage.getByTestId(`checkbox-permission-${permission}`).uncheck();
  }
  await managerPage.getByTestId("button-save-users").click();
  await managerPage.getByTestId("status-users-success").waitFor();
  await managerPage.getByTestId(`row-users-${pending.id}`).getByText(renamed).waitFor();
  assert.match(await managerPage.getByTestId(`text-effective-access-${pending.id}`).innerText(), /^3 \//);

  // The old browser session must be rejected after an access/ID edit.
  await employeePage.reload();
  await employeePage.getByTestId("input-employee-id").waitFor();
  await webSignIn(employeePage, renamed, newPassword);
  await employeePage.locator('aside [data-testid="link-branches"]').waitFor();
  assert.equal(await employeePage.locator('aside [data-testid="link-products"]').count(), 0);
  assert.equal(await employeePage.locator('aside [data-testid="link-attendance"]').count(), 0);
  await employeePage.locator('aside [data-testid="link-branches"]').click();
  await employeePage.getByText(tag, {exact:true}).first().waitFor();
  const oldIdLogin = await fetch(`${apiOrigin}/api/auth/mobile-login`, {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({employeeId: pending.employeeId, password: newPassword}),
  });
  assert.equal(oldIdLogin.status, 401, "Old employee ID should no longer sign in");

  // Expo web renders the same role-gated data roster as the mobile application.
  const mobileContext = await browser.newContext({ignoreHTTPSErrors: mobile.startsWith("https://localhost:")});
  contexts.push(mobileContext);
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(mobile);
  await mobilePage.locator("input").first().waitFor();
  await mobilePage.locator("input").nth(0).fill(renamed);
  await mobilePage.locator("input").nth(1).fill(newPassword);
  await mobilePage.getByRole("button", {name: /sign in|دخول/i}).click();
  await mobilePage.getByText(/read only|عرض فقط/i).first().waitFor();
  await mobilePage.getByText(/read only|عرض فقط/i).first().click();
  await mobilePage.getByText(tag, {exact:true}).first().waitFor();
  assert.equal(await mobilePage.getByText(/^(Products|المنتجات)$/).count(), 0,
    "Mobile roster must hide products without products.view");
  assert.equal(await mobilePage.getByText(/^(Employees|الموظفون)$/).count(), 0,
    "Mobile roster must hide employees without users.view");
  process.stdout.write("Employee browser smoke check passed (web and mobile).\n");
}

try {
  await check();
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (createdUsers.length) {
    await db.delete(sessions).where(inArray(sessions.userId, createdUsers));
    await db.delete(audit).where(eq(audit.actorId, managerId));
    if (createdBranches.length) await db.delete(branches).where(inArray(branches.id, createdBranches));
    await db.delete(users).where(inArray(users.id, createdUsers));
  }
}