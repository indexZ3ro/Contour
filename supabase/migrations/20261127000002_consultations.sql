-- =============================================================================
-- Consultations (current state) with an append-only audit history.
--
--   consultation_status_types 1 ──< consultations 1 ──< consultation_status_history
--
-- consultations holds each booking's CURRENT status and scheduled time.
-- Every insert/update is recorded by trigger in consultation_status_history
-- (status, scheduled time in effect, when, by whom). Clients cannot write the
-- history directly, so it cannot be skipped or forged.
-- =============================================================================

-- Lookup table of status types. A table (not an enum) so labels can change and
-- types can be added without ALTER TYPE. Each status names the permission
-- required to move a consultation into it, so RBAC for transitions is data.
create table public.consultation_status_types (
  id                  smallint primary key,
  code                text not null unique check (code ~ '^[a-z_]+$'),
  label               text not null,
  required_permission public.app_permission not null
);
comment on table public.consultation_status_types is 'Allowed consultation statuses and the permission needed to set each.';

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
comment on table public.consultations is 'A booked consultation and its current status.';

-- Student dashboard: own consultations ordered by time. Admin: all, ordered by time.
create index consultations_student_scheduled_idx on public.consultations (student_id, scheduled_at);
create index consultations_scheduled_idx on public.consultations (scheduled_at);
create index consultations_status_type_idx on public.consultations (status_type_id);

create table public.consultation_status_history (
  id              bigint generated always as identity primary key,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  status_type_id  smallint not null references public.consultation_status_types (id),
  scheduled_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null
);
comment on table public.consultation_status_history is 'Append-only audit log of every consultation status/time change. Written by trigger only.';
comment on column public.consultation_status_history.scheduled_at is 'Consultation time in effect from this change onwards.';
comment on column public.consultation_status_history.created_at is 'When the status was set.';

create index consultation_status_history_consultation_idx
  on public.consultation_status_history (consultation_id, id);

-- -----------------------------------------------------------------------------
-- Transition rules, enforced in the database so no client can bypass them.
--   (insert)                         -> scheduled (future time)
--   scheduled|rescheduled|incomplete -> rescheduled (new future time)
--   scheduled|rescheduled|incomplete -> completed | cancelled
--   completed                        -> incomplete
--   cancelled                        -> (terminal)
-- The time may only change via 'rescheduled'. Booking details are immutable.
-- Custom SQLSTATEs: CT409 = invalid transition, CT400 = invalid input.
-- -----------------------------------------------------------------------------
create or replace function public.validate_consultation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  new_code text;
  old_code text;
begin
  select code into new_code from public.consultation_status_types where id = new.status_type_id;

  if tg_op = 'INSERT' then
    if new_code <> 'scheduled' then
      raise exception 'A consultation must start as scheduled' using errcode = 'CT409';
    end if;
    if new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future' using errcode = 'CT400';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  select code into old_code from public.consultation_status_types where id = old.status_type_id;

  if new.student_id is distinct from old.student_id
     or new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'Booking details cannot be changed' using errcode = 'CT409';
  end if;

  if old_code = 'cancelled' then
    raise exception 'Consultation is cancelled and can no longer be changed' using errcode = 'CT409';
  elsif new.scheduled_at is distinct from old.scheduled_at and new_code <> 'rescheduled' then
    raise exception 'The time can only change by rescheduling' using errcode = 'CT409';
  elsif new_code = 'scheduled' then
    raise exception 'Consultation is already booked' using errcode = 'CT409';
  elsif new_code = 'incomplete' and old_code <> 'completed' then
    raise exception 'Only a completed consultation can be marked incomplete' using errcode = 'CT409';
  elsif new_code in ('completed', 'rescheduled', 'cancelled') and old_code = 'completed' then
    raise exception 'Consultation is completed; mark it incomplete first' using errcode = 'CT409';
  end if;

  if new_code = 'rescheduled' then
    if new.scheduled_at <= now() then
      raise exception 'Consultation time must be in the future' using errcode = 'CT400';
    end if;
    if new.scheduled_at = old.scheduled_at then
      raise exception 'New time must differ from the current time' using errcode = 'CT400';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger consultations_validate_change
  before insert or update on public.consultations
  for each row execute function public.validate_consultation_change();

-- -----------------------------------------------------------------------------
-- Audit: record every booking and change. SECURITY DEFINER so it can write the
-- history table, which API users have no write access to.
-- -----------------------------------------------------------------------------
create or replace function public.record_consultation_history()
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

create trigger consultations_record_history
  after insert or update on public.consultations
  for each row execute function public.record_consultation_history();

-- The audit log itself is immutable for everyone.
create or replace function public.prevent_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Consultation status history is append-only' using errcode = 'CT409';
end;
$$;

create trigger consultation_status_history_immutable
  before update on public.consultation_status_history
  for each row execute function public.prevent_history_mutation();

revoke execute on function public.validate_consultation_change from anon, authenticated, public;
revoke execute on function public.record_consultation_history from anon, authenticated, public;
revoke execute on function public.prevent_history_mutation from anon, authenticated, public;
