#!/usr/bin/env bash
# bootstrap.sh — Install mise, then let mise install all project tools (just,
# pnpm, cargo, node, etc.) as declared in mise.toml.
set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

have() { command -v "$1" &>/dev/null; }

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
die()   { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

# ── Detect OS ─────────────────────────────────────────────────────────────────

OS="$(uname -s)"

# ── Install mise ──────────────────────────────────────────────────────────────

if have mise; then
  ok "mise already installed ($(mise --version))"
else
  info "Installing mise"

  case "$OS" in
    Darwin)
      if have brew; then
        brew install mise
      else
        die "Homebrew not found. Install it from https://brew.sh and re-run."
      fi
      ;;
    Linux)
      if have apt-get; then
        # Official mise apt repository (https://mise.jdx.dev/packages/apt.html)
        sudo apt-get update -qq
        sudo apt-get install -y -qq gpg curl
        sudo install -dm 755 /etc/apt/keyrings
        curl -fsSL https://mise.jdx.dev/gpg-key.pub \
          | gpg --dearmor \
          | sudo tee /etc/apt/keyrings/mise-archive-keyring.gpg > /dev/null
        echo "deb [signed-by=/etc/apt/keyrings/mise-archive-keyring.gpg arch=amd64] \
https://mise.jdx.dev/deb stable main" \
          | sudo tee /etc/apt/sources.list.d/mise.list > /dev/null
        sudo apt-get update -qq
        sudo apt-get install -y -qq mise
      else
        # Fallback: official install script (curl | sh)
        info "apt-get not found; using mise installer script"
        curl -fsSL https://mise.run | sh
        # The installer writes to ~/.local/bin; add it to PATH for this session.
        export PATH="$HOME/.local/bin:$PATH"
      fi
      ;;
    *)
      die "Unsupported OS: $OS. See https://mise.jdx.dev/getting-started.html"
      ;;
  esac

  have mise || die "mise installation failed"
  ok "mise installed ($(mise --version))"
fi

# ── Activate mise for this shell session ──────────────────────────────────────
# (mise shims / env vars are needed for the `mise install` step below)

eval "$(mise activate bash 2>/dev/null || true)"

# ── Install all tools declared in mise.toml ───────────────────────────────────

info "Installing project tools via mise (just, pnpm, node, rust/cargo, …)"
mise install

ok "All tools installed"

# ── Summary ───────────────────────────────────────────────────────────────────

printf '\n\033[1;32mBootstrap complete.\033[0m\n'
printf 'Add mise to your shell profile if you have not already:\n'
printf '  echo '\''eval "$(mise activate bash)"'\'' >> ~/.bashrc  # bash\n'
printf '  echo '\''eval "$(mise activate zsh)"'\''  >> ~/.zshrc   # zsh\n'
printf '\nThen open a new shell and run:\n'
printf '  just      # list available recipes\n'
printf '  just ci   # lint + test + deny + audit\n'
