# Contour mini-LMS

A small consultation-booking LMS built with **Next.js 16 (App Router) · TypeScript · Supabase
(Postgres, Auth, supabase-js, @supabase/ssr)** and shadcn/ui.

- Email/password auth (sign up, login, logout, password reset), from the Supabase starter
- **Students** book consultations, mark them complete or incomplete, reschedule, cancel, and view a full audit history
- **Admins** see a read-only list of every consultation in the system
- RBAC with roles → permissions, a role claim in the JWT, enforced in **both** the API and Postgres RLS
- REST API (`/api/consultations`), used by the UI for every mutation (no Server Actions)

---

## Setup

### Prerequisites
- Node.js 20+
- Docker Desktop, running (for the local Supabase stack)

### Local (recommended)
```bash
npm install
npm run db:start          # supabase start: boots Postgres/Auth/etc., applies migrations + seed
```
Create `.env.local` with values printed by `npx supabase status`:
```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<Publishable key>
```
```bash
npm run dev               # http://localhost:3000
```

Seeded accounts (local only), password `Password123!` for both:

| Email | Role |
|---|---|
| `admin@contour.test` | admin |
| `student@contour.test` | student |

Any account created via **Sign up** is a student. Email confirmation is disabled locally;
confirmation mail, if enabled, is visible in Mailpit at http://127.0.0.1:54324.

Useful scripts:
- `npm run db:reset`: rebuild the database from migrations + `supabase/seed.sql`
- `npm run db:types`: regenerate `lib/database.types.ts` from the schema

### Hosted Supabase + Vercel
1. Create a Supabase project, then `npx supabase link --project-ref <ref>` and `npx supabase db push`
   (applies `supabase/migrations/*`; the seed is **not** pushed).
2. Dashboard → **Authentication → Hooks** → enable **Customize Access Token (JWT) Claims** and select
   `public.custom_access_token_hook`. (Locally this is configured in `supabase/config.toml`.)
3. Dashboard → **Authentication → URL Configuration**: set the Site URL / redirect URLs to the deployment URL.
4. Deploy to Vercel with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Sign up a user, then promote them to admin in the SQL editor:
   ```sql
   update public.user_roles set role = 'admin'
   where user_id = (select id from auth.users where email = 'you@example.com');
   ```
   The user must sign out and in again (or wait for a token refresh) to receive the new role claim.

---

## Implementation summary

### Database (`supabase/migrations`)
| Migration | Contents |
|---|---|
| `…_rbac.sql` | `app_role` / `app_permission` enums, `user_roles`, `role_permissions`, the custom access token hook, `authorize()`, and the sign-up trigger that assigns `student` |
| `…_consultations.sql` | `consultation_status_types`, `consultations`, `consultation_statuses`, the transition trigger, the `consultation_current` view, and the `book_consultation` / `set_consultation_status` RPCs |
| `…_consultations_rls.sql` | Grants (least privilege) and permission-based RLS policies |

```
auth.users 1──1 user_roles (role)            role_permissions (role → permission)
     │
     1──< consultations (first/last name, reason, created_at)      ← immutable
               │
               1──< consultation_statuses (status_type, scheduled_at, created_at, created_by)  ← append-only
                          │
                          >──1 consultation_status_types (scheduled | rescheduled | completed | incomplete | cancelled)
```

**State is an audit log.** A consultation row never changes after booking. Each action
(complete, incomplete, reschedule, cancel) inserts a `consultation_statuses` row recording the
status, the `scheduled_at` in effect, when it was set and who set it. The current state is the
latest row, exposed through the `consultation_current` view (`security_invoker`, so RLS applies).
A reschedule writes a `rescheduled` row carrying the new time, so the time history is preserved too.

**Transitions are enforced in Postgres** (`validate_consultation_status` trigger), so no client can bypass them:

```
(new) → scheduled
scheduled | rescheduled | incomplete → rescheduled (future time) | completed | cancelled
completed → incomplete
cancelled → (terminal)
```
The trigger also forces `created_at = now()` and `created_by = auth.uid()` (no spoofed audit data),
takes a per-consultation advisory lock to serialise concurrent changes, and rejects updates to history rows.
Custom SQLSTATEs (`CT400`, `CT409`) map cleanly to HTTP 400 / 409.

### RBAC
Follows Supabase's [Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) pattern:

| Role | Permissions |
|---|---|
| student | `consultations.create`, `consultations.read.own`, `consultations.update.own` |
| admin | `consultations.read.all` |

1. **Assignment**: a trigger on `auth.users` gives every new user `student`. Users have no write
   access to `user_roles`, so self-promotion is impossible; admins are promoted out-of-band (SQL / seed).
