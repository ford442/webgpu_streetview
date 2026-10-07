#!/usr/bin/env bash
# One-command sync: pull, stage TRACKED files only, commit, push.
#
# Usage: ./git.sh "what changed"      (message is required; no more "push fix")
#
# `git add -u` never picks up new untracked files (.env, screenshots, tarballs).
# To add a new file on purpose: `git add path/to/file` first, then run this.
set -euo pipefail

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "usage: ./git.sh \"commit message\"" >&2
  exit 2
fi

git pull
git add -u
git status --short
git commit -m "$MSG"
git push
