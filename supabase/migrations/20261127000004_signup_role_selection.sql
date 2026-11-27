-- =============================================================================
-- DEMO ONLY: let users choose their role (student | admin) at sign-up.
--
-- The sign-up form sends { role } in user metadata. The trigger reads it ONCE,
-- at user creation. Users can edit their own metadata later via updateUser(),
-- but that has no effect on public.user_roles, which users cannot write.
--
-- In production, remove this and provision admins out-of-band (invite flow,
-- SSO group mapping, or an operator tool). Admin is a separate role, not a
-- promotion of a student.
-- =============================================================================

create or replace function public.handle_new_user_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := new.raw_user_meta_data ->> 'role';
begin
  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case when requested in ('student', 'admin')
      then requested::public.app_role
      else 'student'::public.app_role  -- missing/unknown values fall back to student
    end
  );
  return new;
end;
$$;
