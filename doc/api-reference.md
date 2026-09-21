# API Reference

## Authentication

All API routes except the NextAuth endpoints require an active session cookie. Routes that require admin access check `session.user.role === "ADMIN"`.

## HTTP Routes

### NextAuth

- **GET /api/auth/[...nextauth]**
- **POST /api/auth/[...nextauth]**

Standard NextAuth.js endpoints. The credentials provider accepts:

```json
{
  "email": "admin@example.com",
  "password": "admin123"
}
```

### Chats

#### GET /api/chats

Returns all chats ordered by most recent message.

**Access**: Any authenticated user.

**Response**:

```json
[
  {
    "id": "cuid",
    "remoteJid": "123456789@c.us",
    "name": "Contact Name",
    "profilePicUrl": null,
    "lastMessageAt": "2026-08-10T12:00:00.000Z",
    "createdAt": "2026-08-10T10:00:00.000Z",
    "updatedAt": "2026-08-10T12:00:00.000Z",
    "messages": [
      {
        "body": "Hello",
        "timestamp": "2026-08-10T12:00:00.000Z",
        "fromMe": false,
        "type": "text"
      }
    ]
  }
]
```

### Messages

#### GET /api/messages

Returns messages for a chat.

**Access**: Any authenticated user.

**Query parameters**:
- `chatId` — Chat ID (preferred)
- `remoteJid` — WhatsApp JID (fallback)

At least one parameter is required.

**Response**:

```json
[
  {
    "id": "cuid",
    "chatId": "cuid",
    "remoteJid": "123456789@c.us",
    "whatsappMessageId": "...",
    "fromMe": false,
    "body": "Hello",
    "type": "text",
    "mediaUrl": null,
    "mediaMimeType": null,
    "mediaCaption": null,
    "timestamp": "2026-08-10T12:00:00.000Z",
    "status": "received",
    "createdAt": "...",
    "updatedAt": "...",
    "sentById": null
  }
]
```

### Send Message

#### POST /api/send

Sends a WhatsApp message. Can be used to start a new chat with an unsaved number.

**Access**: Any authenticated user.

**Request body**:

```json
{
  "remoteJid": "123456789@c.us",
  "body": "Hello",
  "type": "text",
  "mediaBase64": "...",
  "mediaMimeType": "image/png",
  "mediaFilename": "image.png"
}
```

For text messages to a new number, only `remoteJid`, `body`, and `type` are required. Use the full JID format (`<number>@c.us`) or just the number with country code and the server will format it.

**Response**:

```json
{ "ok": true }
```

Error responses include status `401` (unauthorized), `503` (WhatsApp not ready), and `500` (send failure).

### WhatsApp Status

#### GET /api/whatsapp/status

Returns the current WhatsApp connection state.

**Access**: Any authenticated user.

**Response**:

```json
{
  "state": "ready",
  "qrSvg": null,
  "info": "WhatsApp client is ready."
}
```

#### POST /api/whatsapp/status

Performs an admin action on the WhatsApp session.

**Access**: Admin only.

**Request body**:

```json
{ "action": "logout" }
```

or

```json
{ "action": "reconnect" }
```

### Users

#### GET /api/users

Returns all users.

**Access**: Admin only.

#### POST /api/users

Creates a new user.

**Access**: Admin only.

**Request body**:

```json
{
  "email": "user@example.com",
  "name": "User Name",
  "password": "password",
  "role": "USER"
}
```

#### PATCH /api/users

Updates a user.

**Access**: Admin only.

**Request body**:

```json
{
  "id": "cuid",
  "email": "new@example.com",
  "name": "New Name",
  "role": "ADMIN",
  "active": true,
  "password": "newpassword"
}
```

All fields except `id` are optional.

#### DELETE /api/users

Deletes a user.

**Access**: Admin only.

**Query parameter**: `id`

Admins cannot delete their own account.

### Logs

#### GET /api/logs

Returns audit logs.

**Access**: Admin only.

**Query parameter**: `take` (max 500, default 100)

## Socket.io

Socket.io is available at path `/api/socket`.

### Client Connection

```typescript
import { io } from "socket.io-client";

const socket = io({
  path: "/api/socket",
  transports: ["websocket", "polling"],
});
```

### Server-to-Client Events

#### `whatsapp_state`

Sent on connection and whenever the WhatsApp state changes.

```json
{
  "state": "qr",
  "qrSvg": "<svg>...</svg>",
  "info": "Scan the QR code with WhatsApp on your phone."
}
```

Possible states: `initializing`, `qr`, `authenticated`, `ready`, `disconnected`, `auth_failure`.

#### `message`

Sent when a new message is persisted.

