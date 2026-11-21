// Builds Yooits for its own hosting (Vercel by default) without Lovable.
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

const preset = process.env.NITRO_PRESET ?? "vercel";

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
    // Hosting target. Vercel by default (writes .vercel/output for
    // `vercel deploy --prebuilt`); NITRO_PRESET=cloudflare-module builds for
    // Cloudflare Workers instead, and other Nitro presets work the same way.
    preset === "cloudflare-module"
      ? nitro({
          preset,
          output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
          cloudflare: { nodeCompat: true, deployConfig: true },
        })
      : nitro({ preset }),
    viteReact(),
  ],
  server: { host: "::", port: 8080 },
});
