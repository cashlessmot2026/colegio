-- =====================================================================
--  COLEGIO APP · Esquema Supabase
--  Ejecutar completo en: Supabase → SQL Editor → New query → Run
--  Es idempotente: se puede volver a ejecutar sin perder datos.
--  Usuario inicial:  admin / 1234   (cámbiela desde el panel del colegio)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- TABLAS
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null check (role in ('admin','teacher','parent','student','guard')),
  full_name text not null,
  doc_id text,
  phone text,
  email text,
  session_nonce uuid,
  created_at timestamptz default now()
);

create table if not exists public.cg_settings (
  key text primary key,
  value jsonb not null
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  capacity int default 35
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,              -- ej. "6°A"
  grade int not null,              -- 0 = transición … 11
  director_id uuid references public.profiles(id) on delete set null,
  year int default extract(year from now())::int
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_id uuid not null references public.groups(id) on delete cascade,
  teacher_id uuid references public.profiles(id) on delete set null,
  scale text,                      -- null = escala institucional
  color text default '#7c5cff'
);

create table if not exists public.schedule (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  day int not null check (day between 1 and 6),
  start_time time not null,
  end_time time not null
);

create table if not exists public.students (
  id uuid primary key references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  doc_id text unique not null,
  birth_date date,
  address text,
  blood_type text,
  eps text,
  clinic text,
  parent_id uuid references public.profiles(id) on delete set null,
  guardian2 jsonb default '{}'::jsonb   -- {name, relation, doc, phone, email, address}
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  description text,
  kind text default 'tarea' check (kind in ('tarea','examen','proyecto','taller')),
  period int default 1 check (period between 1 and 4),
  due_date date,
  weight numeric default 1,
  files jsonb default '[]'::jsonb,    -- [{name, path}]
  created_at timestamptz default now()
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  value numeric,
  comment text,
  updated_at timestamptz default now(),
  unique (task_id, student_id)
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  week_start date not null,
  title text not null,
  description text,
  done boolean default false
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  date date not null default current_date,
  status text not null check (status in ('presente','ausente','tarde','excusa')),
  note text,
  teacher_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (student_id, subject_id, date)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text default 'salida' check (kind in ('salida','evento','reunion','academico')),
  place text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  responsible text,
  description text,
  requirements text,
  cost numeric,
  group_id uuid references public.groups(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text default 'Institucional',
  path text not null,
  file_name text,
  created_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  body text,
  file_path text,
  file_name text,
  created_at timestamptz default now(),
  read_at timestamptz
);
create index if not exists messages_pair on public.messages (from_id, to_id, created_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  kind text default 'info',
  created_at timestamptz default now(),
  read_at timestamptz
);

create table if not exists public.exit_permissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  requester_role text,
  reason text,
  pickup_person text,
  valid_date date not null default current_date,
  lat double precision,
  lng double precision,
  accuracy double precision,
  status text default 'autorizada' check (status in ('autorizada','usada','revocada')),
  used_at timestamptz,
  guard_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  data jsonb not null,
  files jsonb default '[]'::jsonb,
  sig_parent text,
  sig_student text,
  sig_school text,
  status text default 'inscripcion' check (status in ('inscripcion','revision','entrevista','aceptado','rechazado')),
  history jsonb default '[]'::jsonb,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  secret uuid not null default gen_random_uuid(),
  active boolean default true,
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- ---------------------------------------------------------------------
-- FUNCIONES AUXILIARES DE SEGURIDAD
-- ---------------------------------------------------------------------
create or replace function public.cg_my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function public.cg_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
$$;

create or replace function public.cg_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','teacher','guard') from profiles where id = auth.uid()), false)
$$;

-- estudiantes del usuario actual: él mismo (estudiante) o sus hijos (padre)
create or replace function public.cg_my_children() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from students where id = auth.uid() or parent_id = auth.uid()
$$;

create or replace function public.cg_teaches_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subjects where group_id = g and teacher_id = auth.uid())
      or exists (select 1 from groups where id = g and director_id = auth.uid())
$$;

create or replace function public.cg_teaches_subject(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from subjects where id = s and teacher_id = auth.uid())
$$;

create or replace function public.cg_teaches_student(st uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students where id = st and public.cg_teaches_group(group_id))
$$;

