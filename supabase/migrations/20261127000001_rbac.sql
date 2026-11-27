-- =============================================================================
-- RBAC: roles, permissions, JWT custom claim, authorize() helper
-- Based on Supabase's "Custom Claims & Role-based Access Control" pattern.
-- =============================================================================

-- Roles a user can hold, and the fine-grained permissions they grant.
create type public.app_role as enum ('student', 'admin');

-- One permission per action, so each can be granted independently
-- (e.g. a role that may reschedule but not cancel).
create type public.app_permission as enum (
  'consultations.create',
  'consultations.read.own',
  'consultations.complete.own',
  'consultations.reschedule.own',
  'consultations.cancel.own',
  'consultations.read.all'
);

-- One role per user (unique). Assigned server-side only; users can never write here.
create table public.user_roles (
  id         bigint generated always as identity primary key,
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  role       public.app_role not null default 'student',
  created_at timestamptz not null default now()
);
comment on table public.user_roles is 'Role assignment per user. Written only by triggers / privileged SQL.';

-- Role -> permission mapping. Adding a new role or permission is a data change, not a code change.
create table public.role_permissions (
  id         bigint generated always as identity primary key,
  role       public.app_role not null,
  permission public.app_permission not null,
  unique (role, permission)
);
comment on table public.role_permissions is 'Permissions granted to each role.';

insert into public.role_permissions (role, permission) values
  ('student', 'consultations.create'),
  ('student', 'consultations.read.own'),
  ('student', 'consultations.complete.own'),
  ('student', 'consultations.reschedule.own'),
  ('student', 'consultations.cancel.own'),
  ('admin',   'consultations.read.all');

-- -----------------------------------------------------------------------------
-- Custom Access Token Hook: embeds the user's role in the JWT as `user_role`.
-- Runs inside Supabase Auth (as supabase_auth_admin) whenever a token is issued.
-- -----------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims    jsonb;
  user_role public.app_role;
begin
  select ur.role into user_role
  from public.user_roles ur
  where ur.user_id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(user_role), 'null'::jsonb));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

grant select on table public.user_roles to supabase_auth_admin;
grant select on table public.role_permissions to supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- authorize(): true if the caller's JWT role grants the requested permission.
-- Used by RLS policies. SECURITY DEFINER so it can read role_permissions,
-- which is otherwise not exposed to API users.
-- -----------------------------------------------------------------------------
create or replace function public.authorize(requested_permission public.app_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.permission = requested_permission
      and rp.role = nullif(auth.jwt() ->> 'user_role', '')::public.app_role
  );
$$;

revoke execute on function public.authorize from anon, public;
grant execute on function public.authorize to authenticated;

-- -----------------------------------------------------------------------------
-- Every new sign-up becomes a student. Admins are promoted out-of-band.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role) values (new.id, 'student');
  return new;
end;
$$;

revoke execute on function public.handle_new_user_role from anon, authenticated, public;

create trigger on_auth_user_created_assign_role
  after insert on auth.users
  for each row execute function public.handle_new_user_role();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;

-- Users may read their own role (handy for UI); no one may write via the API.
create policy "Users can read their own role"
  on public.user_roles for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Auth admin can read user roles"
  on public.user_roles for select
  to supabase_auth_admin
  using (true);

create policy "Auth admin can read role permissions"
  on public.role_permissions for select
  to supabase_auth_admin
  using (true);

revoke all on table public.user_roles from anon;
revoke insert, update, delete on table public.user_roles from authenticated;
revoke all on table public.role_permissions from anon, authenticated;
