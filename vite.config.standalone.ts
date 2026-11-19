// Builds Yooits for Cloudflare Workers without Lovable.
//
// vite.config.ts uses Lovable's wrapper, which Lovable's editor needs while
// the live site is still built there. This file sets up the same plugins
// directly, so our own deploys (deploy/deploy.sh) don't depend on Lovable.
// When Yooits leaves Lovable, this file becomes vite.config.ts and the
// @lovable.dev package can be removed (then add "nitro" to devDependencies,
// which today arrives through that package).
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig({
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Same rule as Lovable's config: server-only code can't end up in the browser bundle.
      importProtection: { behavior: "error", client: { files: ["**/server/**"], specifiers: ["server-only"] } },
    }),
    nitro({
      preset: "cloudflare-module",
      output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
      cloudflare: { nodeCompat: true, deployConfig: true },
    }),
    viteReact(),
  ],
  server: { host: "::", port: 8080 },
});