create or replace function public.cg_can_see_subject(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cg_is_admin() or public.cg_teaches_subject(s)
      or exists (select 1 from subjects sb where sb.id = s and public.cg_teaches_group(sb.group_id))
      or exists (select 1 from subjects sb join students st on st.group_id = sb.group_id
                 where sb.id = s and st.id in (select public.cg_my_children()))
$$;

-- contactos de chat permitidos según el rol
create or replace function public.cg_my_contacts()
returns table (id uuid, full_name text, role text, detail text)
language plpgsql stable security definer set search_path = public as $$
declare r text := public.cg_my_role();
begin
  if r = 'admin' then
    return query select p.id, p.full_name, p.role,
      coalesce((select 'Acudiente de ' || string_agg(sp.full_name, ', ') from students s join profiles sp on sp.id = s.id where s.parent_id = p.id),
               (select 'Estudiante ' || g.name from students s join groups g on g.id = s.group_id where s.id = p.id),
               case p.role when 'teacher' then 'Docente' when 'guard' then 'Vigilancia' else 'Administración' end)
    from profiles p where p.id <> auth.uid();
  elsif r = 'teacher' then
    return query
      select p.id, p.full_name, p.role, 'Estudiante ' || g.name
        from students s join profiles p on p.id = s.id join groups g on g.id = s.group_id
        where public.cg_teaches_group(s.group_id)
      union
      select p.id, p.full_name, p.role, 'Acudiente de ' || sp.full_name || ' (' || g.name || ')'
        from students s join profiles p on p.id = s.parent_id join profiles sp on sp.id = s.id join groups g on g.id = s.group_id
        where public.cg_teaches_group(s.group_id)
      union
      select p.id, p.full_name, p.role, case p.role when 'teacher' then 'Docente' when 'guard' then 'Vigilancia' else 'Administración' end
        from profiles p where p.role in ('admin','teacher','guard') and p.id <> auth.uid();
  elsif r = 'student' then
    return query select distinct p.id, p.full_name, p.role, 'Docente de ' || string_agg(sb.name, ', ')
      from students s join subjects sb on sb.group_id = s.group_id join profiles p on p.id = sb.teacher_id
      where s.id = auth.uid() group by p.id, p.full_name, p.role;
  elsif r = 'parent' then
    return query
      select p.id, p.full_name, p.role, 'Docente de ' || string_agg(distinct sb.name, ', ')
        from students s join subjects sb on sb.group_id = s.group_id join profiles p on p.id = sb.teacher_id
        where s.parent_id = auth.uid() group by p.id, p.full_name, p.role
      union
      select p.id, p.full_name, p.role, 'Director de grupo ' || g.name
        from students s join groups g on g.id = s.group_id join profiles p on p.id = g.director_id
        where s.parent_id = auth.uid()
      union
      select p.id, p.full_name, p.role, case p.role when 'guard' then 'Vigilancia' else 'Administración' end
        from profiles p where p.role in ('admin','guard');
  elsif r = 'guard' then
    return query
      select p.id, p.full_name, p.role, coalesce('Director de grupo ' || (select string_agg(g.name, ', ') from groups g where g.director_id = p.id), 'Administración')
        from profiles p where p.role = 'admin' or (p.role = 'teacher' and exists (select 1 from groups g where g.director_id = p.id))
      union
      select p.id, p.full_name, p.role, 'Acudiente de ' || sp.full_name
        from students s join profiles p on p.id = s.parent_id join profiles sp on sp.id = s.id;
  end if;
end $$;

create or replace function public.cg_can_chat(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cg_my_contacts() c where c.id = target)
$$;

-- ---------------------------------------------------------------------
-- GESTIÓN DE USUARIOS (las contraseñas sólo existen en auth.users con bcrypt)
-- ---------------------------------------------------------------------
create or replace function public._cg_create_auth_user(p_username text, p_password text, p_role text,
  p_full_name text, p_doc text default null, p_phone text default null, p_email text default null)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text := lower(trim(p_username)) || '@colegio.app';
begin
  if p_username !~ '^[a-zA-Z0-9._-]{3,40}$' then raise exception 'Usuario inválido (3-40 caracteres: letras, números, . _ -)'; end if;
  if length(p_password) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  if exists (select 1 from auth.users where email = em) then raise exception 'El usuario % ya existe', p_username; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('role', p_role),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, jsonb_build_object('sub', uid::text, 'email', em, 'email_verified', true),
    'email', now(), now(), now());
  insert into profiles (id, username, role, full_name, doc_id, phone, email)
  values (uid, lower(trim(p_username)), p_role, p_full_name, p_doc, p_phone, p_email);
  return uid;
end $$;
revoke all on function public._cg_create_auth_user from public, anon, authenticated;

