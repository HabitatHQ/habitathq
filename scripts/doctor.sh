#!/usr/bin/env bash
# Habitat monorepo — toolchain doctor.
# Reports installed versions and flags mismatches against mise.toml.
set -euo pipefail

readonly RED=$'\033[31m' GREEN=$'\033[32m' YELLOW=$'\033[33m' RESET=$'\033[0m'

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Parse [tools] from mise.toml into want[name]=version.
declare -A want=()
if [[ -f "$root/mise.toml" ]]; then
    while IFS= read -r line; do
        [[ "$line" =~ ^[[:space:]]*([A-Za-z0-9_:-]+)[[:space:]]*=[[:space:]]*\"([^\"]+)\" ]] || continue
        want["${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
    done < <(awk '/^\[tools\]/{p=1;next} /^\[/{p=0} p' "$root/mise.toml")
fi

fail=0
report() {
    local label="$1" actual="$2" expected="${3:-}"
    if [[ -z "$actual" ]]; then
        printf '  %s✗%s  %-8s not installed\n' "$RED" "$RESET" "$label"
        return 1
    fi
    if [[ -n "$expected" && "$expected" != latest && "$expected" != stable ]]; then
        if [[ "$actual" != *"$expected"* ]]; then
            printf '  %s⚠%s  %-8s %s  (mise wants %s)\n' "$YELLOW" "$RESET" "$label" "$actual" "$expected"
            return 0
        fi
    fi
    printf '  %s✓%s  %-8s %s\n' "$GREEN" "$RESET" "$label" "$actual"
}

printf 'Habitat monorepo — toolchain doctor\n\n'

node_v=$(node --version 2>/dev/null || true)
report node "$node_v" "${want[node]:-}" || fail=1

pnpm_v=$(pnpm --version 2>/dev/null || true)
report pnpm "$pnpm_v" "${want[pnpm]:-}" || fail=1

just_v=$(just --version 2>/dev/null | awk '{print $2}' || true)
report just "$just_v" "${want[just]:-}" || fail=1

rust_v=$(rustc --version 2>/dev/null | awk '{print $2}' || true)
report rust "$rust_v" "${want[rust]:-}" || fail=1

cargo_v=$(cargo --version 2>/dev/null | awk '{print $2}' || true)
report cargo "$cargo_v" "${want[cargo]:-}" || fail=1

mise_v=$(mise --version 2>/dev/null || true)
report mise "$mise_v" "" || true

printf '\n'
if (( fail )); then
    printf "%sFAIL%s  Toolchain missing tools — run 'mise install' to fix.\n" "$RED" "$RESET"
    exit 1
fi
printf '%sOK%s    Toolchain healthy.\n' "$GREEN" "$RESET"
