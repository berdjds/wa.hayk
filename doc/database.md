# Database

WAControl uses Prisma with SQLite as the database. The schema is defined in `prisma/schema.prisma`.

## Models

### User

Stores authenticated users.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| email | String (unique) | User email |
| name | String? | Display name |
| password | String | Hashed password (bcrypt) |
| role | String | `ADMIN` or `USER` |
| active | Boolean | Whether the account is enabled |
| createdAt | DateTime | Record creation time |
| updatedAt | DateTime | Last update time |

**Relations**
- `logs`: audit logs created by the user.
- `messages`: messages sent through the dashboard.

### Chat

Represents a WhatsApp conversation.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| remoteJid | String (unique) | WhatsApp remote JID (e.g., `123456789@c.us`) |
| name | String? | Display name |
| profilePicUrl | String? | Profile picture URL |
| lastMessageAt | DateTime | Last activity timestamp |
| createdAt | DateTime | Record creation time |
| updatedAt | DateTime | Last update time |

**Relations**
- `messages`: messages belonging to the chat.

### Message

Stores individual WhatsApp messages.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| chatId | String | Foreign key to Chat |
| remoteJid | String | Sender/recipient JID |
| whatsappMessageId | String? (unique) | Original WhatsApp message ID |
| fromMe | Boolean | Whether the message was sent from the dashboard |
| body | String? | Message text |
| type | String | `text`, `image`, `voice`, `document`, `video`, `sticker`, `media`, or `unknown` |
| mediaUrl | String? | Path to saved media file |
| mediaMimeType | String? | MIME type of media |
| mediaCaption | String? | Caption or filename |
| timestamp | DateTime | Message timestamp |
| status | String | `received`, `sent`, `delivered`, `read`, or `failed` |
| createdAt | DateTime | Record creation time |
| updatedAt | DateTime | Last update time |
| sentById | String? | Local user who sent the message |

**Relations**
- `chat`: parent chat.
- `sentBy`: local sender (optional).

**Indexes**
- `@@index([chatId, timestamp])`

### Log

Audit log for admin actions.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| action | String | Action name (e.g., `SEND_MESSAGE`, `USER_CREATED`) |
| userId | String? | Acting user |
| details | String? | Additional details |
| createdAt | DateTime | Action timestamp |

**Relations**
- `user`: acting user (optional).

**Indexes**
- `@@index([createdAt])`

### WhatsAppSession

Tracks the WhatsApp connection state.

| Field | Type | Description |
|-------|------|-------------|
| id | String (CUID) | Primary key |
| sessionId | String (unique) | Session identifier, defaults to `default` |
| connected | Boolean | Whether the session is connected |
| info | String? | Status information |
| createdAt | DateTime | Record creation time |
| updatedAt | DateTime | Last update time |

## Prisma Client

The Prisma client is exported as a singleton from `lib/prisma.ts` to prevent multiple instances during hot reload in development.

```typescript
import { prisma } from "@/lib/prisma";
```
