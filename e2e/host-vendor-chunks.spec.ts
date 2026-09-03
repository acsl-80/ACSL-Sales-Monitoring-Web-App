import { test, expect, type Page } from "@playwright/test";
import { signIn, USERS } from "./helpers";

/**
 * Slice 11b of the 2026-09-02 review (finding F11): React ships in a chunk of
 * its own.
 *
 * The app entry carried the React runtime with the shell, 443 KB in one file,
 * so every deploy (and main deploys daily) made every browser download all of
 * it again. React now builds into a named chunk that changes only when React
 * does, so a deploy that touches app code leaves it cached. The first paint
 * is measured too, so the split never costs more than it saves.
 */

/** Today's first-paint script bytes on the dashboard, uncompressed; the split must not exceed it by more than a tenth. */
const INITIAL_BYTES_TODAY = 697 * 1024;
/** The entry was 443 KB; with React out of it, 269 KB. The ceiling leaves room for the app to grow. */
const ENTRY_CEILING = 350 * 1024;

type Loaded = { name: string; bytes: number };

async function loadedScripts(page: Page): Promise<Loaded[]> {
  return page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => /\/assets\/[^?]+\.js$/.test(e.name))
      .map((e) => ({
        name: e.name.replace(/^.*\/assets\//, ""),
        bytes: (e as PerformanceResourceTiming).decodedBodySize,
      })),
  );
}

test("React loads from its own chunk and the entry is small, at no cost to the first paint", async ({ page }) => {
  await signIn(page, USERS.admin);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 45_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const scripts = await loadedScripts(page);
  const entry = scripts.find((s) => /^index-[\w-]+\.js$/.test(s.name));
  const vendorReact = scripts.find((s) => s.name.startsWith("vendor-react-"));
  const total = scripts.reduce((sum, s) => sum + s.bytes, 0);

  test.info().annotations.push({
    type: "scripts loaded on the dashboard",
    description: `${scripts.length} files, ${Math.round(total / 1024)} KB: ${scripts
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((s) => `${s.name} ${Math.round(s.bytes / 1024)} KB`)
      .join(" | ")}`,
  });

  expect(entry, "the app entry should have loaded").toBeTruthy();
  expect(
    entry!.bytes,
    `the app entry should be below ${ENTRY_CEILING / 1024} KB, it is ${Math.round(entry!.bytes / 1024)} KB`,
  ).toBeLessThan(ENTRY_CEILING);
  expect(vendorReact, "React should load from a chunk of its own").toBeTruthy();
  expect(
    total,
    `the first paint should not cost more than a tenth over today's ${Math.round(INITIAL_BYTES_TODAY / 1024)} KB, it costs ${Math.round(total / 1024)} KB`,
  ).toBeLessThan(INITIAL_BYTES_TODAY * 1.1);
});
