import { defineConfig, loadEnv, mergeConfig, type PluginOption } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import viteReact from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

// Standalone Vite config assembling the project's build plugins — tailwind,
// tsconfig-paths, TanStack Start, React, and nitro — with nitro targeting
// Vercel for deploys.
/*
 * A group test that matches a package's own files and not the packages nested
 * under its node_modules: a pattern like node_modules/jspdf/ also matches
 * jspdf/node_modules/@babel/runtime, and those shared helpers would drag the
 * whole group into the entry chunk.
 */
const own = (packages: RegExp) => (id: string) => {
  const m = id.replace(/\\/g, "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)$/);
  return Boolean(m && packages.test(m[1]) && !m[2].includes("node_modules/"));
};

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
      /*
       * Slice 11b: React ships in a chunk of its own. The app entry carried
       * the React runtime with the shell, 443 KB in one file, so every deploy
       * (and main deploys daily) made every browser download all of it again.
       * With React in its own chunk the entry is 269 KB and the runtime stays
       * cached until React itself changes; the first paint costs the same
       * bytes as before. Client build only: the server bundle is nitro's.
       *
       * Only React is grouped, and that was measured, not assumed. Grouping
       * the router or the Supabase client made Rolldown 1.1 fold them into
       * the entry. Grouping the lazy libraries (recharts, jspdf, deck.gl)
       * made the entry import each group statically through one shared
       * helper folded into it, and the first paint went from 697 KB to
       * 1,699 KB. Those libraries already load lazily on their own.
       */
      environments: {
        client: {
          build: {
            rolldownOptions: {
              output: {
                codeSplitting: {
                  groups: [
                    { name: "vendor-react", priority: 100, test: own(/^(react|react-dom|scheduler)$/) },
                  ],
                },
              },
            },
          },
        },
      },
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