```json
{
  "id": "cuid",
  "chatId": "cuid",
  "remoteJid": "123456789@c.us",
  "fromMe": false,
  "body": "Hello",
  "type": "text",
  "timestamp": "2026-08-10T12:00:00.000Z",
  "chat": { ... }
}
```

#### `chat_update`

Sent when a chat record is created or updated.

```json
{
  "id": "cuid",
  "remoteJid": "123456789@c.us",
  "name": "Contact Name",
  "lastMessageAt": "2026-08-10T12:00:00.000Z"
}
```

### Client-to-Server Events

Currently, the server only emits events. Client actions should use the HTTP API.

---

## Travel Module API (`/api/travel/*`)

B2B travel package costing and quotation module. All routes require an authenticated session
with role `ADMIN`, `ADVISOR` or `VALIDATOR` (401 otherwise). Request bodies are zod-validated
(400 `{ error: [...] }`); business-rule failures return `{ error, code }` with an appropriate
status (409 for stale snapshot/revision conflicts). Money values are decimal strings; dates are
`YYYY-MM-DD` local calendar dates. See `doc/travel/IMPLEMENTATION.md`.

| Route | Methods | Role | Purpose |
|---|---|---|---|
| `/api/travel/requests` | GET, POST | travel roles | Search (q/status/owner/dates) and create requests; POST generates the immutable package code `CLIENTSHORT-YYYY-MM-DD-NNNN` |
| `/api/travel/requests/[id]` | GET, PATCH | travel roles | Detail (versions, scenarios, snapshot summary, assignments, decisions, documents); PATCH edits drafts with `expectedRevision` optimistic lock |
| `/api/travel/requests/[id]/submit` | POST | owner/ADMIN | DRAFT/CHANGES_REQUESTED → PENDING_VALIDATION; freezes calculation snapshot |
| `/api/travel/requests/[id]/assignments` | GET, POST | travel roles | Validator assignment history / assign validator (no self-assignment) |
| `/api/travel/requests/[id]/reassign` | POST | ADMIN | Reassign validator; former validator loses decision rights |
| `/api/travel/requests/[id]/versions` | POST | owner/ADMIN | Create a new draft revision (v02, ...) cloning latest content |
| `/api/travel/versions/[id]/calculate` | POST | travel roles | Engine preview (no snapshot persisted); optional policy override |
| `/api/travel/versions/[id]/content` | PUT | owner/ADMIN | Replace scenarios/stays/service lines/itinerary (draft statuses only) |
| `/api/travel/versions/[id]/review` | POST | assigned validator | APPROVE / REQUEST_CHANGES / REJECT bound to `snapshotHash` |
| `/api/travel/versions/[id]/issue` | POST | owner/ADMIN | Issue approved snapshot → client PDF; idempotent via `idempotencyKey` |
| `/api/travel/versions/[id]/outcome` | POST | owner/ADMIN | ACCEPTED (with scenario) / DECLINED / EXPIRED |
| `/api/travel/agencies`, `/api/travel/agencies/[id]` | GET, POST, PATCH | GET: travel roles; mutations: ADMIN | Client agencies and uppercase short codes; GET `?includeInactive=true` (ADMIN only) also lists deactivated ones |
| `/api/travel/catalog/hotels`, `/catalog/services`, `/catalog/rates` | GET | travel roles | Catalog with rates and verification status |
| `/api/travel/catalog/rates/[id]` | PATCH | ADMIN | Rate verification: NEEDS_REVIEW → VERIFIED → ARCHIVED (never delete) |
| `/api/travel/templates`, `/templates/[id]/instantiate` | GET, POST | travel roles | Package templates (ARM/GEO/COM codes); instantiate into a new request |
| `/api/travel/settings` | GET, PUT | GET: travel roles; PUT: ADMIN | Company timezone, reminders, escalation, policy activation |
| `/api/travel/policies`, `/api/travel/fx` | GET, POST | ADMIN | Pricing policy versions and effective-dated FX rates |
| `/api/travel/imports`, `/imports/[id]`, `/imports/[id]/verify` | GET, POST | ADMIN | Workbook import staging batches and row verification |
| `/api/travel/documents/[id]` | GET | travel roles (INTERNAL: ADMIN/VALIDATOR) | Authorized PDF download |
| `/api/travel/notifications`, `/notifications/retry`, `/notifications/process` | GET, POST | own / ADMIN | Delivery status, retry failed, manual queue processing |
| `/api/travel/batch` | POST | travel roles | Batch template pricing over PAX bands (default 2/4/6) |

### Socket.io: `travel_notification`

Server emits `travel_notification` when a workflow notification delivery changes status
(queued/sent/failed), so the UI can update badges live.
