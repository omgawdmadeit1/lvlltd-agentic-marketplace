#!/bin/sh
# Build static assets for the Cloudflare Worker (mirrors Vercel: public/ + media/)
set -e; cd "$(dirname "$0")"; rm -rf assets; mkdir -p assets node_modules
cp -r ../public/. assets/; cp -r ../media assets/
