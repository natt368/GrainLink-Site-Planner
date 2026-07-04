#!/bin/bash
# Script to synchronize AI Studio workspace changes to GitHub

echo "Starting manual git synchronization..."

# Ensure we are on the main branch
git checkout main || { echo "Failed to checkout main branch"; exit 1; }

# Stage all changes
echo "Staging changes..."
git add -A

# Ensure user identity is configured
if ! git config user.email >/dev/null 2>&1; then
  echo "Configuring default local git email..."
  git config --local user.email "nat@grainlink.com"
fi
if ! git config user.name >/dev/null 2>&1; then
  echo "Configuring default local git name..."
  git config --local user.name "nat"
fi

# Determine commit message
MESSAGE="Sync changes from AI Studio"
if [ ! -z "$1" ]; then
  MESSAGE="$1"
fi

# Apply GITHUB_TOKEN if present
if [ ! -z "$GITHUB_TOKEN" ]; then
  echo "Applying GITHUB_TOKEN authentication..."
  git config --local url."https://${GITHUB_TOKEN}@github.com/".insteadOf "https://github.com/" || true
fi

# Attempt to commit
echo "Committing changes..."
if git commit -m "$MESSAGE"; then
  echo "Changes committed successfully."
else
  echo "No local changes to commit (or commit skipped)."
fi

# Pull remote changes with rebase first to prevent non-fast-forward conflicts
echo "Pulling remote changes..."
if ! git pull --rebase origin main; then
  echo "Failed to pull remote changes from GitHub."
  exit 1
fi

# Push to GitHub
echo "Pushing changes to GitHub..."
if ! git push origin main; then
  echo "Failed to push changes to GitHub."
  exit 1
fi

echo "Manual synchronization completed successfully!"
exit 0
