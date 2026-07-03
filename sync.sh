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
if [ ! -z "$GITHUB_TOKEN" ]; then
  git config --local url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" >/dev/null 2>&1 || true
fi

if git commit -m "$MESSAGE" >/dev/null 2>&1; then
  # Pull remote changes with rebase first to prevent non-fast-forward conflicts
  git pull --rebase origin main >/dev/null 2>&1 || true
  # Push to GitHub
  git push origin main >/dev/null 2>&1 || true
else
  git pull --rebase origin main >/dev/null 2>&1 || true
  git push origin main >/dev/null 2>&1 || true
fi

exit 0
