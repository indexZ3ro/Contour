-- =============================================================================
-- Auth & RBAC
-- Supabase "Custom Claims & RBAC" pattern: users have a role, roles grant
-- permissions, the role is added to the JWT, and RLS checks permissions via
-- authorize().
-- =============================================================================

create type public.app_role as enum ('student', 'admin');

-- One permission per action, so each can be granted independently.
create type public.app_permission as enum (
  'consultations.create',
  'consultations.read.own',
  'consultations.complete.own',
  'consultations.reschedule.own',
  'consultations.cancel.own',
  'consultations.read.all'
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role    public.app_role not null
);

create table public.role_permissions (
  role       public.app_role not null,
  permission public.app_permission not null,
  primary key (role, permission)
);

insert into public.role_permissions (role, permission) values
  ('student', 'consultations.create'),
  ('student', 'consultations.read.own'),
  ('student', 'consultations.complete.own'),
  ('student', 'consultations.reschedule.own'),
  ('student', 'consultations.cancel.own'),
  ('admin',   'consultations.read.all');

-- Neither table is reachable through the API. Only Supabase Auth (for the
-- token hook) and security-definer functions read them.
alter table public.user_roles enable row level security;
alter table public.role_permissions enable row level security;
revoke all on public.user_roles, public.role_permissions from anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant select on public.user_roles to supabase_auth_admin;
create policy "Auth can read user roles" on public.user_roles
  for select to supabase_auth_admin using (true);

-- -----------------------------------------------------------------------------
-- Token hook: Supabase Auth calls this whenever it issues a token and we add
-- the user's role as the `user_role` claim.
-- -----------------------------------------------------------------------------
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  user_role public.app_role;
begin
  select role into user_role from public.user_roles where user_id = (event ->> 'user_id')::uuid;
  return jsonb_set(event, '{claims,user_role}', coalesce(to_jsonb(user_role), 'null'));
end;
$$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;

-- -----------------------------------------------------------------------------
-- authorize(): returns true if the caller's role (from the JWT) grants the
-- given permission. Used by RLS policies.
-- -----------------------------------------------------------------------------
create function public.authorize(requested_permission public.app_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_permissions
    where permission = requested_permission
      and role = nullif(auth.jwt() ->> 'user_role', '')::public.app_role
  );
$$;

revoke execute on function public.authorize from anon, public;
grant execute on function public.authorize to authenticated;

-- -----------------------------------------------------------------------------
-- Sign-up: give every new user a role.
-- DEMO ONLY: the role comes from the sign-up form (user metadata) so reviewers
-- can try both roles. It's read once, here; later edits to metadata have no
-- effect. In production every sign-up would get no privileged role and admins
-- would be provisioned separately (invite / SSO / operator tool).
-- -----------------------------------------------------------------------------
create function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case when new.raw_user_meta_data ->> 'role' = 'admin'
      then 'admin'::public.app_role
      else 'student'::public.app_role
    end
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user_role from anon, authenticated, public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_role();
