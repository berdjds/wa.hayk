# Troubleshooting

## Cannot start the app

### `dev.db` not found

Run the database initialization commands:

```bash
npm run db:push
npm run db:seed
```

### Port already in use

Set the `PORT` environment variable:

```bash
PORT=3001 npm run dev
```

### Puppeteer fails to launch

Ensure Chromium dependencies are installed. On Debian/Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
```

The app already runs Chromium with `--no-sandbox`, which helps in containerized environments.

## Cannot scan QR code

- Ensure the WhatsApp session state is `qr`.
- Refresh the admin dashboard page.
- If the QR code expires before scanning, click **Reconnect** to generate a new one.
- Check that the server clock is accurate.

## Messages are not received

- Verify the WhatsApp state is `ready` on the admin dashboard.
- Check the server logs for `persistMessage error` messages.
- Ensure the `Message` table exists: `npx prisma db pull` and compare with `prisma/schema.prisma`.
- Restart the server if the WhatsApp Web page becomes unresponsive.
- Make sure the WhatsApp mobile app is connected to the internet (it does not need to be open, but it must be online).

## Older messages are not showing

WAControl receives messages in real time while the WhatsApp session is `ready`. It does **not** backfill historical messages that were sent or received before the session became ready. This is the same behavior as opening WhatsApp Web in a browser.

## Messages are not sent

- Verify the WhatsApp state is `ready`.
- Check the response from `POST /api/send` for error messages.
- Ensure the recipient JID is valid (e.g., `123456789@c.us` or `123456789@g.us` for groups).
- Check server logs for Puppeteer or `sendWhatsAppMessage` errors.

## Login fails

- Confirm the seeded admin credentials in `.env` match what you are entering.
- Verify `NEXTAUTH_SECRET` is set.
- If you changed `ADMIN_PASSWORD` after seeding, the database still has the old hashed password. Run `npm run db:reset` or update the user directly in the database.

## Socket.io not connecting

- Check that the client connects to the same origin and path `/api/socket`.
- Ensure the reverse proxy supports WebSocket upgrade if used.
- Look for CORS errors in the browser console.

## Database migration issues

For a fresh database:

```bash
npm run db:reset
```

This will drop all data and re-seed the admin user.

## General debugging

Enable verbose logging by checking server console output. Common error sources:

- WhatsApp Web DOM changes breaking `whatsapp-web.js` selectors.
- Puppeteer timeouts due to slow network or resource limits.
- Missing or stale Prisma client — run `npx prisma generate`.
