#!/usr/bin/env bash
# Advisory-only validator wrapper for diagram-design artifacts.
# Graceful skip when python3 is absent (v1 must never block artifact rendering).
set -u
ARTIFACT="${1:-}"
if [ -z "$ARTIFACT" ]; then
  echo "usage: run-validators.sh <artifact.html>" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[diagram-design] python3 not found, skipping validators (advisory-only in v1)"
  exit 0
fi
DIR="$(cd "$(dirname "$0")" && pwd)"
STATUS=0
for script in self_check.py verify-geometry.py verify-motion.py; do
  if [ -f "$DIR/$script" ]; then
    python3 "$DIR/$script" "$ARTIFACT" || {
      rc=$?
      echo "[diagram-design] $script exited $rc (advisory — artifact not blocked)"
      STATUS=1
    }
  fi
done
exit 0  # advisory-only: never propagate validator failure to the caller
