-- RLS, permission and rule tests. Run with: npx supabase test db
-- Everything runs in a transaction that is rolled back, so no data is left behind.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- -----------------------------------------------------------------------------
-- Setup (as postgres, bypassing RLS): two students and an admin.
-- The sign-up trigger assigns each role from the metadata.
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.local', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.local',   '{}'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.local', '{"role":"admin"}');

insert into public.consultations (id, student_id, first_name, last_name, reason, scheduled_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice', 'A', 'Maths',   now() + interval '2 days'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Bob',   'B', 'English', now() + interval '3 days');

select is(
  (select role::text from public.user_roles where user_id = '33333333-3333-3333-3333-333333333333'),
  'admin',
  'Sign-up trigger assigns the role chosen at sign-up (demo)'
);

-- -----------------------------------------------------------------------------
-- As Alice (student)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","user_role":"student"}';

select is((select count(*)::int from public.consultations), 1, 'Student sees only their own consultations');

select lives_ok(
  $$ insert into public.consultations (first_name, last_name, reason, scheduled_at)
     values ('Alice', 'A', 'Physics', now() + interval '5 days') $$,
  'Student can book a consultation'
);

select throws_ok(
  $$ insert into public.consultations (student_id, first_name, last_name, reason, scheduled_at)
     values ('22222222-2222-2222-2222-222222222222', 'X', 'Y', 'Z', now() + interval '5 days') $$,
  '42501', null, 'Student cannot book for another student'
);

select lives_ok(
  $$ update public.consultations set status_type_id = 3 where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'Student can complete their own consultation'
);

select is(
  (select count(*)::int from public.consultation_status_history where consultation_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2,
  'Booking and completion are both recorded in the history'
);

select throws_ok(
  $$ update public.consultations set reason = 'changed' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  '42501', null, 'Student cannot edit booking details'
);

select throws_ok(
  $$ insert into public.consultation_status_history (consultation_id, status_type_id, scheduled_at)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 5, now()) $$,
  '42501', null, 'Student cannot write history directly'
);

select throws_ok(
  $$ select * from public.user_roles $$,
  '42501', null, 'Student cannot read the roles table'
);

select throws_ok(
  $$ update public.consultations set status_type_id = 5 where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'CT409', null, 'A completed consultation must be marked incomplete before cancelling'
);

-- Alice tries to cancel Bob's consultation: RLS hides it, so nothing changes.
update public.consultations set status_type_id = 5 where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- -----------------------------------------------------------------------------
-- As Bob (student)
-- -----------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","user_role":"student"}';

select is(
  (select status_type_id::int from public.consultations where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'Another student cannot change my consultation'
);

select throws_ok(
  $$ update public.consultations set scheduled_at = now() + interval '9 days' where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$,
  'CT409', null, 'The time can only change by rescheduling'
);

select lives_ok(
  $$ update public.consultations set status_type_id = 5 where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$,
  'Student can cancel their own consultation'
);

select throws_ok(
  $$ update public.consultations set status_type_id = 3 where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$,
  'CT409', null, 'Cancelled is final'
);

-- -----------------------------------------------------------------------------
-- As the admin
-- -----------------------------------------------------------------------------
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated","user_role":"admin"}';

select ok((select count(*) from public.consultations) >= 3, 'Admin sees every consultation');

select throws_ok(
  $$ insert into public.consultations (first_name, last_name, reason, scheduled_at)
     values ('Ad', 'Min', 'Test', now() + interval '5 days') $$,
  '42501', null, 'Admin cannot book (read-only role)'
);

-- -----------------------------------------------------------------------------
-- Signed out
-- -----------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok(
  $$ select * from public.consultations $$,
  '42501', null, 'Signed-out users cannot read consultations'
);

select * from finish();
rollback;
