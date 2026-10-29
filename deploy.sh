#!/usr/bin/env bash
# Run on the VPS to pull the latest code from GitHub and restart the app: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only
npm install
npm run build
pm2 restart autoreels
pm2 status autoreels
