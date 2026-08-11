# Setup

## Requirements

- Node.js 18 or later
- npm
- macOS, Linux, or Windows with a supported browser for Puppeteer

## Installation

1. Clone or navigate to the project directory.
2. Install dependencies:

   ```bash
   npm install
   ```

   This also runs `prisma generate` automatically via the `postinstall` script.

3. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

4. Review and update `.env`:

   ```env
   DATABASE_URL="file:./dev.db"
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_SECRET="change-me-in-production-min-32-characters"
   ADMIN_EMAIL="admin@example.com"
   ADMIN_PASSWORD="admin123"
   ```

   Generate a strong secret:

   ```bash
   openssl rand -base64 32
   ```

5. Create the database and seed the admin user:

   ```bash
   npm run db:push
   npm run db:seed
   ```

6. Start the development server:

   ```bash
   npm run dev
   ```

7. Open [http://localhost:3000](http://localhost:3000) and sign in with the credentials from `.env`.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the custom Next.js + Socket.io dev server |
| `npm run build` | Build the Next.js app for production |
| `npm run start` | Start the production server |
| `npm run db:push` | Push the Prisma schema to the SQLite database |
| `npm run db:seed` | Seed the admin user |
| `npm run db:reset` | Reset the database and re-seed |

## First WhatsApp Connection

1. Sign in as an admin.
2. Go to the admin dashboard.
3. Wait for the WhatsApp QR code to appear.
4. Open WhatsApp on your phone and scan the QR code.
5. The connection status changes to `ready` when linked.
6. In the dashboard, click **New message** to send a message to any phone number (with country code, e.g., `971552260263`).

## Notes

- The first startup downloads a Chromium browser for Puppeteer. On Linux servers, additional system dependencies may be required.
- The SQLite database file (`dev.db`) is created in the project root.
- Uploaded media is stored in `public/uploads/`.
- **Real-time messages only:** messages that arrive while the session is `ready` are saved and displayed. Older messages are not backfilled.
- **Phone must be online:** the mobile device does not need to be open, but it must have an internet connection for the WhatsApp Web session to receive messages.