create or replace function public.cg_admin_create_user(p_username text, p_password text, p_role text,
  p_full_name text, p_doc text default null, p_phone text default null, p_email text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.cg_is_admin() then raise exception 'No autorizado'; end if;
  return public._cg_create_auth_user(p_username, p_password, p_role, p_full_name, p_doc, p_phone, p_email);
end $$;

create or replace function public._cg_set_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if length(pw) < 4 then raise exception 'La contraseña debe tener al menos 4 caracteres'; end if;
  update auth.users set encrypted_password = crypt(pw, gen_salt('bf')), updated_at = now() where id = uid;
  update public.profiles set session_nonce = null where id = uid;  -- cierra sesiones abiertas
end $$;
revoke all on function public._cg_set_password from public, anon, authenticated;

create or replace function public.cg_admin_set_password(uid uuid, pw text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.cg_is_admin() then raise exception 'No autorizado'; end if;
  perform public._cg_set_password(uid, pw);
end $$;

-- el padre asigna/modifica la contraseña de su hijo
create or replace function public.cg_parent_set_student_password(st uuid, pw text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from students where id = st and parent_id = auth.uid()) then raise exception 'No autorizado'; end if;
  perform public._cg_set_password(st, pw);
end $$;

-- cambio de contraseña propia verificando la actual
create or replace function public.cg_change_my_password(old_pw text, new_pw text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if public.cg_my_role() = 'student' then raise exception 'La contraseña del estudiante la asigna su acudiente'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and encrypted_password = crypt(old_pw, encrypted_password)) then
    raise exception 'La contraseña actual no es correcta';
  end if;
  perform public._cg_set_password(auth.uid(), new_pw);
end $$;

create or replace function public.cg_admin_delete_user(uid uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.cg_is_admin() then raise exception 'No autorizado'; end if;
  if uid = auth.uid() then raise exception 'No puede eliminar su propia cuenta'; end if;
  delete from auth.users where id = uid;
end $$;

-- sesión única por usuario: cada inicio de sesión invalida el anterior
create or replace function public.cg_claim_session() returns uuid
language plpgsql security definer set search_path = public as $$
declare n uuid := gen_random_uuid();
begin
  update profiles set session_nonce = n where id = auth.uid();
  return n;
end $$;

create or replace function public.cg_session_valid(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select session_nonce = n from profiles where id = auth.uid()), false)
$$;

-- el padre registra EPS, clínica y segundo responsable
create or replace function public.cg_parent_update_student(st uuid, p_eps text, p_clinic text, p_blood text, p_guardian2 jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.cg_is_admin() or exists (select 1 from students where id = st and parent_id = auth.uid())) then
    raise exception 'No autorizado';
  end if;
  update students set eps = p_eps, clinic = p_clinic, blood_type = p_blood, guardian2 = coalesce(p_guardian2, '{}'::jsonb)
  where id = st;
end $$;

-- ---------------------------------------------------------------------
-- CLASES VIRTUALES
-- ---------------------------------------------------------------------
create or replace function public.cg_start_class(p_group uuid, p_subject uuid)
returns table (id uuid, code text, secret uuid) language plpgsql security definer set search_path = public as $$
declare c text; r record;
begin
  if not public.cg_teaches_group(p_group) then raise exception 'No dicta clases en este grupo'; end if;
  update class_sessions set active = false, ended_at = now() where teacher_id = auth.uid() and active;
  c := lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into class_sessions (group_id, subject_id, teacher_id, code) values (p_group, p_subject, auth.uid(), c)
  returning class_sessions.id, class_sessions.code, class_sessions.secret into r;
  insert into notifications (user_id, title, body, kind)
    select s.id, 'Clase virtual iniciada', coalesce((select name from subjects where id = p_subject), 'Clase') || ' · pide el código a tu docente', 'clase'
    from students s where s.group_id = p_group;
  return query select r.id, r.code, r.secret;
end $$;

create or replace function public.cg_end_class(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update class_sessions set active = false, ended_at = now() where id = p_id and teacher_id = auth.uid()
$$;

-- clases activas visibles para el estudiante (sin código ni secreto)
create or replace function public.cg_my_active_classes()
returns table (id uuid, subject text, teacher text, started_at timestamptz)
language sql stable security definer set search_path = public as $$
  select cs.id, sb.name, p.full_name, cs.started_at
  from class_sessions cs join students s on s.group_id = cs.group_id and s.id = auth.uid()
  left join subjects sb on sb.id = cs.subject_id join profiles p on p.id = cs.teacher_id
  where cs.active
$$;

-- el estudiante entra con el código de 4 dígitos: sólo los de ese salón
create or replace function public.cg_join_class(p_code text)
returns table (id uuid, secret uuid, subject text, teacher text, teacher_id uuid)
language plpgsql security definer set search_path = public as $$
begin
  return query select cs.id, cs.secret, sb.name, p.full_name, cs.teacher_id
    from class_sessions cs
    join students s on s.group_id = cs.group_id and s.id = auth.uid()
    left join subjects sb on sb.id = cs.subject_id
    join profiles p on p.id = cs.teacher_id
    where cs.active and cs.code = p_code
    limit 1;
  if not found then raise exception 'Código inválido o la clase no pertenece a tu salón'; end if;
end $$;

-- ---------------------------------------------------------------------
-- VIGILANCIA / SALIDAS
-- ---------------------------------------------------------------------
create or replace function public.cg_guard_check(p_doc text)
returns table (student_id uuid, full_name text, group_name text, authorized boolean,
  permission_id uuid, reason text, pickup_person text, requested_by text, requester_role text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare st record;
begin
  if public.cg_my_role() not in ('guard','admin') then raise exception 'No autorizado'; end if;
  select s.id, p.full_name, g.name as gname into st
    from students s join profiles p on p.id = s.id left join groups g on g.id = s.group_id
    where s.doc_id = trim(p_doc) or s.id::text = trim(p_doc) limit 1;
  if st.id is null then
    return query select null::uuid, null::text, null::text, false, null::uuid, 'Estudiante no encontrado'::text, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  return query
    select st.id, st.full_name, st.gname, true, e.id, e.reason, e.pickup_person, rp.full_name, e.requester_role, e.created_at
    from exit_permissions e left join profiles rp on rp.id = e.requested_by
    where e.student_id = st.id and e.valid_date = current_date and e.status = 'autorizada'
    order by e.created_at desc limit 1;
  if not found then
    return query select st.id, st.full_name, st.gname, false, null::uuid, 'Sin autorización de salida para hoy'::text, null::text, null::text, null::text, null::timestamptz;
  end if;
end $$;

create or replace function public.cg_guard_register_exit(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if public.cg_my_role() not in ('guard','admin') then raise exception 'No autorizado'; end if;
  update exit_permissions set status = 'usada', used_at = now(), guard_id = auth.uid()
    where id = p_id and status = 'autorizada' returning * into e;
  if e.id is null then raise exception 'Autorización no válida'; end if;
  insert into notifications (user_id, title, body, kind)
    select uid, 'Salida registrada', p.full_name || ' salió de la institución a las ' || to_char(now() at time zone 'America/Bogota', 'HH24:MI'), 'salida'
    from profiles p, students s,
      lateral (select s.parent_id as uid union select g.director_id from groups g where g.id = s.group_id) u
    where p.id = e.student_id and s.id = e.student_id and uid is not null;
end $$;

-- ---------------------------------------------------------------------
-- MATRÍCULAS (formulario público)
-- ---------------------------------------------------------------------
create or replace function public.cg_submit_enrollment(p_data jsonb, p_files jsonb, p_sig_parent text, p_sig_student text)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if coalesce(p_data->>'student_name','') = '' or coalesce(p_data->>'student_doc','') = '' then
    raise exception 'Faltan datos del estudiante';
  end if;
  if p_sig_parent is null or p_sig_student is null then raise exception 'Faltan las firmas'; end if;
  if length(p_sig_parent) > 400000 or length(p_sig_student) > 400000 then raise exception 'Firma demasiado grande'; end if;
  loop
    c := 'MAT-' || upper(substr(md5(random()::text), 1, 6));
    exit when not exists (select 1 from enrollments where code = c);
  end loop;
  insert into enrollments (code, data, files, sig_parent, sig_student, status, history)
  values (c, p_data, coalesce(p_files, '[]'::jsonb), p_sig_parent, p_sig_student, 'inscripcion',
    jsonb_build_array(jsonb_build_object('status','inscripcion','at', now(), 'note','Solicitud recibida')));
  insert into notifications (user_id, title, body, kind)
    select id, 'Nueva solicitud de matrícula', (p_data->>'student_name') || ' · ' || c, 'matricula' from profiles where role = 'admin';
  return c;
end $$;

create or replace function public.cg_enrollment_status(p_code text, p_doc text)
returns table (code text, student_name text, grade text, status text, history jsonb, created_at timestamptz, signed_school boolean)
language sql stable security definer set search_path = public as $$
  select e.code, e.data->>'student_name', e.data->>'grade', e.status, e.history, e.created_at, e.sig_school is not null
  from enrollments e where e.code = upper(trim(p_code)) and e.data->>'student_doc' = trim(p_doc)
$$;

create or replace function public.cg_admin_enrollment_status(p_id uuid, p_status text, p_note text, p_sig_school text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.cg_is_admin() then raise exception 'No autorizado'; end if;
  update enrollments set
    status = p_status,
    sig_school = coalesce(p_sig_school, sig_school),
    history = history || jsonb_build_array(jsonb_build_object('status', p_status, 'at', now(), 'note', p_note))
  where id = p_id;
end $$;

create or replace function public.cg_enrollment_config() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from cg_settings where key = 'enrollment'), '{}'::jsonb)
      || jsonb_build_object('school', coalesce((select value->>'name' from cg_settings where key = 'school'), 'Colegio'))
$$;

-- ---------------------------------------------------------------------
-- TRIGGERS DE ALERTAS
-- ---------------------------------------------------------------------
create or replace function public.cg_trg_absence_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare st_name text; sb_name text; g record;
begin
  if new.status <> 'ausente' or (tg_op = 'UPDATE' and old.status = 'ausente') then return new; end if;
  select full_name into st_name from profiles where id = new.student_id;
  select name into sb_name from subjects where id = new.subject_id;
  select gr.* into g from students s join groups gr on gr.id = s.group_id where s.id = new.student_id;
  insert into notifications (user_id, title, body, kind)
  select distinct uid, 'Inasistencia registrada',
    st_name || ' no asistió a ' || coalesce(sb_name, 'clase') || ' (' || coalesce(g.name, '') || ') el ' || to_char(new.date, 'DD/MM/YYYY'), 'inasistencia'
  from (
    select parent_id as uid from students where id = new.student_id
    union select g.director_id
    union select id from profiles where role = 'admin'
  ) u where uid is not null;
  return new;
end $$;
drop trigger if exists absence_alert on public.attendance;
create trigger absence_alert after insert or update on public.attendance
  for each row execute function public.cg_trg_absence_alert();

create or replace function public.cg_trg_exit_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare st_name text;
begin
  select full_name into st_name from profiles where id = new.student_id;
  insert into notifications (user_id, title, body, kind)
  select distinct uid, 'Autorización de salida', st_name || ' tiene autorización de salida para el ' || to_char(new.valid_date, 'DD/MM/YYYY') || coalesce(' · ' || new.reason, ''), 'salida'
  from (
    select s.parent_id as uid from students s where s.id = new.student_id
    union select g.director_id from students s join groups g on g.id = s.group_id where s.id = new.student_id
    union select id from profiles where role in ('guard','admin')
  ) u where uid is not null and uid <> new.requested_by;
  return new;
end $$;
drop trigger if exists exit_alert on public.exit_permissions;
create trigger exit_alert after insert on public.exit_permissions
  for each row execute function public.cg_trg_exit_alert();

create or replace function public.cg_trg_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, title, body, kind)
  select new.to_id, 'Mensaje de ' || full_name, left(coalesce(new.body, '📎 ' || new.file_name), 120), 'chat'
  from profiles where id = new.from_id;
  return new;
end $$;
drop trigger if exists message_notify on public.messages;
create trigger message_notify after insert on public.messages
  for each row execute function public.cg_trg_message_notify();

-- ---------------------------------------------------------------------
-- COMUNICADOS (cierres, actividades, publicidad) Y EXÁMENES EN LÍNEA
-- ---------------------------------------------------------------------
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  kind text default 'general' check (kind in ('cierre','actividad','publicidad','general')),
  images jsonb default '[]'::jsonb,     -- [{path, name}]
  links jsonb default '[]'::jsonb,      -- [{label, url}]
  roles text[] not null default array['parent','student','teacher'],
  event_date date,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  instructions text,
  period int default 1 check (period between 1 and 4),
  opens_at timestamptz,
  closes_at timestamptz,
  duration_min int,                                   -- null = sin límite
  show_results text default 'inmediato' check (show_results in ('inmediato','revision')),
  allow_edit boolean default true,                    -- false = cada respuesta confirmada queda bloqueada
  published boolean default false,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists public.exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  position int default 0,
  kind text not null check (kind in ('unica','multiple','cuaderno')),
  prompt text not null,
  options jsonb default '[]'::jsonb,                  -- ["opción A", "opción B", …]
  correct jsonb default '[]'::jsonb,                  -- índices correctos [0, 2]
  justify boolean default false,                      -- selección + justificación en cuaderno
  points numeric default 1
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  started_at timestamptz default now(),
  submitted_at timestamptz,
  status text default 'en_curso' check (status in ('en_curso','pendiente','calificado')),
  answers jsonb default '{}'::jsonb,                  -- {qid: {choice:[…], pages:[dataURL…], locked}}
  details jsonb default '{}'::jsonb,                  -- {qid: {auto_ok, points, pending}}
  manual jsonb default '{}'::jsonb,                   -- {qid: puntos asignados por el docente}
  feedback text,
  auto_score numeric,
  score numeric,
  max_score numeric,
  grade numeric,
  unique (exam_id, student_id)
);

-- convierte una fracción 0..1 a la escala de la asignatura (1-5, 1-10, 0-100)
create or replace function public.cg_scale_value(p_subject uuid, frac numeric) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare g jsonb; sc text; mn numeric; mx numeric;
begin
  select value into g from cg_settings where key = 'grading';
  sc := coalesce(case when coalesce((g->>'teacher_can_choose')::boolean, false) then (select scale from subjects where id = p_subject) end, g->>'scale', '1-5');
  if sc = '1-10' then mn := 1; mx := 10; elsif sc = '0-100' then mn := 0; mx := 100; else mn := 1; mx := 5; end if;
  return round(mn + greatest(0, least(1, frac)) * (mx - mn), case when sc = '0-100' then 0 else 1 end);
end $$;

create or replace function public._cg_exam_write_grade(a public.exam_attempts) returns void
language plpgsql security definer set search_path = public as $$
declare e record; v numeric;
begin
  select * into e from exams where id = a.exam_id;
  if a.max_score is null or a.max_score = 0 then return; end if;
  v := public.cg_scale_value(e.subject_id, a.score / a.max_score);
  update exam_attempts set grade = v where id = a.id;
  if e.task_id is not null then
    insert into grades (task_id, student_id, value, comment, updated_at)
    values (e.task_id, a.student_id, v, 'Examen en línea: ' || a.score || ' / ' || a.max_score || ' puntos', now())
    on conflict (task_id, student_id) do update set value = excluded.value, comment = excluded.comment, updated_at = now();
  end if;
end $$;
revoke all on function public._cg_exam_write_grade from public, anon, authenticated;

create or replace function public._cg_exam_can_take(p_exam uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from exams e join subjects sb on sb.id = e.subject_id join students s on s.group_id = sb.group_id
                 where e.id = p_exam and e.published and s.id = auth.uid())
$$;

-- lista de exámenes del estudiante (o del hijo, para el padre) con su estado; sin respuestas correctas
create or replace function public.cg_my_exams(p_student uuid default null)
returns table (id uuid, subject_id uuid, title text, instructions text, period int, opens_at timestamptz, closes_at timestamptz,
  duration_min int, show_results text, allow_edit boolean, questions int, status text, score numeric, max_score numeric, grade numeric, submitted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject_id, e.title, e.instructions, e.period, e.opens_at, e.closes_at, e.duration_min, e.show_results, e.allow_edit,
    (select count(*)::int from exam_questions q where q.exam_id = e.id),
    coalesce(a.status, 'sin_iniciar'),
    case when a.status = 'calificado' or (e.show_results = 'inmediato' and a.submitted_at is not null) then coalesce(a.score, a.auto_score) end,
    case when a.submitted_at is not null then a.max_score end,
    case when a.status = 'calificado' then a.grade end,
    a.submitted_at
  from exams e
  join subjects sb on sb.id = e.subject_id
  join students s on s.group_id = sb.group_id and s.id = coalesce(p_student, auth.uid())
  left join exam_attempts a on a.exam_id = e.id and a.student_id = s.id
  where e.published and s.id in (select public.cg_my_children())
  order by coalesce(e.opens_at, e.created_at) desc
$$;

-- inicia (o retoma) el examen; devuelve las preguntas SIN las respuestas correctas
create or replace function public.cg_exam_start(p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; a record;
begin
  if not public._cg_exam_can_take(p_exam) then raise exception 'Este examen no está disponible para ti'; end if;
  select * into e from exams where id = p_exam;
  select * into a from exam_attempts where exam_id = p_exam and student_id = auth.uid();
  if a.id is null then
    if e.opens_at is not null and now() < e.opens_at then raise exception 'El examen abre el %', to_char(e.opens_at at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI'); end if;
    if e.closes_at is not null and now() > e.closes_at then raise exception 'El examen ya cerró'; end if;
    insert into exam_attempts (exam_id, student_id) values (p_exam, auth.uid()) returning * into a;
  end if;
  return jsonb_build_object(
    'exam', jsonb_build_object('id', e.id, 'title', e.title, 'instructions', e.instructions, 'duration_min', e.duration_min,
      'allow_edit', e.allow_edit, 'show_results', e.show_results, 'closes_at', e.closes_at),
    'attempt', jsonb_build_object('id', a.id, 'started_at', a.started_at, 'submitted_at', a.submitted_at, 'status', a.status, 'answers', a.answers,
      'deadline', case when e.duration_min is not null then a.started_at + make_interval(mins => e.duration_min) end),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options,
      'justify', q.justify, 'points', q.points, 'multi', jsonb_array_length(q.correct) > 1 or q.kind = 'multiple') order by q.position)
      from exam_questions q where q.exam_id = p_exam), '[]'::jsonb));
end $$;

create or replace function public.cg_exam_save_answer(p_exam uuid, p_question uuid, p_answer jsonb, p_final boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e record; a record; prev jsonb;
begin
  select * into e from exams where id = p_exam;
  select * into a from exam_attempts where exam_id = p_exam and student_id = auth.uid();
  if a.id is null then raise exception 'Primero inicia el examen'; end if;
  if a.submitted_at is not null then raise exception 'El examen ya fue entregado'; end if;
  if e.duration_min is not null and now() > a.started_at + make_interval(mins => e.duration_min + 1) then raise exception 'Se agotó el tiempo del examen'; end if;
  if e.closes_at is not null and now() > e.closes_at + interval '1 minute' then raise exception 'El examen ya cerró'; end if;
  if not exists (select 1 from exam_questions where id = p_question and exam_id = p_exam) then raise exception 'Pregunta inválida'; end if;
  if length(p_answer::text) > 4000000 then raise exception 'La respuesta es demasiado grande (reduzca el número de hojas)'; end if;
  prev := a.answers -> p_question::text;
  if not e.allow_edit and coalesce((prev->>'locked')::boolean, false) then
    raise exception 'Esta pregunta ya fue confirmada y el docente no permite modificarla';
  end if;
  update exam_attempts set answers = answers || jsonb_build_object(p_question::text, p_answer || jsonb_build_object('locked', (not e.allow_edit) and p_final))
  where id = a.id;
  return jsonb_build_object('locked', (not e.allow_edit) and p_final);
end $$;

-- entrega: califica automáticamente selección única/múltiple; cuaderno y justificadas quedan pendientes del docente
create or replace function public.cg_exam_submit(p_exam uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; a public.exam_attempts; q record; ans jsonb; ok boolean; mx numeric := 0; auto numeric := 0; pending boolean := false; det jsonb := '{}'::jsonb;
begin
  select * into e from exams where id = p_exam;
  select * into a from exam_attempts where exam_id = p_exam and student_id = auth.uid();
  if a.id is null then raise exception 'Primero inicia el examen'; end if;
  if a.submitted_at is not null then return public.cg_exam_result(p_exam, null); end if;
  for q in select * from exam_questions where exam_id = p_exam order by position loop
    mx := mx + q.points;
    ans := a.answers -> q.id::text;
    if q.kind in ('unica','multiple') then
      ok := (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements(coalesce(ans->'choice', '[]'::jsonb)) x)
          = (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from jsonb_array_elements(q.correct) x);
      if q.justify then
        pending := true;
        det := det || jsonb_build_object(q.id::text, jsonb_build_object('auto_ok', ok, 'points', null, 'pending', true));
      else
        if ok then auto := auto + q.points; end if;
        det := det || jsonb_build_object(q.id::text, jsonb_build_object('auto_ok', ok, 'points', case when ok then q.points else 0 end, 'pending', false));
      end if;
    else
      pending := true;
      det := det || jsonb_build_object(q.id::text, jsonb_build_object('auto_ok', null, 'points', null, 'pending', true));
    end if;
  end loop;
  update exam_attempts set submitted_at = now(), details = det, auto_score = auto, max_score = mx,
    status = case when pending then 'pendiente' else 'calificado' end,
    score = case when pending then null else auto end
  where id = a.id returning * into a;
  if a.status = 'calificado' then perform public._cg_exam_write_grade(a); end if;
  if pending then
    insert into notifications (user_id, title, body, kind)
    select sb.teacher_id, 'Examen por revisar', p.full_name || ' entregó «' || e.title || '» y tiene preguntas por validar', 'examen'
    from subjects sb, profiles p where sb.id = e.subject_id and p.id = a.student_id and sb.teacher_id is not null;
  end if;
  return public.cg_exam_result(p_exam, null);
end $$;

-- resultado visible para el estudiante o su acudiente (respeta la regla del docente)
create or replace function public.cg_exam_result(p_exam uuid, p_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e record; a record; st uuid := coalesce(p_student, auth.uid()); visible boolean;
begin
  if st not in (select public.cg_my_children()) then raise exception 'No autorizado'; end if;
  select * into e from exams where id = p_exam;
  select * into a from exam_attempts where exam_id = p_exam and student_id = st;
  if a.id is null or a.submitted_at is null then return jsonb_build_object('status', coalesce(a.status, 'sin_iniciar')); end if;
  visible := a.status = 'calificado' or e.show_results = 'inmediato';
  return jsonb_build_object(
    'status', a.status, 'visible', visible, 'submitted_at', a.submitted_at, 'feedback', a.feedback,
    'auto_score', case when visible then a.auto_score end, 'score', case when visible then a.score end,
    'max_score', a.max_score, 'grade', case when a.status = 'calificado' then a.grade end,
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', q.id, 'kind', q.kind, 'prompt', q.prompt, 'options', q.options, 'justify', q.justify, 'points', q.points,
        'answer', a.answers -> q.id::text,
        'correct', case when visible and (a.status = 'calificado' or not q.justify) and q.kind <> 'cuaderno' then q.correct end,
        'auto_ok', case when visible then a.details -> q.id::text -> 'auto_ok' end,
        'pending', a.status <> 'calificado' and coalesce((a.details -> q.id::text ->> 'pending')::boolean, false),
        'earned', case when a.status = 'calificado' then coalesce((a.manual ->> q.id::text)::numeric, (a.details -> q.id::text ->> 'points')::numeric, 0)
                       when visible and not coalesce((a.details -> q.id::text ->> 'pending')::boolean, false) then (a.details -> q.id::text ->> 'points')::numeric end
      ) order by q.position) from exam_questions q where q.exam_id = p_exam), '[]'::jsonb));