2. **JWT claim**: `custom_access_token_hook` adds `user_role` to the access token at issue time.
3. **Database enforcement**: RLS policies call `authorize('<permission>')`, which joins the JWT role
   to `role_permissions`. Policies are written against *permissions*, not roles, so a new role is just new rows.
4. **API enforcement**: every route handler calls `requirePermission(...)` (`lib/auth/rbac.ts`), which
   reads the **verified** claims via `supabase.auth.getClaims()` and returns 401 / 403 before touching data.

### REST API
All handlers use the user-scoped server client. The service-role key is never used by the app,
so RLS always applies.

| Method & path | Permission | Result |
|---|---|---|
| `GET /api/consultations?status=&limit=&offset=` | read.own **or** read.all | `200 { data, total, limit, offset }`, scoped by RLS (own rows vs all rows) |
| `POST /api/consultations` | create | `201` + `Location`, body `{ firstName, lastName, reason, scheduledAt }` |
| `GET /api/consultations/{id}` | read.own / read.all | `200`, or `404` if missing or not visible |
| `GET /api/consultations/{id}/statuses` | read.own / read.all | `200`, full ordered history |
| `POST /api/consultations/{id}/statuses` | update.own | `201`, body `{ status: "completed" \| "incomplete" \| "cancelled" }` or `{ status: "rescheduled", scheduledAt }` |

Errors share one shape, `{ "error": { "code", "message" } }`, with codes 400 (validation), 401, 403,
404, 409 (invalid transition) and 500. Postgres errors are translated in `lib/api/http.ts`, so internals never leak.

### App structure
```
app/api/consultations/…        REST route handlers (thin: auth guard → validate → service)
app/dashboard/page.tsx         Role-aware dashboard (student vs admin view), server-rendered
lib/auth/rbac.ts               getSession / requirePermission / hasPermission
lib/consultations/service.ts   Data access shared by API handlers and server components
lib/consultations/validation.ts Request parsing / validation
lib/consultations/client-api.ts Browser fetch wrappers for the API
lib/api/http.ts                ApiError, Postgres→HTTP error mapping, handler wrapper
components/consultations/*     Booking form, student list, admin table, history
supabase/                      config.toml, migrations, seed.sql
```

---

## Justifications & assumptions

**Decisions**
- **RLS + API guard (defence in depth).** RLS is the real security boundary: even a direct supabase-js
  call with a student's token cannot read or modify other students' data, or let an admin write.
  The API guard fails fast with clear 401/403s and keeps authorisation visible in the code.
- **Role in the JWT** avoids a role lookup per request in the app. `authorize()` still checks
  `role_permissions` in the database, so permission changes apply immediately. Role changes apply on
  the next token refresh, which is an accepted trade-off of claims-based RBAC.
- **One REST resource, no role-specific routes.** `GET /api/consultations` serves both students and admins;
  what each caller sees is decided by permissions/RLS, not by URL. State changes are modelled as creating
  a `statuses` sub-resource, so there is no PATCH/DELETE on consultations (cancel is a status, not a delete).
- **Append-only history** gives a complete audit trail and makes "reschedule" and "cancel" naturally auditable.
- **View for current state** (latest row via `LATERAL … LIMIT 1`, backed by the
  `(consultation_id, created_at desc, id desc)` index) keeps a single source of truth with no denormalised
  column to drift. At larger scale this could become a trigger-maintained `current_status` column.
- **RPCs for writes** (`book_consultation`, `set_consultation_status`) make multi-row writes atomic. They are
  `SECURITY INVOKER`, so RLS still applies.
- **Lookup table for status types** (not an enum), so labels can change and types can be added without `ALTER TYPE`.
- **API routes over Server Actions**, as requested. Server components read through the shared service layer
  (same RLS-scoped queries) for fast first paint, and all mutations go through the REST API.
- **Validation in two layers**: hand-written checks in the API for clear 400s, plus CHECK constraints and
  triggers in the database as the final authority.

**Assumptions**
- Sign-up always creates a student; admin is assigned by an operator.
- Admins are read-only. They cannot book or change consultations (enforced by permissions).
- First and last name are captured per booking, as specified, rather than taken from the profile.
- Cancelled is terminal. A completed consultation must be marked incomplete before it is rescheduled or cancelled.
- Only future times can be booked or rescheduled. Completion is allowed at any time (no "must be in the past" rule).
- Times are stored as `timestamptz` (UTC) and displayed in the viewer's local timezone.
- No availability or double-booking constraints (no tutor/calendar model was specified).

## Future improvements
- Schema validation with zod (shared client/server), and generated OpenAPI docs
- Tests: Vitest for validation/handlers, pgTAP for RLS policies and transition rules
- Filtering/search UI for admins, and cursor-based pagination
- Tutors/availability with an exclusion constraint to prevent double-booking
- Rate limiting on the booking endpoints; CI running migrations + lints
