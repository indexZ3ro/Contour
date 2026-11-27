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

### Running locally
```bash
npm install
npm run db:start          # supabase start: boots Postgres/Auth/etc., applies migrations + seed
```
Copy `.env.example` to `.env.local` and set the publishable key printed by `npx supabase status`:
```bash
cp .env.example .env.local
```
```bash
npm run dev               # http://localhost:3000
```

Seeded accounts (local only), password `Password123!` for both:

| Email | Role |
|---|---|
| `admin@contour.test` | admin |
| `student@contour.test` | student |

On **Sign up** you choose an account type, **Student** or **Admin**. This is
**for demo purposes only**; see [Role selection at sign-up](#role-selection-at-sign-up-demo-only).
Email confirmation is disabled locally; confirmation mail, if enabled, is visible in Mailpit at
http://127.0.0.1:54324.

Useful scripts:
- `npm run db:reset`: rebuild the database from migrations + `supabase/seed.sql`
- `npm run db:types`: regenerate `lib/database.types.ts` from the schema
- `npm run db:test`: run the database tests (see [Tests](#tests))

### Tests
`supabase/tests/consultations_rls.test.sql` is a [pgTAP](https://supabase.com/docs/guides/database/testing)
suite that runs against the real schema, switching between a student, another student, an admin and a
signed-out user. It checks the security rules where they're enforced, in Postgres:

- students only see, book and change their own consultations
- booking details can't be edited, and history can't be written directly
- the roles table is hidden, and admins are read-only
- transition rules (cancelled is final, the time changes only through a reschedule)
- every change is recorded in the history

It runs inside a transaction that's rolled back, so it leaves no data behind.

### Changing a user's role
An existing user's role can be changed in Studio's SQL editor (http://127.0.0.1:54323):
```sql
update public.user_roles set role = 'admin'
where user_id = (select id from auth.users where email = 'you@example.com');
```
After a role change the user must sign out and in again (or wait for a token refresh) to receive the new role claim.

---

## Implementation summary

### Database (`supabase/migrations`)
| Migration | Contents |
|---|---|
| `…_auth_rbac.sql` | Roles and permissions (`user_roles`, `role_permissions`), the token hook that adds `user_role` to the JWT, `authorize()`, and the sign-up trigger that assigns each new user a role |
| `…_consultations.sql` | `consultation_status_types`, `consultations` and `consultation_status_history`, the rules trigger and the history trigger, then the grants and RLS policies |

Each file is one feature and reads top to bottom: tables, rules, then access.

```
auth.users 1──1 user_roles (role)            role_permissions (role → permission)
     │
     1──< consultations                          ← current state
            first/last name, reason              (immutable after booking)
            status_type_id, scheduled_at         (the only updatable columns)
            created_at, updated_at
               │
               1──< consultation_status_history  ← append-only audit log, written by trigger
                      status_type_id, scheduled_at, created_at, created_by

consultation_status_types: scheduled | rescheduled | completed | incomplete | cancelled
                           (each with the permission required to set it)
```

**`consultations` holds the current state; `consultation_status_history` holds every change.**
Booking inserts a consultation and an `AFTER INSERT OR UPDATE` trigger records each change as a
history row: the status, the `scheduled_at` in effect, when it was set and who set it (`auth.uid()`).
Users have only read access to the history table, so the audit trail can't be skipped, forged or
edited. Cancel is a status, not a delete, so students still see their cancelled bookings.

**Transitions are enforced in Postgres** (`validate_consultation_change` trigger), so no client can bypass them:

```
(new) → scheduled (future time)
scheduled | rescheduled | incomplete → rescheduled (new future time) | completed | cancelled
completed → incomplete
cancelled → (terminal)
```
The trigger only lets the time change through a reschedule, and sets `created_at` / `updated_at` itself
so clients can't supply them. Booking details are immutable through column-level grants: API users can
only `UPDATE (status_type_id, scheduled_at)`.
Concurrent changes to the same consultation are serialised by Postgres's row lock. Custom SQLSTATEs
(`CT400`, `CT409`) map cleanly to HTTP 400 / 409.

### RBAC
Follows Supabase's [Custom Claims & RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) pattern:

| Role | Permissions |
|---|---|
| student | `consultations.create`, `consultations.read.own`, `consultations.complete.own`, `consultations.reschedule.own`, `consultations.cancel.own` |
| admin | `consultations.read.all` |

Each action has its own permission, so a role can be allowed to reschedule but not cancel, for example.
`consultation_status_types.required_permission` maps each status to the permission needed to set it,
so the transition permissions are data, not code.

1. **Assignment**: a trigger on `auth.users` creates the user's `user_roles` row when they sign up.
   For this demo it uses the account type chosen on the form (see below). Users have no write access
   to `user_roles`, so they can never change their role afterwards.
2. **JWT claim**: `custom_access_token_hook` adds `user_role` to the access token at issue time.
3. **Database enforcement**: RLS policies call `authorize('<permission>')`, which joins the JWT role
   to `role_permissions`. Policies are written against *permissions*, not roles, so a new role is just new rows.
   The update policy requires owning the consultation **and** the permission for the target status.
4. **API enforcement**: every route handler checks the session and the required permission
   (`lib/auth/rbac.ts`) using the **verified** claims from `supabase.auth.getClaims()`, and returns
   401 / 403 before touching data.

### REST API
All handlers use the user-scoped server client. The service-role key is never used by the app,
so RLS always applies.

| Method & path | Permission | Result |
|---|---|---|
| `GET /api/consultations?status=&limit=&offset=` | read.own **or** read.all | `200 { data, total, limit, offset }`, scoped by RLS (own rows vs all rows) |
| `POST /api/consultations` | create | `201` + `Location`, body `{ firstName, lastName, reason, scheduledAt }` |
| `GET /api/consultations/{id}` | read.own / read.all | `200`, or `404` if missing or not visible |
| `GET /api/consultations/{id}/statuses` | read.own / read.all | `200`, full ordered history |
| `POST /api/consultations/{id}/statuses` | complete.own / reschedule.own / cancel.own (by status) | `201` with the history entry, body `{ status: "completed" \| "incomplete" \| "cancelled" }` or `{ status: "rescheduled", scheduledAt }` |

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
supabase/                      config.toml, migrations, seed.sql, tests (pgTAP)
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
  what each caller sees is decided by permissions/RLS, not by URL. Status changes are modelled as creating
  a `statuses` sub-resource (cancel is a status, not a delete), so each change is an explicit, auditable event.
- **Current state on `consultations` + trigger-written history.** Reads are a plain indexed query
  (sorting and paginating by `scheduled_at` uses an index, with no "latest row per consultation" work), and
  the history is captured by the database for every write path, so the app can't forget to log a change.
  Writes are plain `INSERT` / `UPDATE` calls; the trigger runs in the same transaction, so state and history
  can't diverge.
- **Lookup table for status types** (not an enum), so labels can change and types can be added without `ALTER TYPE`.
- **API routes over Server Actions**, as requested. Server components read through the shared service layer
  (same RLS-scoped queries) for fast first paint, and all mutations go through the REST API.
- **Validation in two layers**: hand-written checks in the API for clear 400s, plus CHECK constraints and
  triggers in the database as the final authority.

**Assumptions**
- Admin and student are **separate roles**, not a hierarchy: an admin is not a "promoted" student,
  and admins cannot book or manage consultations.
- Users pick their role at sign-up, **for the demo only** (see below).
- Admins are read-only. They cannot book or change consultations (enforced by permissions).
- First and last name are captured per booking, as specified, rather than taken from the profile.
- Cancelled is terminal. A completed consultation must be marked incomplete before it is rescheduled or cancelled.
- Only future times can be booked or rescheduled. Completion is allowed at any time (no "must be in the past" rule).
- Times are stored as `timestamptz` (a UTC instant) and displayed in the **viewer's** local timezone,
  with the zone shown (e.g. "3:00 pm AEDT"). Formatting happens in the browser only; on the server it
  would use the server's timezone (typically UTC in production).
- **Students book times in their own timezone.** The booking form takes a local date and time and the
  browser converts it to UTC, so a student in Melbourne picking 3:00 pm books 3:00 pm Melbourne time,
  which a Perth admin sees as 12:00 pm AWST. In a real scenario we'd need to account for consultations
  tied to a specific location or tutor, e.g. storing the consultation's IANA timezone
  (`Australia/Melbourne`) and letting students book and view times in that zone.
- No availability or double-booking constraints (no tutor/calendar model was specified).

## Role selection at sign-up (demo only)

> ⚠️ **Not production-safe.** Anyone can create an admin account and read every consultation.
> It exists so reviewers can try both roles without running SQL.

The sign-up form sends `{ role }` as user metadata. The sign-up trigger (`handle_new_user_role` in
`…_auth_rbac.sql`, marked `DEMO ONLY`) reads it **once**, at account creation; anything other than
`admin` means `student`. Users can edit their own metadata later, but that never changes `user_roles`,
which they cannot write. Authorisation still comes entirely from `user_roles` → JWT claim → `role_permissions`.

**In production** I would change that trigger so every sign-up gets no privileged role, and
provision admins out-of-band: an invite flow where an existing admin issues a single-use invite,
SSO/IdP group mapping for staff, or an operator tool using the service role on the server. Since
admin is a separate role rather than a promotion, staff would sign up through a separate path.

## Future improvements
- Vitest tests for request validation and the API route handlers, and running the pgTAP suite in CI
- Filtering/search UI for admins, and pagination
- Tutors/availability with an exclusion constraint to prevent double-booking
- Rate limiting on the booking endpoints
