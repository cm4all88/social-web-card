// End-to-end tests for a deployed Yooits preview. Run by .github/workflows/deploy.yml
// right after each preview deploy. Needs SITE_URL, SITE_PASSWORD, SUPABASE_URL and
// SUPABASE_SECRET_KEY (to remove the account the sign-up test creates).
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