end $$;

-- el docente valida las preguntas pendientes y cierra la calificación
create or replace function public.cg_exam_grade(p_attempt uuid, p_manual jsonb, p_feedback text) returns numeric
language plpgsql security definer set search_path = public as $$
declare a public.exam_attempts; e record; q record; total numeric := 0;
begin
  select * into a from exam_attempts where id = p_attempt;
  select * into e from exams where id = a.exam_id;
  if not (public.cg_is_admin() or public.cg_teaches_subject(e.subject_id)) then raise exception 'No autorizado'; end if;
  if a.submitted_at is null then raise exception 'El estudiante aún no entrega el examen'; end if;
  for q in select * from exam_questions where exam_id = e.id loop
    total := total + least(q.points, greatest(0, coalesce((p_manual ->> q.id::text)::numeric, (a.details -> q.id::text ->> 'points')::numeric, 0)));
  end loop;
  update exam_attempts set manual = coalesce(p_manual, '{}'::jsonb), feedback = p_feedback, score = total, status = 'calificado'
  where id = p_attempt returning * into a;
  perform public._cg_exam_write_grade(a);
  insert into notifications (user_id, title, body, kind)
  select uid, 'Examen calificado', '«' || e.title || '»: ' || total || ' / ' || a.max_score || ' puntos', 'examen'
  from (select a.student_id as uid union select parent_id from students where id = a.student_id) u where uid is not null;
  return total;
