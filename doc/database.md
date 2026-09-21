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

## Travel module tables (additive)

Agency, PackageCodeCounter (transactional package-code sequences), TravelRequest (immutable
`packageCode`), QuoteVersion, Scenario, StaySegment, ItineraryDay, ServiceLine, Supplier,
HotelProduct, VehicleType, ServiceProduct, RateVersion (verification lifecycle
NEEDS_REVIEW → VERIFIED → ARCHIVED), FXRateVersion, PricingPolicyVersion, CalculationSnapshot
(immutable inputs/results + sha256 hash), ValidationAssignment, ReviewDecision, WorkflowEvent,
NotificationDelivery (outbox, unique dedupKey), QuoteDocument (hash-recorded PDFs on disk),
ImportBatch/ImportRow (workbook staging), BatchRun, PackageTemplate/TemplateVersion,
TravelSettings (singleton). `User` gained a nullable `phone` (WhatsApp notification
destination) and role values ADVISOR/VALIDATOR. Money and FX values are decimal strings; JSON
payloads are String columns. See `prisma/schema.prisma` comments and `lib/travel/contracts.ts`.

`TravelRequest.travelers` is a JSON `TravelerSetup` string: counts (adults, children, infants,
paying, complimentary, leaders, staff) plus an optional `childAges` number array (age of each
child at return, 0–12; one entry per child, validated by `travelerSchema` in
`lib/travel/workflow.ts`).

Phase 3/4 additions: `ServiceLine` gained nullable `serviceProductId` (catalog link) and `date`
(YYYY-MM-DD) columns — a linked line is shared (`scenarioId = null`), keeps `unitRate = null`,
and is priced from SERVICE RateVersions covering its date. `ItineraryDay.services` items are
now `{ serviceProductId: string | null; label: string }` objects; legacy plain-string arrays
are normalized on read by `normalizeDayServices()`.

Per-vehicle pricing addition: `ServiceLine` gained a nullable `vehicleTypeId` (indexed;
selected fleet vehicle for the line). SERVICE RateVersions may carry a `vehicleTypeId` —
transportation products hold one VERIFIED priority-1 row per vehicle type (seeded equal to
the priority-0 vehicle-agnostic base rate until fleet-specific prices are entered).
Resolution prefers the line's vehicle rows, falling back to the base row. VehicleType names
follow the fleet vocabulary: Sedan / Minivan / Sprinter / Big bus.
