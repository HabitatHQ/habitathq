#!/usr/bin/env bash
# bootstrap.sh — Install mise, then let mise install all project tools, then
# warm pnpm + cargo workspaces. Idempotent and re-runnable.
#
# Usage: ./bootstrap.sh [--dry-run]
#   --dry-run, -n   show what would happen without making changes
set -euo pipefail

DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run|-n) DRY_RUN=1 ;;
        -h|--help)
            sed -n '2,7p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            printf 'Unknown argument: %s\n' "$arg" >&2
            exit 2
            ;;
    esac
done

readonly RED=$'\033[1;31m' GREEN=$'\033[1;32m' YELLOW=$'\033[1;33m' BLUE=$'\033[1;34m' RESET=$'\033[0m'

have()  { command -v "$1" &>/dev/null; }
step()  { printf '%s==>%s %s\n' "$BLUE"   "$RESET" "$*"; }
ok()    { printf '  %s\xE2\x9C\x93%s %s\n' "$GREEN"  "$RESET" "$*"; }
skip()  { printf '  %sSKIP%s %s\n'         "$YELLOW" "$RESET" "$*"; }
dry()   { printf '  %sDRY%s  would run: %s\n' "$BLUE" "$RESET" "$*"; }
die()   { printf '%sError:%s %s\n'         "$RED"   "$RESET" "$*" >&2; exit 1; }

# Run a command (no shell metacharacters), printing it first.
do_cmd() {
    if (( DRY_RUN )); then
        dry "$*"
    else
        printf '  $ %s\n' "$*"
        "$@"
    fi
}

OS="$(uname -s)"

# ── 1. mise ────────────────────────────────────────────────────────────────
step "mise (toolchain manager)"
if have mise; then
    skip "mise already installed ($(mise --version))"
else
    case "$OS" in
        Darwin)
            have brew || die "Homebrew not found. Install from https://brew.sh and re-run."
            do_cmd brew install mise
            ;;
        Linux)
            if have apt-get; then
                if (( DRY_RUN )); then
                    dry "apt-get update + install mise via mise.jdx.dev repository"
                else
                    sudo apt-get update -qq
                    sudo apt-get install -y -qq gpg curl
                    sudo install -dm 755 /etc/apt/keyrings
                    curl -fsSL https://mise.jdx.dev/gpg-key.pub \
                        | gpg --dearmor \
                        | sudo tee /etc/apt/keyrings/mise-archive-keyring.gpg > /dev/null
                    printf 'deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg arch=amd64] https://mise.jdx.dev/deb stable main\n' \
                        | sudo tee /etc/apt/sources.list.d/mise.list > /dev/null
                    sudo apt-get update -qq
                    sudo apt-get install -y -qq mise
                fi
            else
                step "apt-get not found; using mise installer script"
                if (( DRY_RUN )); then
                    dry "curl -fsSL https://mise.run | sh"
                else
                    curl -fsSL https://mise.run | sh
                    export PATH="$HOME/.local/bin:$PATH"
                fi
            fi
            ;;
        *)
            die "Unsupported OS: $OS. See https://mise.jdx.dev/getting-started.html"
            ;;
    esac
    if ! (( DRY_RUN )); then
        have mise || die "mise installation failed"
        ok "mise installed ($(mise --version))"
    fi
fi

# Activate mise for this shell session so subsequent steps see node/pnpm/cargo.
if ! (( DRY_RUN )); then
    eval "$(mise activate bash 2>/dev/null || true)"
fi

# ── 2. Project tools (declared in mise.toml) ──────────────────────────────
step "Project tools via mise (node, pnpm, just, rust, cargo-deny, cargo-audit, cargo-machete)"
do_cmd mise install

# ── 3. pnpm workspace deps ────────────────────────────────────────────────
step "pnpm workspace dependencies"
if [[ -d node_modules ]]; then
    skip "node_modules exists — run 'pnpm install' manually if you suspect drift"
else
    do_cmd pnpm install
fi

# ── 4. Cargo workspace warmup ─────────────────────────────────────────────
step "Cargo workspace check (warms target cache)"
if [[ -d target ]]; then
    skip "target/ exists — run 'cargo check --workspace' manually to refresh"
else
    do_cmd cargo check --workspace
fi

# ── 5. Doctor ──────────────────────────────────────────────────────────────
if [[ -x scripts/doctor.sh ]]; then
    step "Toolchain health check"
    if (( DRY_RUN )); then
        dry "scripts/doctor.sh"
    else
        scripts/doctor.sh || true
    fi
fi

# ── Summary ────────────────────────────────────────────────────────────────
printf '\n'
if (( DRY_RUN )); then
    printf '%sDry run complete.%s No changes made.\n' "$GREEN" "$RESET"
else
    printf '%sBootstrap complete.%s\n' "$GREEN" "$RESET"
    printf 'Add mise to your shell profile if you have not already:\n'
    printf "  echo 'eval \"\$(mise activate bash)\"' >> ~/.bashrc\n"
    printf "  echo 'eval \"\$(mise activate zsh)\"'  >> ~/.zshrc\n"
    printf '\nNext:\n'
    printf '  just              # list recipes\n'
    printf '  just doctor       # toolchain check\n'
    printf '  just verify <pkg> # verify a single package\n'
fi