end $$;

-- el docente puede reabrir un intento (por ejemplo, si hubo un problema de conexión)
create or replace function public.cg_exam_reset_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select ex.* into e from exams ex join exam_attempts a on a.exam_id = ex.id where a.id = p_attempt;
  if not (public.cg_is_admin() or public.cg_teaches_subject(e.subject_id)) then raise exception 'No autorizado'; end if;
  delete from exam_attempts where id = p_attempt;
end $$;

-- edición completa de usuarios por el colegio (incluye cambio de usuario de acceso)
create or replace function public.cg_admin_update_user(uid uuid, p_username text, p_full_name text, p_doc text, p_phone text, p_email text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare em text := lower(trim(p_username)) || '@colegio.app';
begin
  if not public.cg_is_admin() then raise exception 'No autorizado'; end if;
  if p_username !~ '^[a-zA-Z0-9._-]{3,40}$' then raise exception 'Usuario inválido (3-40 caracteres: letras, números, . _ -)'; end if;
  if exists (select 1 from auth.users where email = em and id <> uid) then raise exception 'El usuario % ya existe', p_username; end if;
  update auth.users set email = em, updated_at = now() where id = uid;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', em) where user_id = uid and provider = 'email';
  update profiles set username = lower(trim(p_username)), full_name = p_full_name, doc_id = p_doc, phone = p_phone, email = p_email where id = uid;
end $$;

-- al publicar un comunicado se notifica a todos los perfiles seleccionados
create or replace function public.cg_trg_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, title, body, kind)
  select p.id, case new.kind when 'cierre' then '🏫 ' when 'actividad' then '📅 ' when 'publicidad' then '📣 ' else '📢 ' end || new.title,
         left(coalesce(new.body, ''), 160), 'aviso'
  from profiles p where p.role = any(new.roles) and p.id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  return new;
