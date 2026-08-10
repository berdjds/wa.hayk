# Authentication

WAControl uses NextAuth.js v4 with a credentials provider and JWT sessions.

## Provider

The application uses a custom credentials provider defined in `lib/auth.ts`:

- Email and password are validated against the `User` table.
- Passwords are hashed with bcrypt.
- Only active users can sign in.
- Session strategy is JWT.

## Roles

| Role | Description |
|------|-------------|
| `ADMIN` | Full access to user management, logs, and WhatsApp connection controls |
| `USER` | Can view chats and send/receive messages |

Roles are stored in the `User` model and attached to the JWT/session.

## Session Flow

1. User submits credentials on `/login`.
2. `authorize` callback validates the email and password.
3. On success, a JWT is created containing `id` and `role`.
4. The `session` callback exposes `id` and `role` to the client session.
5. Server components and API routes use `getServerSession(authOptions)` to validate requests.

## Type Augmentation

NextAuth types are extended in `types/next-auth.d.ts`:

```typescript
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
  }
}
```

## Protected Routes

- `/admin` — requires `ADMIN` role.
- `/dashboard` — requires any authenticated user.
- API routes enforce role checks individually.

## Login Page

The login page is a client component at `app/login/page.tsx`. It calls `signIn` from `next-auth/react` with `redirect: false`, then navigates on success.

## Note on SessionProvider

The root layout currently does not wrap the application in `<SessionProvider>`. Because the app relies on server-side session checks and JWT strategy, this is acceptable for the existing flow. If you add client components that call `useSession`, wrap the layout with `SessionProvider` from `next-auth/react`.
