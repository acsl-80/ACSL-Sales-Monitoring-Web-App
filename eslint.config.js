import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  /*
   * The .jsx files, which nothing was checking.
   *
   * The block above matches only .ts and .tsx, so every .jsx in the app -
   * including all 60-odd in the Data Centre - was linted by nothing, and `tsc`
   * does not read .jsx either. Undefined identifiers therefore reached deployed bundles
   * more than once: `csvImportService.jsx` called a `getAuthToken` that was
   * never defined, so two of its functions threw before reaching the network,
   * and a refactor of the dashboard's state list shipped a reference with no
   * import and took sign-in down with it. The build does not catch either -
   * Rollup is happy to emit a free variable.
   *
   * Deliberately narrow: `no-undef` and the hooks rules, not the whole
   * recommended set. A wide rule set over sixty unlinted files produces a
   * backlog nobody reads and a lint step everybody starts skipping, and the
   * one rule that would have caught all of these is this one.
   */
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        // Loaded by a script tag for the maps page, so it is a real global
        // rather than a missing import.
        google: "readonly",
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-undef": "error",
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "off",
      /*
       * Formatting stays off here.
       *
       * These files were never formatted by this config and carry CRLF
       * endings; switching prettier on for them produced 52,000 errors in
       * one run, which is the backlog nobody reads that this block exists
       * to avoid. Correctness now, formatting as its own decision later.
       */
      "prettier/prettier": "off",
    },
  },
);