end $$;
drop trigger if exists announcement_notify on public.announcements;
create trigger announcement_notify after insert on public.announcements
  for each row execute function public.cg_trg_announcement();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$ declare t text;
begin
  foreach t in array array['profiles','cg_settings','rooms','groups','subjects','schedule','students','tasks','grades',
    'topics','attendance','events','documents','messages','notifications','exit_permissions','enrollments','class_sessions',
    'announcements','exams','exam_questions','exam_attempts']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- borra políticas previas para poder re-ejecutar
do $$ declare p record;
begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' and tablename = any(array['profiles','cg_settings','rooms','groups','subjects','schedule','students','tasks','grades',
    'topics','attendance','events','documents','messages','notifications','exit_permissions','enrollments','class_sessions',
    'announcements','exams','exam_questions','exam_attempts']) loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- profiles: cada quien se ve a sí mismo; el personal ve a todos; todos ven docentes/admin; padres ven a sus hijos
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or public.cg_is_staff() or role in ('teacher','admin') or id in (select public.cg_my_children())
);
create policy profiles_admin on public.profiles for update to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy settings_select on public.cg_settings for select to authenticated using (true);
create policy settings_admin on public.cg_settings for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy rooms_select on public.rooms for select to authenticated using (true);
create policy rooms_admin on public.rooms for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy groups_select on public.groups for select to authenticated using (true);
create policy groups_admin on public.groups for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy subjects_select on public.subjects for select to authenticated using (true);
create policy subjects_admin on public.subjects for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());
create policy subjects_teacher on public.subjects for update to authenticated using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create policy schedule_select on public.schedule for select to authenticated using (true);
create policy schedule_admin on public.schedule for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy students_select on public.students for select to authenticated using (
  public.cg_is_admin() or public.cg_my_role() = 'guard' or public.cg_teaches_group(group_id) or id in (select public.cg_my_children())
);
create policy students_admin on public.students for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy tasks_select on public.tasks for select to authenticated using (public.cg_can_see_subject(subject_id));
create policy tasks_write on public.tasks for all to authenticated
  using (public.cg_is_admin() or public.cg_teaches_subject(subject_id)) with check (public.cg_is_admin() or public.cg_teaches_subject(subject_id));

