# Components and Hooks

## UI Components

Base components are located in `components/ui/`. They follow the shadcn/ui pattern using Radix UI primitives and TailwindCSS.

| Component | Purpose |
|-----------|---------|
| `button.tsx` | Button variants |
| `input.tsx` | Text input |
| `textarea.tsx` | Multiline text input |
| `label.tsx` | Form labels |
| `card.tsx` | Card container |
| `dialog.tsx` | Modal dialogs |
| `select.tsx` | Dropdown select |
| `tabs.tsx` | Tab navigation |
| `avatar.tsx` | User/chat avatars |
| `badge.tsx` | Status badges |
| `toast.tsx` | Toast notifications |

All UI components use `cn()` from `lib/utils.ts` to merge Tailwind classes.

## Page Components

### `app/login/page.tsx`

Client-side login form. Handles credential submission and redirects on success.

### `app/admin/page.tsx`

Server component that verifies the `ADMIN` role and renders `AdminDashboard`.

### `app/dashboard/page.tsx`

Server component that verifies authentication and renders `ChatDashboard`, passing `isAdmin` flag.

## Feature Components

### `components/admin/AdminDashboard.tsx`

Admin dashboard for:
- Viewing WhatsApp connection status and QR code.
- Controlling logout/reconnect actions.
- Managing users (create, update, delete, activate/deactivate).
- Viewing audit logs.

### `components/dashboard/ChatDashboard.tsx`

Main chat interface for:
- Listing chats and latest messages.
- Viewing message history.
- Sending text and media messages.
- Marking chats as read.

## Hooks

### `hooks/useSocket.ts`

React hook for Socket.io connection.

```typescript
import { useSocket } from "@/hooks/useSocket";

const { socket, connected, whatsAppState, lastEvent } = useSocket();
```

**Returns**:
- `socket` — Socket.io client instance.
- `connected` — Boolean connection status.
- `whatsAppState` — Current WhatsApp state and QR code SVG.
- `lastEvent` — Last `message` or `chat_update` event payload.

The hook connects to `/api/socket` and listens for:
- `connect` / `disconnect`
- `whatsapp_state`
- `message`
- `chat_update`

## Utility Functions

### `lib/utils.ts`

```typescript
export function cn(...inputs: ClassValue[]): string;
```

Merges Tailwind classes using `clsx` and `tailwind-merge`.
