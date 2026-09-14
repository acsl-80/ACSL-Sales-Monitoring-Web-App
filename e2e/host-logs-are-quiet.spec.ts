import { test, expect } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Slice 8b of the 2026-09-02 review: the production console is quiet.
 *
 * One hundred and fifty-five console.log calls shipped to production across
 * twenty-two host files, and several said who was signed in: the email on
 * every auth state change, the first hundred characters of whatever sat under
 * an auth key in local storage, the full page address. Against the old build
 * the console fills during sign-in and carries the admin's email. Against the
 * new one the host logs through one gated helper, the build drops any stray
 * call, and the console stays empty.
 *
 * Warnings and errors are not counted: the error capture relies on them, and
 * a library is free to warn.
 */

test.describe.configure({ timeout: 120_000 });

test("signing in and opening two pages says nothing to the console, and never who is signed in", async ({
  page,
}) => {
  const heard: string[] = [];
  page.on("console", (message) => {
    if (["log", "debug", "info"].includes(message.type())) heard.push(message.text());
  });

  await signIn(page, USERS.admin);
  await page.goto("/dashboard");
  await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
  await page.goto("/sales");
  await expect(page.getByText("CONTROL PANEL")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2_000);

  const identifying = heard.filter(
    (text) => text.includes("@preview.acsl.test") || /access_token|refresh_token|eyJ[A-Za-z0-9_-]{10,}/.test(text),
  );
  expect(identifying, "no console message may carry the signed-in email or a token").toHaveLength(0);
  expect(
    heard,
    `the production console should be quiet; heard ${heard.length}, first: ${heard.slice(0, 4).join(" | ")}`,
  ).toHaveLength(0);
});
