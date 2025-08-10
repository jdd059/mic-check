#!/bin/bash
set -e

# --- detect shell config file (zsh on modern macOS, else bash) ---
SHELL_CONFIG="$HOME/.zshrc"
if [ -n "$BASH_VERSION" ] || [[ "$SHELL" == *"bash"* ]]; then
  SHELL_CONFIG="$HOME/.bashrc"
fi

echo "Using shell config: $SHELL_CONFIG"

# --- ensure NVM is installed ---
if ! command -v nvm >/dev/null 2>&1; then
  echo "Installing NVM..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi

# load NVM for current session
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# --- ensure .nvmrc exists and targets Node 18 (Cloudflare) ---
if [ ! -f .nvmrc ]; then
  echo "18" > .nvmrc
  echo "Created .nvmrc with Node 18"
fi

# --- install & use Node per .nvmrc ---
echo "Installing/using Node $(cat .nvmrc)..."
nvm install
nvm use

# --- install AVN (auto version switcher) if missing ---
if ! command -v avn >/dev/null 2>&1; then
  echo "Installing AVN..."
  npm install -g avn avn-nvm avn-n
else
  echo "AVN already installed."
fi

# ensure AVN hook is in shell config
if ! grep -qs 'avn.sh' "$SHELL_CONFIG"; then
  echo '[[ -s "$HOME/.avn/bin/avn.sh" ]] && source "$HOME/.avn/bin/avn.sh"' >> "$SHELL_CONFIG"
  echo "Added AVN hook to $SHELL_CONFIG"
fi

# source it now so AVN works immediately in this session
if [ -s "$HOME/.avn/bin/avn.sh" ]; then
  . "$HOME/.avn/bin/avn.sh"
fi

# --- install project dependencies ---
if [ -f package-lock.json ]; then
  echo "Installing dependencies from lockfile (npm ci)…"
  npm ci
else
  echo "No package-lock.json found — running npm install…"
  npm install
fi

echo "✅ Done. Node will auto-switch via AVN when you cd into this project (using .nvmrc)."
