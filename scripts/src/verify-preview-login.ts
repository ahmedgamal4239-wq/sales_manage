import assert from "node:assert/strict";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { db, pool, sessions, users } from "@workspace/db";

// Run against the managed web and API workflows, through their shared preview proxy.
// All credentials and the browser context are ephemeral; no traces or screenshots.
const scrypt = promisify(scryptCallback);
const origin = process.env.SMOKE_ORIGIN ?? "http://localhost:80";
const employeeId = `preview-check-${randomBytes(9).toString("hex")}`;
const temporaryPassword = `Temp-${randomBytes(20).toString("hex")}`;
const newPassword = `Next-${randomBytes(20).toString("hex")}`;

async function check() {
  const health = await fetch(`${origin}/api/healthz`);
  assert.equal(health.status, 200, "Preview API is not ready");
  const salt = randomBytes(16).toString("hex");
  const hashed = (await scrypt(temporaryPassword, salt, 64) as Buffer).toString("hex");
  const [user] = await db.insert(users).values({
    employeeId, nameAr: "Preview login check", role: "HIGHER_MANAGEMENT",
    active: true, mustChangePassword: true, passwordHash: `${salt}:${hashed}`,
  }).returning({ id: users.id });

  try {
    const browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH }
        : existsSync("/repl/tools/bin/chromium") ? { executablePath: "/repl/tools/bin/chromium" } : {}),
      args: ["--no-sandbox"],
    });
    try {
      const context = await browser.newContext();
      await context.addInitScript(() => localStorage.setItem("sales-lang", "en"));
      const page = await context.newPage();
      const apiStatuses: Record<string, number[]> = {};
      page.on("response", response => {
        const path = new URL(response.url()).pathname;
        if (["/api/auth/me", "/api/auth/login", "/api/auth/password", "/api/auth/logout"].includes(path))
          (apiStatuses[path] ??= []).push(response.status());
      });
      async function signIn(password: string) {
        await page.getByTestId("input-employee-id").fill(employeeId);
        await page.getByTestId("input-password").fill(password);
        await page.getByTestId("button-auth-submit").click();
      }
      await page.goto(`${origin}/`);
      await page.getByTestId("input-employee-id").waitFor();
      await signIn("invalid-password");
      await page.getByTestId("status-login-error").getByText(/invalid employee id or password/i).waitFor();
      assert.equal(apiStatuses["/api/auth/login"]?.at(-1), 401);

      await signIn(temporaryPassword);
      await page.getByTestId("input-current-password").waitFor();
      assert.equal(apiStatuses["/api/auth/login"]?.at(-1), 200);
      await page.reload();
      await page.getByTestId("input-current-password").waitFor();
      assert.equal(apiStatuses["/api/auth/me"]?.at(-1), 200);
      await page.getByTestId("input-current-password").fill(temporaryPassword);
      await page.getByTestId("input-new-password").fill(newPassword);
      await page.getByTestId("input-confirm-password").fill(newPassword);
      await page.getByTestId("button-auth-submit").click();
      await page.getByTestId("status-password-changed").waitFor();
      assert.equal(apiStatuses["/api/auth/password"]?.at(-1), 200);
      await page.reload();
      await page.getByTestId("input-employee-id").waitFor();
      assert.equal(apiStatuses["/api/auth/me"]?.at(-1), 401);
      await signIn(newPassword);
      await page.locator('aside [data-testid="link-users"]').waitFor();
      assert.equal(apiStatuses["/api/auth/login"]?.at(-1), 200);
      await page.locator('aside [data-testid="link-users"]').click();
      await page.getByTestId(`row-users-${user.id}`).waitFor();
      await page.reload();
      await page.getByTestId(`row-users-${user.id}`).waitFor();
      assert.equal(apiStatuses["/api/auth/me"]?.at(-1), 200);
      await page.getByTestId("button-logout").click();
      await page.getByTestId("input-employee-id").waitFor();
      assert.equal(apiStatuses["/api/auth/logout"]?.at(-1), 200);
      await page.reload();
      await page.getByTestId("input-employee-id").waitFor();
      assert.equal(apiStatuses["/api/auth/me"]?.at(-1), 401);
      process.stdout.write("Preview login check passed (denied login, first password change, refresh, authorized access, sign-out).\n");
    } finally {
      await browser.close();
    }
  } finally {
    await db.delete(sessions).where(eq(sessions.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  }
}

try {
  await check();
} finally {
  await pool.end();
}