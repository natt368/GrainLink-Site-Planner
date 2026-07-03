#!/bin/bash
# Script to synchronize AI Studio workspace changes to GitHub

# Ensure we are on the main branch
git checkout main >/dev/null 2>&1 || exit 0

# Stage all changes
git add -A >/dev/null 2>&1

# Determine commit message
MESSAGE="Sync changes from AI Studio"
if [ ! -z "$1" ]; then
  MESSAGE="$1"
fi

# Commit changes
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")

if git commit -m "$MESSAGE" >/dev/null 2>&1; then
  # Pull remote changes with rebase first to prevent non-fast-forward conflicts
  if [ ! -z "$GITHUB_TOKEN" ] && [ ! -z "$REMOTE_URL" ]; then
    AUTH_URL=$(echo "$REMOTE_URL" | sed -e "s~https://~https://${GITHUB_TOKEN}@~")
    git pull --rebase "$AUTH_URL" main >/dev/null 2>&1 || true
    git push "$AUTH_URL" main >/dev/null 2>&1 || true
  else
    git pull --rebase origin main >/dev/null 2>&1 || true
    git push origin main >/dev/null 2>&1 || true
  fi
else
  if [ ! -z "$GITHUB_TOKEN" ] && [ ! -z "$REMOTE_URL" ]; then
    AUTH_URL=$(echo "$REMOTE_URL" | sed -e "s~https://~https://${GITHUB_TOKEN}@~")
    git pull --rebase "$AUTH_URL" main >/dev/null 2>&1 || true
    git push "$AUTH_URL" main >/dev/null 2>&1 || true
  else
    git pull --rebase origin main >/dev/null 2>&1 || true
    git push origin main >/dev/null 2>&1 || true
  fi
fi

exit 0
