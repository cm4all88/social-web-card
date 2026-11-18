import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Kept separate from vite.config.ts so tests don't load the Lovable/TanStack/Cloudflare plugins.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts", "supabase/tests/**/*.test.ts"], environment: "node" },
});
