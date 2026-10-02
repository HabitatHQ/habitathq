#!/bin/sh
# Prepare independent dependencies and generated artifacts for this checkout.
set -eu

if [ "$#" -ne 0 ]; then
    printf 'Usage: %s\n' "$(basename "$0")" >&2
    exit 2
fi

root=$(git rev-parse --show-toplevel)
cd "$root"
root=$(pwd -P)

if [ -L "$root/node_modules" ]; then
    printf '%s\n' \
        "Refusing to continue: $root/node_modules is a symbolic link." \
        'Inspect the link and replace it manually with a regular node_modules directory, then rerun setup.' \
        'This script will not remove or overwrite the link or its target.' >&2
    exit 1
fi

# Keep Rust artifacts in this checkout even when mise exported another worktree's path.
CARGO_TARGET_DIR="$root/target"
export CARGO_TARGET_DIR

pnpm install --frozen-lockfile
just build-palladium-ts

for app in habitat hearth halcyon hephaestus; do
    pnpm --filter "$app" exec nuxt prepare
done
