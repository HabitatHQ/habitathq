#!/usr/bin/env bash
# Run app unit suites and maintained Palladium package tests affected by changes.
set -euo pipefail

if [[ $# -gt 1 ]]; then
    printf 'Usage: %s [base-ref]\n' "${0##*/}" >&2
    exit 2
fi
base=${1:-origin/main}
root=$(git rev-parse --show-toplevel)
cd "$root"
if ! git rev-parse --verify --quiet "$base^{commit}" >/dev/null; then
    printf 'Invalid base ref: %s\n' "$base" >&2
    exit 2
fi
if ! git merge-base "$base" HEAD >/dev/null; then
    printf 'Base ref %s has no merge base with HEAD.\n' "$base" >&2
    exit 2
fi

# Root dependency/config changes can affect any workspace package.
all=false
changed_dirs=$(mktemp)
selected=$(mktemp)
trap 'rm -f "$changed_dirs" "$selected"' EXIT

add_path() {
    local path=$1 dir
    case "$path" in
        package.json|pnpm-workspace.yaml|pnpm-lock.yaml|.npmrc|.node-version|mise.toml|tsconfig*.json|biome.json|biome.jsonc|Justfile|scripts/*|.github/workflows/*|.dependency-cruiser.cjs|semgrep.yml|libs/palladium/tsconfig.base.json)
            all=true
            return
            ;;
    esac
    if [[ "$path" == */package.json && ! -f "$path" ]]; then
        all=true
        return
    fi
    case "$path" in
        libs/palladium/*/*) dir=${path#libs/palladium/}; dir="libs/palladium/${dir%%/*}" ;;
        apps/*/*) dir=${path#apps/}; dir="apps/${dir%%/*}" ;;
        libs/*/*) dir=${path#libs/}; dir="libs/${dir%%/*}" ;;
        *) return ;;
    esac
    printf '%s\n' "$dir" >> "$changed_dirs"
}

while IFS= read -r -d '' path; do add_path "$path"; done < <(git diff --no-renames --name-only -z "$base...HEAD")
while IFS= read -r -d '' path; do add_path "$path"; done < <(git diff --no-renames --name-only -z HEAD)
while IFS= read -r -d '' path; do add_path "$path"; done < <(git ls-files --others --exclude-standard -z)

dirs=()
while IFS= read -r dir; do [[ -n "$dir" ]] && dirs+=("$dir"); done < <(sort -u "$changed_dirs")
if [[ $all == true ]]; then
    pnpm -r list --depth -1 --json > "$selected"
else
    filters=()
    for dir in "${dirs[@]}"; do filters+=(--filter "...{./$dir}"); done
    if [[ ${#filters[@]} -gt 0 ]]; then
        pnpm "${filters[@]}" -r list --depth -1 --json > "$selected"
    else
        printf 'No changed app or Palladium package sources since %s.\n' "$base"
        exit 0
    fi
fi

# pnpm supplies workspace membership and dependency/dependent closure. This
# small projection only separates app unit suites from Palladium package tests.
apps=()
palladium=()
suites=$(node - "$selected" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const row of rows) {
  const dir = path.relative(process.cwd(), row.path).replaceAll("\\", "/");
  if (/^apps\/(habitat|hearth|halcyon|hephaestus)$/.test(dir)) {
    console.log(`app\t${row.name}`);
  } else if (/^libs\/palladium\//.test(dir) && /^@palladium\//.test(row.name) &&
      !["@palladium/e2e", "@palladium/nuxt"].includes(row.name) &&
      !row.name.startsWith("@palladium/example-")) {
    console.log(`palladium\t${row.name}`);
  }
}
NODE
)
while IFS=$'\t' read -r kind name; do
    case "$kind" in
        app) apps+=("$name") ;;
        palladium) palladium+=("$name") ;;
    esac
done <<< "$suites"

if [[ ${#apps[@]} -eq 0 && ${#palladium[@]} -eq 0 ]]; then
    printf 'No affected app unit suites or maintained Palladium package tests.\n'
    exit 0
fi

# Applications and package tests consume generated workspace dist output.
just build-palladium-ts
if [[ ${#apps[@]} -gt 0 ]]; then
    filters=()
    for app in "${apps[@]}"; do filters+=(--filter "$app"); done
    pnpm "${filters[@]}" -r --if-present run test:unit
fi
if [[ ${#palladium[@]} -gt 0 ]]; then
    filters=()
    for package in "${palladium[@]}"; do filters+=(--filter "$package"); done
    pnpm "${filters[@]}" -r --if-present run test
fi
