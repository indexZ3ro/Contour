-- =============================================================================
-- Consultations with an append-only status history (full audit trail).
--
--   consultations 1 ──< consultation_statuses >── 1 consultation_status_types
--
-- A consultation row is immutable after booking. Every state change
-- (complete, incomplete, reschedule, cancel) is a new consultation_statuses row
-- recording the status, the scheduled time in effect, when, and by whom.
-- The current state is the latest status row (see consultation_current view).
-- =============================================================================

-- Lookup table of status types (a table rather than an enum so labels/ordering
-- can evolve and new types can be added without an ALTER TYPE).
create table public.consultation_status_types (
  id    smallint primary key,
  code  text not null unique check (code ~ '^[a-z_]+$'),
  label text not null
);
comment on table public.consultation_status_types is 'Allowed consultation status values.';

insert into public.consultation_status_types (id, code, label) values
  (1, 'scheduled',   'Scheduled'),
  (2, 'rescheduled', 'Rescheduled'),
  (3, 'completed',   'Completed'),
  (4, 'incomplete',  'Incomplete'),
  (5, 'cancelled',   'Cancelled');

create table public.consultations (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name  text not null check (char_length(btrim(last_name)) between 1 and 100),
  reason     text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at timestamptz not null default now()
);
comment on table public.consultations is 'A booked consultation. Immutable; state lives in consultation_statuses.';

create index consultations_student_id_idx on public.consultations (student_id);

create table public.consultation_statuses (
  id              bigint generated always as identity primary key,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  status_type_id  smallint not null references public.consultation_status_types (id),
  scheduled_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null
);
comment on table public.consultation_statuses is 'Append-only status history for consultations.';
comment on column public.consultation_statuses.scheduled_at is 'Consultation datetime in effect from this status onwards.';
comment on column public.consultation_statuses.created_at is 'When this status was set.';

-- Serves "latest status per consultation" lookups (view + transition trigger).
create index consultation_statuses_latest_idx
  on public.consultation_statuses (consultation_id, created_at desc, id desc);
create index consultation_statuses_status_type_idx
  on public.consultation_statuses (status_type_id);

-- -----------------------------------------------------------------------------
-- Transition rules, enforced in the database so no client can bypass them.
--   (none)                          -> scheduled
--   scheduled|rescheduled|incomplete -> rescheduled (new future time required)
--   scheduled|rescheduled|incomplete -> completed
--   scheduled|rescheduled|incomplete -> cancelled
--   completed                        -> incomplete
--   cancelled                        -> (terminal)
-- Custom SQLSTATEs: CT409 = invalid transition, CT400 = invalid input.
-- -----------------------------------------------------------------------------
create or replace function public.validate_consultation_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  new_code  text;
  prev_code text;
  prev_at   timestamptz;
begin
  -- Serialise concurrent status changes on the same consultation.
  perform pg_advisory_xact_lock(hashtextextended(new.consultation_id::text, 0));

  select code into new_code
  from public.consultation_status_types where id = new.status_type_id;

  select t.code, s.scheduled_at into prev_code, prev_at
  from public.consultation_statuses s
  join public.consultation_status_types t on t.id = s.status_type_id
  where s.consultation_id = new.consultation_id
  order by s.created_at desc, s.id desc
  limit 1;

  -- Never trust the client for audit attribution or timestamp.
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.created_at := now();

  if prev_code is null then
    if new_code <> 'scheduled' then
      raise exception 'A consultation must start as scheduled' using errcode = 'CT409';
    end if;
  elsif prev_code = 'cancelled' then
    raise exception 'Consultation is cancelled and can no longer be changed' using errcode = 'CT409';
  elsif new_code = 'scheduled' then
    raise exception 'Consultation is already booked' using errcode = 'CT409';
  elsif new_code = 'incomplete' and prev_code <> 'completed' then
    raise exception 'Only a completed consultation can be marked incomplete' using errcode = 'CT409';
  elsif new_code in ('completed', 'rescheduled', 'cancelled') and prev_code = 'completed' then
    raise exception 'Consultation is completed; mark it incomplete first' using errcode = 'CT409';
  end if;

  if new_code in ('scheduled', 'rescheduled') then
    if new.scheduled_at is null or new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future' using errcode = 'CT400';
    end if;
    if new_code = 'rescheduled' and new.scheduled_at = prev_at then
      raise exception 'New time must differ from the current time' using errcode = 'CT400';
    end if;
  else
    -- Non-scheduling statuses carry the current time forward.
    new.scheduled_at := prev_at;
  end if;

  return new;
end;
$$;

create trigger consultation_statuses_validate
  before insert on public.consultation_statuses
  for each row execute function public.validate_consultation_status();

-- History is append-only: block updates and deletes for everyone except
-- cascades from consultation deletion.
create or replace function public.prevent_status_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Consultation status history is append-only' using errcode = 'CT409';
end;
$$;

create trigger consultation_statuses_immutable
  before update on public.consultation_statuses
  for each row execute function public.prevent_status_mutation();

-- -----------------------------------------------------------------------------
-- Current state of each consultation = its latest status row.
-- security_invoker so the caller's RLS applies to the underlying tables.
-- -----------------------------------------------------------------------------
create view public.consultation_current
with (security_invoker = true)
as
select
  c.id,
  c.student_id,
  c.first_name,
  c.last_name,
  c.reason,
  c.created_at,
  t.code         as status,
  t.label        as status_label,
  s.scheduled_at,
  s.created_at   as status_set_at
from public.consultations c
join lateral (
  select cs.status_type_id, cs.scheduled_at, cs.created_at
  from public.consultation_statuses cs
  where cs.consultation_id = c.id
  order by cs.created_at desc, cs.id desc
  limit 1
) s on true
join public.consultation_status_types t on t.id = s.status_type_id;

comment on view public.consultation_current is 'Each consultation with its latest status and scheduled time.';

-- -----------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER: they run as the caller, so RLS still applies).
-- -----------------------------------------------------------------------------

-- Book: create the consultation and its initial 'scheduled' status atomically.
create or replace function public.book_consultation(
  p_first_name   text,
  p_last_name    text,
  p_reason       text,
  p_scheduled_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.consultations (first_name, last_name, reason)
  values (btrim(p_first_name), btrim(p_last_name), btrim(p_reason))
  returning id into new_id;

  insert into public.consultation_statuses (consultation_id, status_type_id, scheduled_at)
  select new_id, t.id, p_scheduled_at
  from public.consultation_status_types t where t.code = 'scheduled';

  return new_id;
end;
$$;

-- Append a status by code. Returns the new history row id.
create or replace function public.set_consultation_status(
  p_consultation_id uuid,
  p_status          text,
  p_scheduled_at    timestamptz default null
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  type_id smallint;
  new_id  bigint;
begin
  select id into type_id from public.consultation_status_types where code = p_status;
  if type_id is null then
    raise exception 'Unknown status: %', p_status using errcode = 'CT400';
  end if;

  insert into public.consultation_statuses (consultation_id, status_type_id, scheduled_at)
  values (p_consultation_id, type_id, coalesce(p_scheduled_at, now()))
  returning id into new_id;

  return new_id;
end;
$$;

revoke execute on function public.book_consultation from anon, public;
revoke execute on function public.set_consultation_status from anon, public;
grant execute on function public.book_consultation to authenticated;
grant execute on function public.set_consultation_status to authenticated;
revoke execute on function public.validate_consultation_status from anon, authenticated, public;
revoke execute on function public.prevent_status_mutation from anon, authenticated, public;
