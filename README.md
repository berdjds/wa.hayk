# WAControl

A web dashboard to read and send WhatsApp messages using WhatsApp Web (QR-code login). Includes admin configuration, user management, and audit logs.

## Features

- **WhatsApp QR-code login** — scan the QR code with your phone to link the session.
- **Real-time messaging** — incoming/outgoing messages sync via Socket.io.
- **Text, image, voice, document** — send and view media messages.
- **Admin panel** — manage WhatsApp connection, users, and logs.
- **Role-based login** — admin and regular users.

## Stack

- Next.js 14 App Router + TypeScript
- TailwindCSS + shadcn/ui-style components
- NextAuth (credentials) for authentication
- Prisma + SQLite
- whatsapp-web.js + Puppeteer
- Socket.io

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy environment variables:
   ```bash
   cp .env.example .env
   ```

3. Create the database and seed the admin user:
   ```bash
   npm run db:push
   npm run db:seed
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open http://localhost:3000 and sign in with the seeded admin credentials (see `.env`).

## Important notes

- **WhatsApp Web is not an official API.** Using it may violate WhatsApp's Terms of Service and can lead to account restrictions. For production, consider the official [WhatsApp Business Platform / Cloud API](https://business.whatsapp.com/products/business-platform).
- The first startup downloads a Chromium browser for Puppeteer. On Linux servers you may need to install additional system dependencies.
- Keep `.wwebjs_auth/` and `.env` secret — they contain the WhatsApp session and admin credentials.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./dev.db` | SQLite database path |
| `NEXTAUTH_URL` | `http://localhost:3000` | App URL |
| `NEXTAUTH_SECRET` | — | Random secret for JWT signing |
| `ADMIN_EMAIL` | `admin@example.com` | Seeded admin email |
| `ADMIN_PASSWORD` | `admin123` | Seeded admin password |

## Scripts

- `npm run dev` — start the app with the custom Socket.io server
- `npm run build` — build the Next.js app
- `npm run start` — run the production server
- `npm run db:push` — apply the Prisma schema
- `npm run db:seed` — seed the admin user
