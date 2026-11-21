// Goes through a deployed Yooits preview the way people use it: the password gate,
// public pages, signing up, the creator dashboard and the owner console, using the
// test accounts deploy/seed.mjs creates. Changes it makes are undone at the end.
import { test, expect, request } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const PASSWORD = (process.env.SITE_PASSWORD ?? "").trim();
const TIPPING = process.env.TIPPING === "true";
const SIGNUP_EMAIL = `e2e-${Date.now()}@example.com`;
test.describe.configure({ mode: "serial" });

async function signIn(page, email) {
  await page.goto("/auth");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

async function ownerToggle(page, username, label, reason) {
  await page.goto("/owner/users");
  await page.getByText(`@${username}`).first().click();
  await page.waitForURL(/\/owner\/users\//);
  await page.getByRole("button", { name: label }).first().click();
  const dialog = page.getByRole("alertdialog");
  if (reason) await dialog.locator("#reason").fill(reason);
  await dialog.getByRole("button", { name: label }).click();
  await expect(dialog).toBeHidden();
}

test.afterAll(async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return;
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of data?.users ?? []) {
    if (u.email?.startsWith("e2e-") && u.email.endsWith("@example.com")) await db.auth.admin.deleteUser(u.id);
  }
});

test("the site asks for the preview password", async ({ baseURL }) => {
  const anon = await request.newContext({ baseURL, httpCredentials: undefined });
  const res = await anon.get("/");
  expect(res.status()).toBe(401);
  expect(res.headers()["www-authenticate"]).toContain("Basic");
  const ok = await (await request.newContext({ baseURL, httpCredentials: { username: "x", password: PASSWORD } })).get("/");
  expect(ok.status()).toBe(200);
  expect(ok.headers()["x-robots-tag"]).toContain("noindex");
});

test("home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Yooits/);
});

test("public creator pages and wishlists", async ({ page }) => {
  await page.goto("/alice");
  await expect(page.getByRole("heading", { name: "Alice Rivera" })).toBeVisible();
  await page.goto("/alice/wishlist/studio");
  await expect(page.getByRole("heading", { name: "Studio wishlist" })).toBeVisible();
  await page.goto("/bob/wishlist/kitchen");
  await expect(page.getByRole("heading", { name: "Wishlist not found" })).toBeVisible();
  await page.goto("/no-such-user-e2e");
  await expect(page.getByRole("heading", { name: "User not found" })).toBeVisible();
});

test("tip page", async ({ page }) => {
  test.skip(!TIPPING, "no Stripe test key, so tipping is off in this preview");
  await page.goto("/alice/tip");
  await expect(page.locator("h1")).toBeVisible();
});

test("a new person can sign up and reach their dashboard", async ({ page }) => {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.locator("#username").fill(`e2e${Date.now() % 1e8}`);
  await page.locator("#email").fill(SIGNUP_EMAIL);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect
    .poll(async () => (page.url().includes("/dashboard") ? "dashboard" : (await page.getByText(/Check .* to confirm/).count()) ? "confirm-email-on" : "waiting"), {
      timeout: 20_000,
      message: "sign-up should land on the dashboard (if it asks to confirm the email, turn off Confirm email in the preview Supabase project)",
    })
    .toBe("dashboard");
});

test("creator dashboard", async ({ page }) => {
  await signIn(page, "alice@example.com");
  await expect(page.getByRole("heading", { name: "Manage your page" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your links" })).toBeVisible();
  await page.goto("/dashboard/wishlists");
  await expect(page.getByRole("heading", { name: "Wishlists" })).toBeVisible();
  await expect(page.getByText("Studio wishlist").first()).toBeVisible();
});

test("a creator can't open the owner console", async ({ page }) => {
  await signIn(page, "alice@example.com");
  await page.goto("/owner");
  await expect(page.getByText("The owner console is only for Yooits admins.")).toBeVisible();
  await page.goto("/owner/users");
  await expect(page.getByText("The owner console is only for Yooits admins.")).toBeVisible();
});

test("owner console sections", async ({ page }) => {
  await signIn(page, "owner@example.com");
  for (const [path, heading] of [
    ["/owner", "Overview"],
    ["/owner/users", "Users"],
    ["/owner/revenue", "Money"],
    ["/owner/invites", "Invites"],
    ["/owner/audit", "Audit log"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await page.goto("/owner/users");
  for (const u of ["alice", "bob", "casey", "previewowner"]) await expect(page.getByText(`@${u}`).first()).toBeVisible();
  await page.getByText("@alice").first().click();
  for (const h of ["Account", "Money and wishlists"]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
});

test("owner can unpublish and republish a page", async ({ page, browser, baseURL }) => {
  await signIn(page, "owner@example.com");
  await ownerToggle(page, "casey", "Unpublish page", "End-to-end test");
  const visitor = await browser.newContext({ baseURL, httpCredentials: { username: "x", password: PASSWORD } });
  const v = await visitor.newPage();
  await v.goto("/casey");
  await expect(v.getByRole("heading", { name: "User not found" })).toBeVisible();
  await ownerToggle(page, "casey", "Republish page");
  await v.goto("/casey");
  await expect(v.getByRole("heading", { name: "Casey Lin" })).toBeVisible();
  await visitor.close();
});

test("owner can suspend and reactivate an account, and it's in the audit log", async ({ page }) => {
  await signIn(page, "owner@example.com");
  await ownerToggle(page, "casey", "Suspend account", "End-to-end test");
  await page.goto("/owner/users");
  await expect(page.getByText("Suspended").first()).toBeVisible();
  await ownerToggle(page, "casey", "Reactivate account");
  await page.goto("/owner/audit");
  await expect(page.getByText(/suspend/i).first()).toBeVisible();
});

test("owner can turn a creator's tips off and on", async ({ page }) => {
  await signIn(page, "owner@example.com");
  await ownerToggle(page, "alice", "Turn off tips", "End-to-end test");
  await ownerToggle(page, "alice", "Turn tips back on");
});
