# Current Known Issues

> Last updated: 2026-08-11

This document tracks the current WhatsApp integration issues that affect message sync and sending in WAControl.

## Issue 1: WhatsApp state stuck at `authenticated`

**Symptom**
- The admin dashboard shows **State: authenticated** with the message "Authenticated. Loading chats...".
- The dashboard never reaches the `ready` state.
- Sending messages from the dashboard shows the toast: **"WhatsApp client not ready"**.

**Observed behavior**
- After the latest deployments, the WhatsApp session starts and reaches `authenticated`, but does not progress to `ready`.
- Earlier sessions did reach `ready`, so the difference is likely a stale session, a phone-side change, or a rate-limit/re-auth trigger from repeated restarts.

## Issue 2: New messages are not received

**Symptom**
- The dashboard shows **"No chats yet"** even when messages are sent to the linked WhatsApp number.
- The server logs do not show any `message_create` or `message` event logs after the startup sequence.

**Cause**
- WhatsApp Web events (`message_create`, `message`) only fire when the client is in the `ready` state.
- Because the client is stuck at `authenticated`, no message events are emitted and no messages are persisted to the database.

## Issue 3: Sending messages to new numbers fails

**Symptom**
- The **New message** dialog accepts a phone number and text, but clicking **Send** fails.
- The UI shows: **"WhatsApp client not ready"**.

**Cause**
- The `/api/send` endpoint checks `getWhatsAppState().state === "ready"` before sending.
- Since the client is stuck at `authenticated`, the endpoint returns HTTP 503 with that error.

## Issue 4: Historical messages do not sync

**Symptom**
- Existing chats and messages that existed before the session connected do not appear in the dashboard.

**Background**
- The original attempt used `client.getChats()` on `ready` to backfill recent chats and their last 50 messages.
- In the headless/Docker environment with `whatsapp-web.js` v1.23.0, `client.getChats()` consistently fails with a minified WhatsApp Web error (`r`), even with retries and long delays.
- The historical sync was removed in favor of real-time events, but this only works once the client reaches `ready`.

## Current status

- The client is **authenticated** but not **ready**.
- New messages, outgoing messages, and historical sync are all blocked until the client reaches `ready`.
- The rest of the application (login, admin panel, user management, Socket.io) is working correctly.

## Next steps to investigate

1. **Restore the WhatsApp session**
   - Click **Reconnect** in the admin panel and scan the QR code again.
   - Alternatively, click **Logout** and then **Reconnect** to force a fresh session.
   - Wait up to 2 minutes after scanning to see if the state changes to `ready`.

2. **Verify phone-side state**
   - Ensure the phone has an active internet connection.
   - Confirm that the WhatsApp account is not rate-limited or restricted.
   - In WhatsApp mobile settings, check that the linked device entry is active and not logged out.

3. **If the issue persists after reconnection**
   - Check the container logs for the exact sequence between `authenticated` and any later error or timeout.
   - Consider upgrading `whatsapp-web.js` to a newer version, or switching to the official WhatsApp Business Platform / Cloud API for reliable messaging.

## Related files

- `lib/whatsapp.ts` — WhatsApp client initialization and event handlers.
- `app/api/send/route.ts` — API endpoint for sending messages.
- `components/dashboard/ChatDashboard.tsx` — Dashboard UI with the New message dialog.
- `doc/troubleshooting.md` — General troubleshooting steps.
