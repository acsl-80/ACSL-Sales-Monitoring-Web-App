# Remove all Lovable traces before handover to Atmosfair

Goal: nothing in the shipped repository (files a developer at Atmosfair could open, plus the installed dependency tree) indicates the app was built with Lovable. Git history is left as-is per your decision.

## What the scan found

Traces exist in exactly these places:

| Where | What it is |
| --- | --- |
| `vite.config.ts` | Build config imported from `@lovable.dev/vite-tanstack-config` + branded comments |
| `package.json` | `@lovable.dev/vite-tanstack-config` devDependency |
| `bunfig.toml` | Comment + allowlist naming four `@lovable.dev/*` packages |
| `bun.lock`, `package-lock.json`, `deno.lock` | ~145 lines referencing the packages and Lovable's private registry |
| `AGENTS.md` | A "connected to Lovable" notice block |
| `.env.example` | Comment "Lovable injects VITE_* vars" |
| `.gitignore` | Comment "they sync to Lovable" |
| `src/app/system-documentation/APP_DOCUMENTATION.md` | Troubleshooting row naming the Lovable package |
| `.lovable/` folder | Plan/project metadata files |
| `scripts/check-upstream-clean.sh` | Existing de-branding guard script (mentions Lovable by design) |

No traces in the app UI, `__root.tsx` metadata, `public/`, `robots.txt`, or the webmanifest. There is no "Edit with Lovable" badge to worry about since you deploy on Vercel.

## Plan

### 1. Replace the build config with a standard TanStack Start Vite config

Rewrite `vite.config.ts` using plain, public plugins — all of them are already installed as direct dependencies:

- `@tanstack/react-start/plugin/vite` (with `server: { entry: "server" }`, preserving `src/server.ts`)
- `@vitejs/plugin-react`
- `@tailwindcss/vite`
- `vite-tsconfig-paths`
- `nitro/vite` for the production build, with the Vercel preset so deploys keep working
- explicit `server: { host: "::", port: 8080 }` and React/TanStack dedupe settings that the wrapper used to supply

Then remove `@lovable.dev/vite-tanstack-config` from `package.json` devDependencies.

### 2. Clean config, docs and metadata

- `bunfig.toml`: drop the `@lovable.dev/*` allowlist and rewrite the comment neutrally (the 24h supply-chain guard itself stays).
- `AGENTS.md`: remove the Lovable notice block; keep or replace with neutral contributor guidance.
- `.env.example`, `.gitignore`: neutral comments ("environment variables are injected at build time", "never commit secrets").
- `APP_DOCUMENTATION.md`: rewrite the troubleshooting row in terms of the generic minimum-release-age guard.
- Delete `.lovable/` and `scripts/check-upstream-clean.sh` (its whole purpose was scanning for the brand).

### 3. Regenerate lockfiles

Reinstall so `bun.lock` is regenerated without any `@lovable.dev` entries or private-registry URLs. Delete the stale `package-lock.json` and `deno.lock` (the project uses Bun; `deno.lock` is a leftover from the Supabase functions toolchain and contributes a Lovable reference).

### 4. Verify

- Full production build passes.
- Dev server boots and `/dashboard`, `/user-guide` render.
- Final grep for `lovable`, `gptengineer`, `gpteng` across the repo (excluding `.git`) returns nothing.

## Notes and trade-offs

- **Do this as the last step before handover.** Once the Lovable Vite wrapper is gone, this project may no longer preview or build correctly inside Lovable, so further edits here would be limited. Everything continues to work locally, on GitHub, and on Vercel.
- Application behaviour, styling, routes, Supabase config and env variable names are unchanged — this is purely build tooling and comments.
- Your Supabase project, Google Maps key, and Vercel setup are already your own accounts, so no runtime dependency on Lovable remains after this.
