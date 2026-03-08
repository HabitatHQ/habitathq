#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Building renderer ==="
pnpm exec vite build

echo "=== Building Electron main/preload ==="
pnpm exec tsc --project tsconfig.electron.json
mkdir -p electron/dist
echo '{"type":"commonjs"}' > electron/dist/package.json

echo "=== Running Playwright tests ==="
pnpm exec playwright test --reporter=line 2>&1

echo "=== Done ==="
