#!/usr/bin/env bash
# Pushes local main work to origin via branch + PR + merge, since main is protected.
# Usage: git sync   (run while on main with commits ready to go out)
set -euo pipefail

REPO="acsl-80/ACSL-Sales-Monitoring-Web-App"
BASE="main"

current_branch=$(git branch --show-current)
if [ "$current_branch" != "$BASE" ]; then
  echo "Not on $BASE (on '$current_branch'). Push this branch normally, or checkout $BASE first." >&2
  exit 1
fi

if ! git diff --quiet "origin/$BASE" "$BASE" -- 2>/dev/null; then
  :
fi

ahead=$(git rev-list --count "origin/$BASE..$BASE" 2>/dev/null || echo 0)
if [ "$ahead" -eq 0 ]; then
  echo "Nothing to push: $BASE has no commits ahead of origin/$BASE." >&2
  exit 1
fi

branch_name="sync/$(date +%Y%m%d-%H%M%S)"
last_msg=$(git log -1 --pretty=%s)

echo "Creating branch $branch_name from $BASE..."
git checkout -b "$branch_name"
git push -u origin "$branch_name"

echo "Opening PR into $BASE..."
pr_url=$(gh pr create --repo "$REPO" --base "$BASE" --head "$branch_name" \
  --title "$last_msg" \
  --body "Auto-opened by git-sync.sh")
echo "PR: $pr_url"
pr_number=$(basename "$pr_url")

echo "Waiting for required checks..."
gh pr checks "$pr_number" --repo "$REPO" --watch --fail-fast || {
  echo "Checks did not pass. PR left open for review: $pr_url" >&2
  git checkout "$BASE"
  exit 1
}

echo "Merging PR #$pr_number..."
gh pr merge "$pr_number" --repo "$REPO" --merge --delete-branch

git checkout "$BASE"
git pull origin "$BASE"

echo "Done. $BASE is up to date with your changes merged."
