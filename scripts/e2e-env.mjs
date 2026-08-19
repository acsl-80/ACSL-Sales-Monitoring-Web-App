#!/usr/bin/env node
/**
 * Resolves everything the e2e suite needs, then runs Playwright.
 *
 * Nothing here is committed. Credentials come from the gitignored `.local`
 * files that sit beside the repo, and the preview URL is looked up live,
 * because it changes with every deployment.
 *
 *   bun run e2e                 test the newest preview for the current branch
 *   bun run e2e -- --headed     same, with a visible browser
 *   PREVIEW_URL=... bun run e2e  test a specific deployment
 */
import { readFileSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readLocal(file, key) {
  try {
    const m = readFileSync(join(root, file), "utf8").match(
      new RegExp(`^${key}=(.*)$`, "m"),
    );
    return m ? m[1].replace(/[\r"']/g, "").trim() : "";
  } catch {
    return "";
  }
}

const vercelToken = readLocal(".vercel.local", "VERCEL_TOKEN");
const bypass = readLocal(".vercel.local", "VERCEL_AUTOMATION_BYPASS_SECRET");
const supabaseToken = readLocal(".supabase.local", "SUPABASE_ACCESS_TOKEN");

if (!bypass) {
  console.error(
    "Missing VERCEL_AUTOMATION_BYPASS_SECRET in .vercel.local.\n" +
      "Without it every preview request is answered with a redirect to Vercel SSO.\n" +
      "Create one: PATCH /v1/projects/<project>/protection-bypass {\"generate\":{}}",
  );
  process.exit(1);
}

const branch =
  process.env.GIT_BRANCH ||
  execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root })
    .toString()
    .trim();

async function newestPreview() {
  if (process.env.PREVIEW_URL) return process.env.PREVIEW_URL;
  if (!vercelToken) {
    console.error("Missing VERCEL_TOKEN in .vercel.local, and no PREVIEW_URL set.");
    process.exit(1);
  }
  const res = await fetch(
    "https://api.vercel.com/v6/deployments?projectId=acsl-sales-monitoring-web-app&limit=20",
    { headers: { Authorization: `Bearer ${vercelToken}` } },
  );
  const { deployments = [] } = await res.json();
  const hit = deployments.find(
    (d) => d.meta?.githubCommitRef === branch && d.state === "READY",
  );
  if (!hit) {
    console.error(`No READY preview deployment found for branch "${branch}".`);
    process.exit(1);
  }
  return `https://${hit.url}`;
}

/** The Supabase branch the preview should be talking to, if one exists. */
async function branchRef() {
  if (!supabaseToken) return "";
  const res = await fetch(
    "https://api.supabase.com/v1/projects/oeiwnpngbnkhcismhpgs/branches",
    { headers: { Authorization: `Bearer ${supabaseToken}` } },
  );
  if (!res.ok) return "";
  const found = (await res.json()).find((b) => b.git_branch === branch);
  return found?.project_ref ?? "";
}

const [previewUrl, ref] = await Promise.all([newestPreview(), branchRef()]);

console.log(`branch        : ${branch}`);
console.log(`preview       : ${previewUrl}`);
console.log(`supabase ref  : ${ref || "(none found; isolation assertion will be partial)"}`);
console.log("");

// Spawn the Playwright CLI through node rather than the `npx` shim. On Windows
// the shim is a .cmd file, and Node 22 refuses to spawn those without a shell
// (EINVAL). Going straight to the CLI entrypoint avoids both the shim and the
// shell.
const child = spawn(
  process.execPath,
  [join(root, "node_modules", "@playwright", "test", "cli.js"), "test", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      PREVIEW_URL: previewUrl,
      VERCEL_AUTOMATION_BYPASS_SECRET: bypass,
      BRANCH_SUPABASE_REF: ref,
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
