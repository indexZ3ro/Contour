-- =============================================================================
-- Local development seed data. Applied by `supabase db reset`.
-- NOT for production. Demo users (password for both: Password123!):
--   admin@contour.test    (admin)
--   student@contour.test  (student)
-- =============================================================================

do $$
declare
  admin_id   uuid := '00000000-0000-0000-0000-00000000a001';
  student_id uuid := '00000000-0000-0000-0000-00000000b001';
  u record;
begin
  for u in
    select * from (values (admin_id, 'admin@contour.test'), (student_id, 'student@contour.test')) as t(id, email)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(),
      '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;

  -- The sign-up trigger made both users students; promote the admin.
  update public.user_roles set role = 'admin' where user_id = admin_id;
end;
$$;

-- Demo consultations for the student, with some history.
do $$
declare
  student_id uuid := '00000000-0000-0000-0000-00000000b001';
  c1 uuid; c2 uuid; c3 uuid;
begin
  insert into public.consultations (student_id, first_name, last_name, reason)
  values (student_id, 'Sam', 'Student', 'Help with Methods 3/4 calculus revision')
  returning id into c1;
  insert into public.consultation_statuses (consultation_id, status_type_id, scheduled_at, created_by)
  values (c1, 1, now() + interval '3 days', student_id);

  insert into public.consultations (student_id, first_name, last_name, reason)
  values (student_id, 'Sam', 'Student', 'Essay feedback for English SAC')
  returning id into c2;
  insert into public.consultation_statuses (consultation_id, status_type_id, scheduled_at, created_by)
  values (c2, 1, now() + interval '1 day', student_id),
         (c2, 2, now() + interval '5 days', student_id),
         (c2, 3, now(), student_id);

  insert into public.consultations (student_id, first_name, last_name, reason)
  values (student_id, 'Sam', 'Student', 'Chemistry exam strategy')
  returning id into c3;
  insert into public.consultation_statuses (consultation_id, status_type_id, scheduled_at, created_by)
  values (c3, 1, now() + interval '2 days', student_id),
         (c3, 5, now(), student_id);
end;
$$;
