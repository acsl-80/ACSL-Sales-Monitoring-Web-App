// Look at the page. It was built without ever being rendered, and a screenshot
// is the only way to find the things a passing assertion cannot: a column that
// wraps into nonsense, a chip that collides, a section that reads as empty
// when it is merely quiet.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const root = "C:/Users/orezi/dev/acsl-80/sales-web";
const bypass = readFileSync(`${root}/.vercel.local`, "utf8")
  .match(/^VERCEL_AUTOMATION_BYPASS_SECRET=(.*)$/m)[1].trim();
const base = process.argv[2];
const out = process.argv[3];

const browser = await chromium.launch();

async function shoot(name, width, height, path) {
  // No blanket bypass header: it is a non-simple header, so sending it on the
  // cross-origin Supabase calls triggers a preflight the edge function does
  // not allow, and the page reports that it cannot reach the Data Center. The
  // first navigation sets a bypass cookie instead, which is same-origin only.
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?x-vercel-protection-bypass=${bypass}&x-vercel-set-bypass-cookie=true`);

  await page.goto(`${base}/login`);
  const id = page.locator('input[type="text"]').first();
  await id.waitFor({ state: "visible", timeout: 30_000 });
  await id.fill("admin@preview.acsl.test");
  await page.locator('input[type="password"]').first().fill("PreviewOnly!2026");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/dashboard/, { timeout: 40_000 });

  await page.goto(`${base}${path}`);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log("shot", name);
  await ctx.close();
}

const serial = process.argv[4] ?? "PRV000007";
await shoot("stove-desktop", 1280, 900, `/data-center/stove/${serial}`);
await shoot("stove-mobile", 375, 812, `/data-center/stove/${serial}`);
await shoot("hub-desktop", 1280, 900, "/data-center");
await shoot("records-desktop", 1280, 900, "/data-center/stove-records");
await browser.close();
