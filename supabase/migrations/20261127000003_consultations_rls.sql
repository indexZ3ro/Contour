-- =============================================================================
-- Row Level Security for consultations.
-- Policies are permission-based (via public.authorize), not role-based, so
-- granting a role new capabilities is a row in role_permissions.
-- =============================================================================

alter table public.consultation_status_types enable row level security;
alter table public.consultations enable row level security;
alter table public.consultation_statuses enable row level security;

-- Least privilege at the GRANT level too: anon gets nothing; authenticated
-- gets only what the app needs. Updates/deletes are never exposed.
revoke all on table public.consultation_status_types from anon, authenticated;
revoke all on table public.consultations from anon, authenticated;
revoke all on table public.consultation_statuses from anon, authenticated;
revoke all on table public.consultation_current from anon, authenticated;

grant select on table public.consultation_status_types to authenticated;
grant select, insert on table public.consultations to authenticated;
grant select, insert on table public.consultation_statuses to authenticated;
grant select on table public.consultation_current to authenticated;

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

-- Consultation status history -------------------------------------------------
create policy "Students can read their own consultation history"
  on public.consultation_statuses for select
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
  on public.consultation_statuses for select
  to authenticated
  using ((select public.authorize('consultations.read.all')));

create policy "Students can change status of their own consultations"
  on public.consultation_statuses for insert
  to authenticated
  with check (
    (select public.authorize('consultations.update.own'))
    and exists (
      select 1 from public.consultations c
      where c.id = consultation_id
        and c.student_id = (select auth.uid())
    )
  );
