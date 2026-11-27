-- =============================================================================
-- Consultations
--   consultations                current state of each booking
--   consultation_status_history  append-only audit log, written by trigger
--   consultation_status_types    the statuses and the permission needed to set each
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.consultation_status_types (
  id                  smallint primary key,
  code                text not null unique,
  label               text not null,
  required_permission public.app_permission not null
);

insert into public.consultation_status_types (id, code, label, required_permission) values
  (1, 'scheduled',   'Scheduled',   'consultations.create'),
  (2, 'rescheduled', 'Rescheduled', 'consultations.reschedule.own'),
  (3, 'completed',   'Completed',   'consultations.complete.own'),
  (4, 'incomplete',  'Incomplete',  'consultations.complete.own'),
  (5, 'cancelled',   'Cancelled',   'consultations.cancel.own');

create table public.consultations (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  first_name     text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name      text not null check (char_length(btrim(last_name)) between 1 and 100),
  reason         text not null check (char_length(btrim(reason)) between 1 and 1000),
  status_type_id smallint not null default 1 references public.consultation_status_types (id),
  scheduled_at   timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on public.consultations (student_id, scheduled_at); -- student dashboard
create index on public.consultations (scheduled_at);             -- admin dashboard

create table public.consultation_status_history (
  id              bigint generated always as identity primary key,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  status_type_id  smallint not null references public.consultation_status_types (id),
  scheduled_at    timestamptz not null, -- the consultation time in effect from this change
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null
);

create index on public.consultation_status_history (consultation_id, id);

-- -----------------------------------------------------------------------------
-- Rules: enforced in the database so no client can bypass them.
--   new                              -> scheduled (future time)
--   scheduled|rescheduled|incomplete -> rescheduled (new future time) | completed | cancelled
--   completed                        -> incomplete
--   cancelled                        -> nothing (final)
-- Errors use custom codes the API maps to HTTP: CT400 -> 400, CT409 -> 409.
-- -----------------------------------------------------------------------------
create function public.validate_consultation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  new_code text := (select code from public.consultation_status_types where id = new.status_type_id);
  old_code text;
begin
  if tg_op = 'INSERT' then
    if new_code <> 'scheduled' then
      raise exception 'A consultation must start as scheduled' using errcode = 'CT409';
    elsif new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future' using errcode = 'CT400';
    end if;
    new.created_at := now(); -- never trust client-supplied timestamps
    new.updated_at := now();
    return new;
  end if;

  old_code := (select code from public.consultation_status_types where id = old.status_type_id);

  if old_code = 'cancelled' then
    raise exception 'Consultation is cancelled and can no longer be changed' using errcode = 'CT409';
  elsif new.scheduled_at is distinct from old.scheduled_at and new_code <> 'rescheduled' then
    raise exception 'The time can only change by rescheduling' using errcode = 'CT409';
  elsif new_code = 'scheduled' then
    raise exception 'Consultation is already booked' using errcode = 'CT409';
  elsif new_code = 'incomplete' and old_code <> 'completed' then
    raise exception 'Only a completed consultation can be marked incomplete' using errcode = 'CT409';
  elsif new_code <> 'incomplete' and old_code = 'completed' then
    raise exception 'Consultation is completed; mark it incomplete first' using errcode = 'CT409';
  elsif new_code = 'rescheduled' and new.scheduled_at <= now() then
    raise exception 'Consultation time must be in the future' using errcode = 'CT400';
  elsif new_code = 'rescheduled' and new.scheduled_at = old.scheduled_at then
    raise exception 'New time must differ from the current time' using errcode = 'CT400';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger validate_change
  before insert or update on public.consultations
  for each row execute function public.validate_consultation_change();

-- Audit: every booking and change is recorded. SECURITY DEFINER because API
-- users can't write the history table themselves, so it can't be forged.
create function public.record_consultation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.consultation_status_history (consultation_id, status_type_id, scheduled_at, created_by)
  values (new.id, new.status_type_id, new.scheduled_at, auth.uid());
  return null;
end;
$$;

create trigger record_history
  after insert or update on public.consultations
  for each row execute function public.record_consultation_history();

revoke execute on function public.validate_consultation_change from anon, authenticated, public;
revoke execute on function public.record_consultation_history from anon, authenticated, public;

-- -----------------------------------------------------------------------------
-- Access: least-privilege grants, then permission-based RLS.
-- -----------------------------------------------------------------------------
revoke all on public.consultation_status_types, public.consultations, public.consultation_status_history
  from anon, authenticated;

grant select on public.consultation_status_types to authenticated;
grant select, insert on public.consultations to authenticated;
grant update (status_type_id, scheduled_at) on public.consultations to authenticated; -- only these columns
grant select on public.consultation_status_history to authenticated;                 -- read-only

alter table public.consultation_status_types enable row level security;
alter table public.consultations enable row level security;
alter table public.consultation_status_history enable row level security;

create policy "Anyone signed in can read status types"
  on public.consultation_status_types for select to authenticated
  using (true);

create policy "Students read their own consultations"
  on public.consultations for select to authenticated
  using ((select public.authorize('consultations.read.own')) and student_id = (select auth.uid()));

create policy "Admins read all consultations"
  on public.consultations for select to authenticated
  using ((select public.authorize('consultations.read.all')));

create policy "Students book for themselves"
  on public.consultations for insert to authenticated
  with check ((select public.authorize('consultations.create')) and student_id = (select auth.uid()));

-- Changing status needs ownership AND the permission the new status requires.
create policy "Students change their own consultations"
  on public.consultations for update to authenticated
  using (student_id = (select auth.uid()))
  with check (
    student_id = (select auth.uid())
    and public.authorize((select required_permission from public.consultation_status_types where id = status_type_id))
  );

create policy "Students read their own history"
  on public.consultation_status_history for select to authenticated
  using (
    (select public.authorize('consultations.read.own'))
    and exists (select 1 from public.consultations c where c.id = consultation_id and c.student_id = (select auth.uid()))
  );

create policy "Admins read all history"
  on public.consultation_status_history for select to authenticated
  using ((select public.authorize('consultations.read.all')));
