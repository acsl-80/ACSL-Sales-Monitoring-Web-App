import { expect, type Page } from "@playwright/test";

/**
 * The Supabase project the preview must be talking to, and the one it must
 * never touch. Both are asserted rather than assumed: the app ships a hardcoded
 * production fallback in `src/lib/supabaseConfig.ts`, so a missing or blank
 * preview environment variable does not fail loudly, it silently connects to
 * production. That is the single most important thing this suite guards.
 */
export const BRANCH_REF = process.env.BRANCH_SUPABASE_REF ?? "";
export const PRODUCTION_REF = "oeiwnpngbnkhcismhpgs";

export const PREVIEW_PASSWORD = "PreviewOnly!2026";

/** Seeded accounts, one per role. See supabase/seed.sql. */
export const USERS = {
  admin: "admin@preview.acsl.test",
  manager: "manager@preview.acsl.test",
  acslAgent: "acslagent@preview.acsl.test",
  partner: "partner@preview.acsl.test",
  agent: "agent@preview.acsl.test",
  callCentre: "callcentre@preview.acsl.test",
} as const;

/**
 * Records every backend origin the page talks to, so a test can assert the app
 * reached the branch and never production.
 */
export function trackSupabaseCalls(page: Page) {
  const hosts = new Set<string>();
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes(".supabase.co")) {
      try {
        hosts.add(new URL(url).host);
      } catch {
        /* malformed URL, nothing to record */
      }
    }
  });
  return {
    hosts,
    /** Fails if production was contacted, or if the branch never was. */
    assertBranchOnly() {
      const contacted = [...hosts];
      const touchedProduction = contacted.filter((h) => h.includes(PRODUCTION_REF));
      expect(
        touchedProduction,
        `preview contacted PRODUCTION: ${touchedProduction.join(", ")}`,
      ).toEqual([]);
      if (BRANCH_REF) {
        expect(
          contacted.some((h) => h.includes(BRANCH_REF)),
          `expected a call to the branch (${BRANCH_REF}); saw: ${contacted.join(", ") || "none"}`,
        ).toBe(true);
      }
    },
  };
}

/**
 * Gets this browser context past Vercel's SSO, once.
 *
 * Uses the query-parameter form rather than a header, deliberately. A header
 * set through Playwright's `extraHTTPHeaders` is attached to every request the
 * page makes, cross-origin ones included, which forces a CORS preflight on
 * calls to *.supabase.co that the edge function does not allow. The cookie form
 * is scoped to the preview origin and leaves third-party requests untouched.
 */
export async function primeBypass(page: Page) {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!secret) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is not set.");
  await page.goto(
    `/?x-vercel-protection-bypass=${encodeURIComponent(secret)}` +
      `&x-vercel-set-bypass-cookie=true`,
  );
}

/**
 * Signs in through the real login form and waits for the app shell.
 *
 * Selectors are deliberately structural. The page server-renders its submit
 * button with the text "Redirecting..." and only settles on its real label
 * after hydration, so matching the button by name is flaky by construction.
 * The two inputs are unambiguous by type: one text, one password.
 */
/**
 * Sessions, cached per role for the lifetime of the run.
 *
 * WHY THIS IS NOT JUST A SPEED OPTIMISATION
 *
 * Signing in once per test meant 25 sign-ins inside a five minute run, from one
 * IP, against one GoTrue instance. That crosses Supabase's default auth rate
 * limit part way through, and the tests that happen to run after it fail in a
 * way that looks nothing like a rate limit: the user appears signed in, but the
 * module reports that its access could not be confirmed.
 *
 * It cost a long diagnosis, and it was not a defect in the app. Every one of
 * those tests passed when its file was run on its own.
 *
 * So the suite now signs in once per role and replays the stored session.
 * Twenty-five sign-ins become five, and a failure means what it says.
 */
const sessionCache = new Map<string, { name: string; value: string }[]>();

async function signInWithForm(page: Page, email: string) {
  await page.goto("/login");

  const identifier = page.locator('input[type="text"]').first();
  await identifier.waitFor({ state: "visible" });
  await identifier.fill(email);
  await page.locator('input[type="password"]').first().fill(PREVIEW_PASSWORD);

  const submit = page
    .locator('button[type="submit"]')
    .or(page.getByRole("button", { name: /login|sign in/i }))
    .first();
  await submit.click();

  // /dashboard is the app's single post-login redirect, for every role.
  await page.waitForURL(/\/dashboard/, { timeout: 40_000 });
}

export async function signIn(page: Page, email: string) {
  await primeBypass(page);

  const cached = sessionCache.get(email);
  if (cached) {
    // supabase-js keeps the session in localStorage, so replaying those keys
    // before any page script runs is the same as having logged in.
    await page.addInitScript((entries: { name: string; value: string }[]) => {
      for (const { name, value } of entries) window.localStorage.setItem(name, value);
    }, cached);
    await page.goto("/dashboard");
    try {
      await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
      return;
    } catch {
      // The stored session was rejected, most likely expired. Drop it and do
      // it properly rather than failing the test for a stale cache.
      sessionCache.delete(email);
    }
  }

  await signInWithForm(page, email);

  const entries = await page.evaluate(() =>
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith("sb-"))
      .map((name) => ({ name, value: window.localStorage.getItem(name) ?? "" })),
  );
  if (entries.length > 0) sessionCache.set(email, entries);
}

/** The left-hand nav entry for the module, by its visible label. */
export function dataCentreNavLink(page: Page) {
  return page.getByRole("link", { name: "Data Center", exact: true });
}
