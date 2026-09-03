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
  /** The only seeded account holding call_import.use. */
  dataManager: "datamanager@preview.acsl.test",
} as const;

/**
 * The signed-in user's token and project URL, read back out of the page.
 *
 * For the handful of assertions that have to ask the server directly: what the
 * UI offers is presentation, and a permission is only real if the endpoint
 * refuses without it.
 */
export async function callEdgeFunction(
  page: Page,
  fn: string,
  body: Record<string, unknown>,
  query = "",
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({ fn, body, query }) => {
      const key = Object.keys(window.localStorage).find(
        (k) => k.startsWith("sb-") && k.endsWith("-auth-token"),
      );
      const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
      const token = stored.access_token ?? stored?.currentSession?.access_token;
      // The storage key is `sb-<ref>-auth-token`, which names the project the
      // session belongs to. Deriving the URL from it rather than from a build
      // variable keeps the call pointed at whatever the page is pointed at.
      const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
      const response = await fetch(`https://${ref}.supabase.co/functions/v1/${fn}${query}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { fn, body, query },
  );
}

/** The same, as a GET: for the read routes that take their arguments in the path. */
export async function getEdgeFunction(page: Page, path: string): Promise<{ status: number; body: unknown }> {
  return page.evaluate(async ({ path }) => {
    const key = Object.keys(window.localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    const stored = JSON.parse(window.localStorage.getItem(key ?? "") ?? "{}");
    const token = stored.access_token ?? stored?.currentSession?.access_token;
    const ref = (key ?? "").replace(/^sb-/, "").replace(/-auth-token$/, "");
    const response = await fetch(`https://${ref}.supabase.co/functions/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path });
}

/**
 * Run SQL against the PREVIEW BRANCH database. Never against production.
 *
 * Most setup belongs in the product: a spec that stages a batch through
 * `data-center-import` is testing the thing users touch. This exists for the
 * states the product cannot reach on purpose. The refusal this suite now makes
 * when a stove already has a sale only misbehaves when `stove_ids_base.status`
 * and `public.sales` DISAGREE, and nothing in the app creates that state
 * deliberately - it arrives through an unscoped stock reset. Without a way to
 * arrange it, the spec for that defect would pass against the broken code too,
 * which this repo has already shipped once.
 *
 * Three guards, because the header of this file names touching production as
 * the single most important thing the suite prevents:
 *
 *  - it throws when BRANCH_REF is empty, rather than falling back to anything
 *  - it throws when BRANCH_REF is the production ref, whatever set it
 *  - it never runs in the browser, so no token reaches the page
 */
export async function branchSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? "";
  if (!BRANCH_REF) {
    throw new Error("branchSql needs BRANCH_SUPABASE_REF; refusing to guess a database");
  }
  if (BRANCH_REF === PRODUCTION_REF) {
    throw new Error("branchSql was pointed at PRODUCTION; refusing");
  }
  if (!token) {
    throw new Error("branchSql needs SUPABASE_ACCESS_TOKEN from .supabase.local");
  }
  /*
   * Retried on a transport failure only, never on an answer. A single
   * `TypeError: fetch failed` from the Node process to the Management API took
   * a spec down mid-run on 2026-09-02, sixty minutes into a suite, and left
   * its finally unable to clean up. Every statement this helper is given is
   * idempotent by construction (updates and deletes keyed by serial or id), so
   * repeating one that never reached the server is safe. An HTTP answer that
   * is not an array is a real refusal and is thrown at once.
   */
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${BRANCH_REF}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      const body = await res.json();
      if (!Array.isArray(body)) {
        throw new Error(`branchSql failed: ${JSON.stringify(body).slice(0, 300)}`);
      }
      return body as T[];
    } catch (err) {
      const transport =
        err instanceof TypeError ||
        /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(err));
      if (!transport || attempt === 4) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

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

/**
 * Kick the commit chain and wait for the server to drain the batch.
 *
 * Commit stopped being synchronous: one press answers 202 and the server
 * works the batch link by link inside EdgeRuntime.waitUntil, whether anybody
 * is watching or not. A spec that presses and immediately asserts sales exist
 * is now asserting against a run that has barely started - so the press and
 * the wait live together here, and the batch's own live counts are the truth
 * being polled.
 */
export async function commitAndDrain(
  page: Page,
  batchId: string,
  tries = 40,
): Promise<Record<string, unknown>> {
  const kick = await callEdgeFunction(page, "data-center-import", {
    action: "commit",
    batchId,
  });
  if (kick.status !== 202 && kick.status !== 200) {
    throw new Error(`commit kick answered ${kick.status}: ${JSON.stringify(kick.body)}`);
  }
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(3000);
    const r = await callEdgeFunction(page, "data-center-import", {
      action: "batches",
      batchId,
    });
    const b = ((r.body as { data?: Record<string, unknown>[] })?.data ?? []).find(
      (x) => x.id === batchId,
    );
    if (b && (b.state === "committed" || b.valid_rows === 0)) return b;
  }
  throw new Error("the commit chain did not drain the batch in time");
}
