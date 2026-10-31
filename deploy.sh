#!/usr/bin/env bash
# Run on the VPS to pull the latest code from GitHub and restart the app: bash deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
# The VPS never holds code edits; reset so lockfile churn from npm install can't block updates.
# data/ and .env are gitignored and left alone.
git fetch origin main
git reset --hard origin/main
# ffmpeg puts the music picked at scheduling time into the videos.
command -v ffmpeg >/dev/null || sudo apt-get install -y ffmpeg
npm install
npm run build
pm2 restart autoreels
pm2 status autoreels
