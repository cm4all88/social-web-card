// End-to-end tests for a deployed Yooits preview. Run by .github/workflows/e2e.yml
// each time Vercel finishes deploying preview/yooits. Needs SITE_URL and
// SITE_PASSWORD. With SUPABASE_URL and SUPABASE_SECRET_KEY it also removes the
// account the sign-up test makes (otherwise the next preview build does).
// Only failure screenshots are kept: traces would include the site password.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.e2e\.mjs$/,
  outputDir: "report",
  workers: 1,
  retries: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.SITE_URL,
    httpCredentials: { username: "preview", password: process.env.SITE_PASSWORD ?? "" },
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
});
