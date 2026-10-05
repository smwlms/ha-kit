#!/bin/sh
# Point git at the versioned hooks in .githooks/ (run once after cloning).
set -e
cd "$(git rev-parse --show-toplevel)"
chmod +x .githooks/*
git config core.hooksPath .githooks
echo "hooks active: $(git config core.hooksPath)"
if [ ! -f "${HA_KIT_DENYLIST:-$HOME/.config/ha-kit/denylist.txt}" ]; then
  echo "note: no denylist found; the pre-commit scan only runs the fixed patterns (see CONTRIBUTING.md, Privacy)." >&2
fi
