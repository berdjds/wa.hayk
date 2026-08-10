#!/bin/sh
set -e

# Ensure the Prisma schema is applied to the SQLite database before starting.
npm run db:push -- --accept-data-loss

# Clear Chromium session locks from any previous container so the browser can start.
find /app/.wwebjs_auth -type f \( -name "SingletonLock" -o -name "SingletonSocket" -o -name "SingletonCookie" \) -delete 2>/dev/null || true
find /app/.wwebjs_auth -type l -name "SingletonLock" -delete 2>/dev/null || true

exec "$@"
