# Security

## Known Risks

### Dependency Vulnerabilities

The project currently depends on older package versions with known security advisories:

- `next` 14.0.4 — multiple critical advisories (SSRF, cache poisoning, authorization bypass, XSS).
- `@auth/core` via `next-auth` / `@auth/prisma-adapter` — critical authentication advisories.
- `sharp` <0.35.0 — libvips CVEs.
- `puppeteer` → `tar-fs`, `ws` — path traversal and DoS.
- `postcss` via `next` — XSS / arbitrary file read.
- `cookie` <0.7.0 — OOB cookie characters.

Run `npm audit` and upgrade dependencies before production use.

### Credentials and Secrets

- Change `NEXTAUTH_SECRET` to a strong random value.
- Change the seeded `ADMIN_PASSWORD` before deployment.
- Do not commit `.env` or `.wwebjs_auth/`.

### WhatsApp Session

The `.wwebjs_auth/` directory contains the authenticated WhatsApp session. Anyone with access to it can impersonate the linked WhatsApp account. Protect it with filesystem permissions and backups.

### CORS

The Socket.io server and `/api/socket` headers allow all origins (`*`). For production, restrict this to your actual domain.

### Input Validation

- API routes use Zod schemas for incoming request bodies.
- File uploads (media messages) are saved with random UUID filenames but should be validated for size and type before deployment.
- Uploaded media is served from `/uploads/` under `public/uploads/`. Consider adding authentication or moving uploads outside the public directory in production.

### Rate Limiting

There is no built-in rate limiting on API routes or the WhatsApp send endpoint. Add rate limiting (e.g., with `rate-limiter-flexible` or a reverse proxy) before public deployment.

### HTTPS

Always serve the application over HTTPS in production. Set `NEXTAUTH_URL` to the HTTPS URL.

### Admin Access

Any user with `ADMIN` role can manage users and the WhatsApp session. Ensure admin accounts are protected with strong passwords and ideally multi-factor authentication if extended.

## Security Checklist Before Production

- [ ] Upgrade all dependencies and resolve `npm audit` findings.
- [ ] Generate strong `NEXTAUTH_SECRET` and `ADMIN_PASSWORD`.
- [ ] Serve over HTTPS with a valid certificate.
- [ ] Restrict CORS origins.
- [ ] Add rate limiting and input size limits.
- [ ] Move uploaded media outside `public/` or protect `/uploads/`.
- [ ] Back up `.wwebjs_auth/` securely.
- [ ] Review Puppeteer sandbox settings for your hosting environment.
