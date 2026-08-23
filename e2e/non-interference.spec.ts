import { test, expect } from "@playwright/test";
import { signIn, USERS, callEdgeFunction } from "./helpers";

/**
 * The standing requirement for this whole module: the sales monitoring web app
 * must not notice it exists.
 *
 * These tests would have caught the `manageProfileService` defect, where a
 * hardcoded production URL broke the profile menu in every environment except
 * production, so they earn their place rather than restating the obvious.
 */
test.describe("the sales app is unaffected", () => {
  // A fresh context per role, not clearCookies(). Supabase persists its session
  // in localStorage, which clearCookies() does not touch, so reusing one context
  // leaves the previous user signed in and /login redirects straight past the
  // form.
  test("every seeded role can sign in", async ({ browser }) => {
    // Six full sign-ins on six fresh contexts, each bypassing the session
    // cache by design. That is six times the work of an ordinary test on the
    // same 60 s budget, and it had been finishing with seconds to spare. The
    // budget is sized to the work rather than left to luck.
    test.setTimeout(60_000 * Object.keys(USERS).length);

    for (const email of Object.values(USERS)) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, email);
      await expect(page, `${email} did not reach the dashboard`).toHaveURL(
        /\/dashboard/,
      );
      await context.close();
    }
  });

  test("Sell Stove still loads and renders its form", async ({ page }) => {
    await signIn(page, USERS.admin);
    await page.goto("/sales/create");

    await expect(page).toHaveURL(/\/sales\/create/);
    await expect(page.getByRole("heading", { name: /Record a New Sale/i })).toBeVisible();

    // The stove serial field is the one gated on partner selection, so its
    // presence proves the form mounted rather than erroring.
    await expect(page.locator("#stoveSerialNo")).toBeVisible();
  });

  test("Sales Records and Stove Users Data still load", async ({ page }) => {
    await signIn(page, USERS.admin);

    for (const path of ["/sales", "/end-user-records"]) {
      const response = await page.goto(path);
      expect(response?.status(), `${path} returned ${response?.status()}`).toBeLessThan(400);
      await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));
    }
  });

  test("the profile menu resolves, which the hardcoded URL used to break", async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/functions/v1/manage-profile") && r.status() >= 400) {
        failures.push(`${r.status()} ${r.url()}`);
      }
    });

    await signIn(page, USERS.admin);
    await page.waitForLoadState("domcontentloaded");

    expect(failures, `manage-profile failed: ${failures.join(", ")}`).toEqual([]);
  });

  test("no unhandled console errors on the core sales screens", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await signIn(page, USERS.admin);
    await page.goto("/sales/create");
    await page.waitForLoadState("domcontentloaded");

    expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
  });

  /**
   * create-sale still refuses a duplicate phone for everyone who did not ask.
   *
   * This module added `allowSharedPhone` to `create-sale`, the one pre-existing
   * edge function it touches and the one the Sell Stove form and the Flutter
   * app both call on their main path. The rule it relaxes - one live sale per
   * phone number - is a real guard against an agent mistyping a number in front
   * of a customer, and only the digitalisation path is allowed to say it means
   * a shared number.
   *
   * The opt-in is `body.allowSharedPhone === true`, deliberately strict, so the
   * third case below matters as much as the first: a caller that sends a
   * truthy string must NOT get through. Reasoning about the diff says all three
   * refuse; this asserts it, and it is the only test in the suite that touches
   * the write path of a function real users hit today.
   */
  test("create-sale still refuses a duplicate phone unless asked in so many words", async ({
    page,
  }) => {
    await signIn(page, USERS.admin);

    const existing = await callEdgeFunction(page, "data-center-read", {
      action: "records",
      limit: 1,
    });
    const sale = (
      existing.body as {
        data?: {
          rows?: {
            primary_phone?: string;
            partner_name?: string;
            organization_id?: string;
          }[];
        };
      }
    ).data?.rows?.[0];
    /*
     * Asserted, not skipped. The seed guarantees sales with phone numbers, so
     * "no sale to collide with" means the read broke, not that the fixture is
     * thin - and a skip here would report green over the one write path in
     * this file. `v_sold_stoves` renames sales.phone to primary_phone, which
     * is what made this skip on its first run.
     */
    expect(
      sale?.primary_phone,
      "no seeded sale with a phone: the records read is broken, not the fixture",
    ).toBeTruthy();

    const attempt = (allowSharedPhone?: unknown) =>
      callEdgeFunction(page, "create-sale", {
        stoveSerialNo: "NON-EXISTENT-FOR-THIS-TEST",
        endUserName: "Non-interference probe",
        phone: sale!.primary_phone,
        contactPerson: "Probe",
        contactPhone: "08030000999",
        partnerName: sale!.partner_name ?? "Probe partner",
        salesDate: "2026-08-23",
        amount: 1000,
        transactionId: `NI-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        // An admin belongs to no partner, so the org has to be named or the
        // function refuses at 400 long before it reaches the phone rule - and
        // a 400 here would look like a pass turning into a fail for the wrong
        // reason.
        organizationId: sale!.organization_id,
        ...(allowSharedPhone === undefined ? {} : { allowSharedPhone }),
      });

    // Exactly the request the Sell Stove form and the Flutter app make.
    const asTheFormSends = await attempt(undefined);
    expect(
      asTheFormSends.status,
      `expected the duplicate-phone refusal, got ${JSON.stringify(asTheFormSends.body)}`,
    ).toBe(409);
    expect(JSON.stringify(asTheFormSends.body)).toMatch(/already used on sale/i);
    // And the response gains nothing it did not have before.
    expect(asTheFormSends.body).not.toHaveProperty("shares_phone_with");

    expect((await attempt(false)).status).toBe(409);
    // Truthy, but not `true`. Strictness is the whole guard.
    expect((await attempt("yes")).status).toBe(409);
  });
});
