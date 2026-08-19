import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright against a Vercel preview deployment.
 *
 * Two environment values are required, both read from `.vercel.local` by
 * `scripts/e2e-env.mjs` rather than being committed:
 *
 *   PREVIEW_URL                     the deployment to test
 *   VERCEL_AUTOMATION_BYPASS_SECRET gets past Vercel's SSO on previews
 *
 * The bypass secret is sent on every request. Without it the preview answers
 * with a 302 to vercel.com/sso-api and every assertion fails for a reason that
 * has nothing to do with the application.
 */

const previewUrl = process.env.PREVIEW_URL;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

if (!previewUrl) throw new Error("PREVIEW_URL is not set. Run via `bun run e2e`.");
if (!bypass) {
  throw new Error(
    "VERCEL_AUTOMATION_BYPASS_SECRET is not set. Run via `bun run e2e`.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  // The suite asserts on which backend the app talks to, and parallel workers
  // sharing one browser context would make those assertions ambiguous.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e-report" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: previewUrl,
    // The bypass is deliberately NOT set as extraHTTPHeaders. Those apply to
    // every request the page makes, including cross-origin calls to
    // *.supabase.co. A custom header on a cross-origin request forces a
    // preflight, and the edge function's Access-Control-Allow-Headers does not
    // list x-vercel-protection-bypass, so the browser blocks the call and the
    // module reports a network failure. That is a harness artefact, not an
    // application defect, and widening production CORS to accommodate a test
    // would be the wrong fix.
    //
    // `primeBypass()` in e2e/helpers.ts sets the bypass cookie once per context
    // instead, which Vercel honours for subsequent same-origin requests.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
