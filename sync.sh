#!/bin/bash
# Script to synchronize AI Studio workspace changes to GitHub

# Ensure we are on the main branch
git checkout main

# Stage all changes
git add -A

# Determine commit message
MESSAGE="Sync changes from AI Studio"
if [ ! -z "$1" ]; then
  MESSAGE="$1"
fi

# Commit changes
if git commit -m "$MESSAGE"; then
  # Push to GitHub
  git push origin main
else
  echo "No changes to commit."
fi
