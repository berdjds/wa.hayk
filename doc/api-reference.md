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

Sends a WhatsApp message.

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

For text messages, only `remoteJid`, `body`, and `type` are required.

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
