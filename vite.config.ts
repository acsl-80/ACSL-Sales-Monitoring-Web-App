import { defineConfig, loadEnv, mergeConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Standalone Vite config assembling the project's build plugins — tailwind,
// tsconfig-paths, TanStack Start, React, and nitro — with nitro targeting
// Vercel for deploys.
export default defineConfig(async ({ command, mode }) => {
  const plugins: PluginOption[] = [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    viteReact(),
  ];

  // nitro builds the deployable output; only needed at build time. The Vercel
  // preset emits the .vercel/output structure Vercel expects.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ preset: "vercel" }));
  }

  // Statically inject VITE_* env vars (matches the previous build-time define).
  const loadedEnv = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadedEnv)) {
    envDefine[`import.meta.env.${key}`] = JSON.stringify(value);
  }

  return mergeConfig(
    { server: { host: "::", port: 8080 } },
    {
      define: envDefine,
      /*
       * Slice 8b: nothing reaches the production console by accident. The
       * host's own logging goes through src/app/utils/log.ts, which prints
       * in development or under the support flag; any stray console.log,
       * console.debug or console.info left in a file is marked pure so the
       * production bundle drops it. console.warn and console.error stay: the
       * error capture relies on them.
       */
      ...(command === "build"
        ? { esbuild: { pure: ["console.log", "console.debug", "console.info"] } }
        : {}),
      css: { transformer: "lightningcss" as const },
      resolve: {
        alias: {
          "@": `${process.cwd()}/src`,
        },
        dedupe: [
          "react",
          "react-dom",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "@tanstack/react-query",
          "@tanstack/query-core",
        ],
      },
      optimizeDeps: {
        include: [
          "react",
          "react-dom",
          "react-dom/client",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
        ],
        ignoreOutdatedRequests: true,
      },
      plugins,
    },
  );
});
