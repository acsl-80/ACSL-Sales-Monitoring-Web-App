#!/usr/bin/env bash
# ACSL Sales Web — project-scoped environment.
#
#   source scripts/project-env.sh
#
# Everything below is scoped to the CURRENT SHELL only. Nothing is written to
# any machine-wide credential store, so the personal `gbax316` identities for
# git, Vercel and Supabase stay untouched.
#
# Why this exists: all three CLIs default to a single global login shared by
# every project on the machine. This repo belongs to a different account for
# all three services, and mixing them silently acts as the wrong identity.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_ok="  ✓"; _no="  ✗"

echo "ACSL Sales Web environment — $ROOT"

# ---------------------------------------------------------------------------
# Git — identity comes from the includeIf in the global .gitconfig, which
# applies to everything under dev/acsl-80/. Nothing to export; just verify.
# ---------------------------------------------------------------------------
_email="$(git -C "$ROOT" config user.email 2>/dev/null)"
if [ "$_email" = "atmosfairng@gmail.com" ]; then
  echo "$_ok git      ACSL <$_email>  (remote via github-acsl SSH alias)"
else
  echo "$_no git      identity is '$_email' — expected atmosfairng@gmail.com"
  echo "        the includeIf in your global .gitconfig may be missing"
fi

# ---------------------------------------------------------------------------
# Supabase — token from the gitignored file. NEVER `supabase login`, which
# writes to the OS credential store shared with every other project.
# ---------------------------------------------------------------------------
if [ -f "$ROOT/.supabase.local" ]; then
  _tok="$(grep -E '^SUPABASE_ACCESS_TOKEN=' "$ROOT/.supabase.local" | cut -d= -f2- | tr -d ' \r')"
  _pw="$(grep -E '^SUPABASE_DB_PASSWORD=' "$ROOT/.supabase.local" | cut -d= -f2- | tr -d ' \r')"
  if [ -n "$_tok" ]; then
    export SUPABASE_ACCESS_TOKEN="$_tok"
    echo "$_ok supabase token exported (${_tok:0:8}…) — local API on :54331"
  else
    echo "$_no supabase SUPABASE_ACCESS_TOKEN is blank in .supabase.local"
  fi
  [ -n "$_pw" ] && export SUPABASE_DB_PASSWORD="$_pw"
  unset _tok _pw
else
  echo "$_no supabase .supabase.local not found"
fi

# ---------------------------------------------------------------------------
# Vercel — a project-local auth directory. `vercel --global-config DIR` keeps
# the session entirely separate from %APPDATA%\com.vercel.cli, which is logged
# in as gbax316. The wrapper below applies it to every vercel call, so you
# cannot forget the flag.
#
# First-time setup, inside this shell:
#   vercel login          -> writes into .vercel-auth.local/, not the global store
#   vercel link           -> writes .vercel/project.json (gitignored)
# ---------------------------------------------------------------------------
export ACSL_VERCEL_CONFIG="$ROOT/.vercel-auth.local"
mkdir -p "$ACSL_VERCEL_CONFIG"

vercel() { command vercel --global-config "$ACSL_VERCEL_CONFIG" "$@"; }

if [ -f "$ROOT/.vercel.local" ]; then
  _vt="$(grep -E '^VERCEL_TOKEN=' "$ROOT/.vercel.local" | cut -d= -f2- | tr -d ' \r')"
  [ -n "$_vt" ] && export VERCEL_TOKEN="$_vt"
  unset _vt
fi

_who="$(command vercel --global-config "$ACSL_VERCEL_CONFIG" whoami 2>/dev/null | tail -1 | tr -d '\r')"
if [ -n "$_who" ] && [ "$_who" != "Error" ]; then
  echo "$_ok vercel   scoped session: $_who"
else
  echo "  · vercel   scoped auth dir ready, not logged in yet — run: vercel login"
fi

# Guard: warn loudly if the global session ever leaks into this shell.
_global="$(command vercel whoami 2>/dev/null | tail -1 | tr -d '\r')"
[ "$_global" = "gbax316" ] && echo "  · note     global vercel session is still gbax316 — the wrapper keeps it out of this shell"

unset ROOT _ok _no _email _who _global