create policy grades_select on public.grades for select to authenticated using (
  public.cg_is_admin() or student_id in (select public.cg_my_children())
  or exists (select 1 from tasks t where t.id = task_id and public.cg_can_see_subject(t.subject_id) and public.cg_my_role() = 'teacher')
);
create policy grades_write on public.grades for all to authenticated
  using (public.cg_is_admin() or exists (select 1 from tasks t where t.id = task_id and public.cg_teaches_subject(t.subject_id)))
  with check (public.cg_is_admin() or exists (select 1 from tasks t where t.id = task_id and public.cg_teaches_subject(t.subject_id)));

create policy topics_select on public.topics for select to authenticated using (public.cg_can_see_subject(subject_id));
create policy topics_write on public.topics for all to authenticated
  using (public.cg_is_admin() or public.cg_teaches_subject(subject_id)) with check (public.cg_is_admin() or public.cg_teaches_subject(subject_id));

create policy attendance_select on public.attendance for select to authenticated using (
  public.cg_is_admin() or public.cg_teaches_student(student_id) or student_id in (select public.cg_my_children())
);
create policy attendance_write on public.attendance for all to authenticated
  using (public.cg_is_admin() or public.cg_teaches_student(student_id))
  with check (public.cg_is_admin() or (public.cg_teaches_student(student_id) and teacher_id = auth.uid()));

create policy events_select on public.events for select to authenticated using (
  group_id is null or public.cg_is_staff() or group_id in (select group_id from students where id in (select public.cg_my_children()))
);
create policy events_write on public.events for all to authenticated
  using (public.cg_is_admin() or created_by = auth.uid())
  with check (public.cg_is_admin() or (public.cg_my_role() = 'teacher' and created_by = auth.uid()));

create policy documents_select on public.documents for select to authenticated using (true);
create policy documents_admin on public.documents for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy messages_select on public.messages for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());
create policy messages_insert on public.messages for insert to authenticated with check (from_id = auth.uid() and public.cg_can_chat(to_id));
create policy messages_read on public.messages for update to authenticated using (to_id = auth.uid()) with check (to_id = auth.uid());

create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

