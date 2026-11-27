-- =============================================================================
-- Row Level Security for consultations.
-- Policies are permission-based (via public.authorize), not role-based, so
-- granting a role new capabilities is a row in role_permissions.
-- =============================================================================

alter table public.consultation_status_types enable row level security;
alter table public.consultations enable row level security;
alter table public.consultation_status_history enable row level security;

revoke all on table public.consultation_status_types from anon, authenticated;
revoke all on table public.consultations from anon, authenticated;
revoke all on table public.consultation_status_history from anon, authenticated;

grant select on table public.consultation_status_types to authenticated;
grant select, insert on table public.consultations to authenticated;
-- Column-level grant: only the status and time can ever be updated by API users.
grant update (status_type_id, scheduled_at) on table public.consultations to authenticated;
-- History is read-only to API users; it is written only by trigger.
grant select on table public.consultation_status_history to authenticated;

-- Status types: readable reference data.
create policy "Authenticated users can read status types"
  on public.consultation_status_types for select
  to authenticated
  using (true);

-- Consultations ---------------------------------------------------------------
create policy "Students can read their own consultations"
  on public.consultations for select
  to authenticated
  using (
    (select public.authorize('consultations.read.own'))
    and student_id = (select auth.uid())
  );

create policy "Admins can read all consultations"
  on public.consultations for select
  to authenticated
  using ((select public.authorize('consultations.read.all')));

create policy "Students can book consultations for themselves"
  on public.consultations for insert
  to authenticated
  with check (
    (select public.authorize('consultations.create'))
    and student_id = (select auth.uid())
  );

-- Changing a consultation requires owning it AND holding the permission that the
-- target status requires (complete / reschedule / cancel), read from the lookup table.
create policy "Students can change their own consultations"
  on public.consultations for update
  to authenticated
  using (student_id = (select auth.uid()))
  with check (
    student_id = (select auth.uid())
    and public.authorize((
      select t.required_permission
      from public.consultation_status_types t
      where t.id = status_type_id
    ))
  );

-- Consultation status history -------------------------------------------------
create policy "Students can read their own consultation history"
  on public.consultation_status_history for select
  to authenticated
  using (
    (select public.authorize('consultations.read.own'))
    and exists (
      select 1 from public.consultations c
      where c.id = consultation_id
        and c.student_id = (select auth.uid())
    )
  );

create policy "Admins can read all consultation history"
  on public.consultation_status_history for select
  to authenticated
  using ((select public.authorize('consultations.read.all')));
