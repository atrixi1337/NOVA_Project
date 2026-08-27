#!/usr/bin/env bash
# push-to-github.sh — push the local commit to GitHub.
#
# The GitHub token is NEVER typed into the command line. It must be provided via:
#   (a) the GITHUB_PAT env var, or
#   (b) a line `GITHUB_PAT=ghp_...` in .env  (gitignored — safe to store here).
#
# Usage:
#   GITHUB_PAT=ghp_xxx bash push-to-github.sh      # pass via env
#   bash push-to-github.sh                          # reads GITHUB_PAT from ./.env
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

# Load GITHUB_PAT from .env if present (kept out of git by .gitignore).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${GITHUB_PAT:?Set GITHUB_PAT in your environment or add it to .env first.}"

# Build the URL with the token, then strip credentials from any output so the
# secret is never echoed.
URL="https://atrixi1337:${GITHUB_PAT}@github.com/atrixi1337/NOVA_Project.git"

git push "$URL" master 2>&1 | sed 's|https://[^:]\+:[^@]\+@|https://atrixi1337:<redacted>@|g'
echo "push complete: https://github.com/atrixi1337/NOVA_Project"
