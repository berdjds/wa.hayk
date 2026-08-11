# Deployment

## Important Disclaimer

WhatsApp Web automation through `whatsapp-web.js` is not an official WhatsApp API. Using it may violate WhatsApp's Terms of Service and can result in account restrictions or bans. For production workloads, use the official [WhatsApp Business Platform / Cloud API](https://business.whatsapp.com/products/business-platform).

## Environment Variables

Before deploying, set strong values for all required variables:

```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="<random-32-char-secret>"
ADMIN_EMAIL="admin@example.com"
ADMIN_PASSWORD="<strong-password>"
```

Generate a secure secret:

```bash
openssl rand -base64 32
```

## Build

```bash
npm install
npm run db:push
npm run db:seed
npm run build
npm run start
```

## Production Server

The production entry point is `server.ts`, started with `npm run start`. It runs the custom Next.js + Socket.io server on port `3000` (or `PORT` environment variable).

## Files to Protect

Never commit or expose these files:

- `.env`
- `.wwebjs_auth/`
- `.wwebjs_cache/`
- `dev.db`
- `public/uploads/`

These are already listed in `.gitignore`.

## Reverse Proxy (Recommended)

Place the Node.js server behind a reverse proxy such as Nginx or Traefik. Configure HTTPS termination and WebSocket support for Socket.io.

Example Nginx WebSocket configuration:

```nginx
location /api/socket/ {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Puppeteer on Linux

Puppeteer may require additional system dependencies on Linux servers. You can install them with the documented package list for Chromium or run Puppeteer with `--no-sandbox` (already configured in `lib/whatsapp.ts`).

## Docker Deployment

A `Dockerfile` is included in the project root. It uses a Node.js 20 base image and installs the system Chromium required by Puppeteer.

### Build the image

```bash
docker build -t wacontrol:latest .
```

### Environment variables for Docker

Add these to the VPS `.env` file:

```env
WACONTROL_NEXTAUTH_SECRET=<random-32-char-secret>
WACONTROL_ADMIN_EMAIL=admin@example.com
WACONTROL_ADMIN_PASSWORD=<strong-password>
```

### Add to an existing Traefik compose file

Append this service block to the existing `docker-compose.yml` on the VPS. It follows the same Traefik routing and rate-limiting pattern as the other Node apps.

```yaml
  wacontrol_app:
    image: wacontrol:latest
    container_name: wacontrol-app
    restart: always
    networks:
      - web
    environment:
      - NODE_ENV=production
      - HOSTNAME=0.0.0.0
      - DATABASE_URL=file:/app/data/dev.db
      - NEXTAUTH_URL=https://wa.hayk.ae
      - NEXTAUTH_SECRET=${WACONTROL_NEXTAUTH_SECRET}
      - ADMIN_EMAIL=${WACONTROL_ADMIN_EMAIL}
      - ADMIN_PASSWORD=${WACONTROL_ADMIN_PASSWORD}
      - PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
    volumes:
      - ./wacontrol-data:/app/data
      - ./wacontrol-uploads:/app/public/uploads
      - ./wacontrol-auth:/app/.wwebjs_auth
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.wacontrol.rule=Host(`wa.hayk.ae`)"
      - "traefik.http.routers.wacontrol.entrypoints=web"
      - "traefik.http.routers.wacontrol.middlewares=redirect-to-https"
      - "traefik.http.routers.wacontrol-secure.rule=Host(`wa.hayk.ae`)"
      - "traefik.http.routers.wacontrol-secure.entrypoints=websecure"
      - "traefik.http.routers.wacontrol-secure.tls.certresolver=le"
      - "traefik.http.routers.wacontrol-secure.middlewares=wacontrol-rate"
      - "traefik.http.middlewares.wacontrol-rate.ratelimit.average=10"
      - "traefik.http.middlewares.wacontrol-rate.ratelimit.burst=20"
      - "traefik.http.services.wacontrol.loadbalancer.server.port=3000"
    expose:
      - "3000"
```

### First run on the VPS

1. Copy the project source to the VPS.
2. Build the image: `docker build -t wacontrol:latest .`
3. Add the service block to `/root/productionapp/docker-compose.yml`.
4. Add the environment variables to `/root/productionapp/.env`.
5. Create host directories for persistence:

   ```bash
   mkdir -p /root/productionapp/wacontrol-data
   mkdir -p /root/productionapp/wacontrol-uploads
   mkdir -p /root/productionapp/wacontrol-auth
   ```

6. Start the container:

   ```bash
   cd /root/productionapp
   docker compose up -d wacontrol_app
   ```

7. The container entry point automatically runs `npm run db:push` on every start to ensure the SQLite schema exists.
8. Seed the admin user once:

   ```bash
   docker compose exec wacontrol_app npm run db:seed
   ```

### Notes

- The SQLite database lives in `./wacontrol-data/dev.db` on the host. Make sure the `DATABASE_URL` environment variable uses the absolute path `file:/app/data/dev.db` inside the container.
- Uploaded media is stored in `./wacontrol-uploads/`.
- The WhatsApp session is stored in `./wacontrol-auth/`; protect this directory.
- The container exposes port `3000` and relies on the existing `web` Docker network and Traefik container.
- WebSocket traffic for Socket.io uses path `/api/socket`; Traefik passes WebSocket upgrade headers automatically.
- **Real-time messages only:** messages that arrive while the session is `ready` are saved and displayed. Older messages are not backfilled.
- **Phone must be online:** the mobile device does not need to be open, but it must have an internet connection for the WhatsApp Web session to receive messages.
- Use the dashboard **New message** button to send messages to unsaved phone numbers.

## Scaling Notes

WAControl maintains the WhatsApp client as an in-memory singleton in `lib/whatsapp.ts`. It is designed for a single server instance. Scaling horizontally would require externalizing the WhatsApp session state and message queue.