create policy exits_select on public.exit_permissions for select to authenticated using (
  public.cg_is_admin() or public.cg_my_role() = 'guard' or student_id in (select public.cg_my_children())
  or exists (select 1 from students s join groups g on g.id = s.group_id where s.id = student_id and g.director_id = auth.uid())
);
create policy exits_insert on public.exit_permissions for insert to authenticated with check (
  requested_by = auth.uid() and status = 'autorizada' and (
    public.cg_is_admin()
    or exists (select 1 from students s where s.id = student_id and s.parent_id = auth.uid())
    or exists (select 1 from students s join groups g on g.id = s.group_id where s.id = student_id and g.director_id = auth.uid())
  )
);
create policy exits_update on public.exit_permissions for update to authenticated using (
  public.cg_is_admin() or requested_by = auth.uid()
  or exists (select 1 from students s join groups g on g.id = s.group_id where s.id = student_id and g.director_id = auth.uid())
);

create policy enroll_admin on public.enrollments for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy class_select on public.class_sessions for select to authenticated using (teacher_id = auth.uid() or public.cg_is_admin());
create policy class_update on public.class_sessions for update to authenticated using (teacher_id = auth.uid());

create policy ann_select on public.announcements for select to authenticated using (public.cg_is_admin() or public.cg_my_role() = any(roles));
create policy ann_admin on public.announcements for all to authenticated using (public.cg_is_admin()) with check (public.cg_is_admin());

create policy exams_select on public.exams for select to authenticated using (
  public.cg_is_admin() or public.cg_teaches_subject(subject_id)
  or (published and exists (select 1 from subjects sb join students s on s.group_id = sb.group_id
                             where sb.id = subject_id and s.id in (select public.cg_my_children())))
);
create policy exams_write on public.exams for all to authenticated
  using (public.cg_is_admin() or public.cg_teaches_subject(subject_id)) with check (public.cg_is_admin() or public.cg_teaches_subject(subject_id));

-- las preguntas (con sus respuestas correctas) sólo las ve el docente; el estudiante las recibe por cg_exam_start
create policy questions_teacher on public.exam_questions for all to authenticated
  using (public.cg_is_admin() or exists (select 1 from exams e where e.id = exam_id and public.cg_teaches_subject(e.subject_id)))
  with check (public.cg_is_admin() or exists (select 1 from exams e where e.id = exam_id and public.cg_teaches_subject(e.subject_id)));

-- los intentos sólo los ve el docente; estudiante y acudiente usan cg_my_exams / cg_exam_result
create policy attempts_teacher on public.exam_attempts for select to authenticated
  using (public.cg_is_admin() or exists (select 1 from exams e where e.id = exam_id and public.cg_teaches_subject(e.subject_id)));

-- funciones públicas: sólo las de matrícula para anónimos
-- (por defecto Postgres concede EXECUTE a PUBLIC; se retira y se concede sólo a usuarios autenticados)
do $$ declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'cg\_%' or p.proname like '\_cg\_%') loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.cg_submit_enrollment(jsonb, jsonb, text, text) to anon, authenticated;
grant execute on function public.cg_enrollment_status(text, text) to anon, authenticated;
grant execute on function public.cg_enrollment_config() to anon, authenticated;
revoke all on function public._cg_create_auth_user from public, anon, authenticated;
revoke all on function public._cg_set_password from public, anon, authenticated;
revoke all on function public._cg_exam_write_grade from public, anon, authenticated;
revoke all on function public._cg_exam_can_take from public, anon;
grant execute on function public._cg_exam_can_take(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table public.attendance; exception when others then null; end;
  begin alter publication supabase_realtime add table public.announcements; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- STORAGE (buckets privados + URLs firmadas)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('colegio-documentos','colegio-documentos', false), ('colegio-tareas','colegio-tareas', false), ('colegio-chat','colegio-chat', false),
  ('colegio-clases','colegio-clases', false), ('colegio-matriculas','colegio-matriculas', false),
  ('colegio-comunicados','colegio-comunicados', false)
on conflict (id) do nothing;

do $$ declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'colegio_%' loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

create policy colegio_read on storage.objects for select to authenticated
  using (bucket_id in ('colegio-documentos','colegio-tareas','colegio-chat','colegio-clases','colegio-comunicados') or (bucket_id = 'colegio-matriculas' and public.cg_is_admin()));
create policy colegio_docs_write on storage.objects for insert to authenticated
  with check (bucket_id in ('colegio-documentos','colegio-comunicados') and public.cg_is_admin());
create policy colegio_tasks_write on storage.objects for insert to authenticated
  with check (bucket_id = 'colegio-tareas' and public.cg_my_role() in ('teacher','admin'));
create policy colegio_chat_write on storage.objects for insert to authenticated
  with check (bucket_id in ('colegio-chat','colegio-clases'));
create policy colegio_enroll_write on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'colegio-matriculas');
create policy colegio_delete on storage.objects for delete to authenticated
  using (public.cg_is_admin() or (bucket_id = 'colegio-tareas' and owner = auth.uid()));

-- ---------------------------------------------------------------------
-- DATOS INICIALES
-- ---------------------------------------------------------------------
insert into public.cg_settings (key, value) values
  ('grading', '{"scale":"1-5","teacher_can_choose":true}'::jsonb),
  ('school', '{"name":"Colegio","city":"Colombia","year":2026}'::jsonb),
  ('enrollment', '{"open":true,"required_docs":["Registro civil o tarjeta de identidad","Boletín o certificado del último año cursado","Paz y salvo del colegio anterior","Certificado de afiliación a EPS","Carné de vacunas (preescolar y primaria)"]}'::jsonb)
on conflict (key) do nothing;

do $$ begin
  if not exists (select 1 from public.profiles where username = 'admin') then
    perform public._cg_create_auth_user('admin', '1234', 'admin', 'Administrador del colegio');
  end if;
end $$;
