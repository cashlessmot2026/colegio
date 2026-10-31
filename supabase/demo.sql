-- =====================================================================
--  DATOS DE DEMOSTRACIÓN (opcional) · ejecutar DESPUÉS de schema.sql
--  Crea salones, 2 grupos, docentes, padres, estudiantes, horario, tareas y notas.
--  Contraseña de todas las cuentas demo: demo1234   (bórrelas antes de producción)
--    Docentes:     profe.mate · profe.lengua · profe.ciencias
--    Padres:       papa.gomez · mama.ruiz
--    Estudiantes:  sofia.gomez · mateo.gomez · valentina.ruiz · samuel.ruiz
--    Vigilante:    porteria
-- =====================================================================
do $$
declare
  t1 uuid; t2 uuid; t3 uuid; p1 uuid; p2 uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; g1 uuid; g2 uuid;
  r1 uuid; r2 uuid; r3 uuid; r4 uuid;
  m6 uuid; l6 uuid; c6 uuid; m7 uuid; l7 uuid; c7 uuid; tk uuid; d int; st uuid;
begin
  if exists (select 1 from profiles where username = 'profe.mate') then raise notice 'Demo ya cargada'; return; end if;

  t1 := _cg_create_auth_user('profe.mate', 'demo1234', 'teacher', 'Andrea Martínez', '52111222', '3001112233', 'andrea@colegio.demo');
  t2 := _cg_create_auth_user('profe.lengua', 'demo1234', 'teacher', 'Carlos Rodríguez', '79333444', '3002223344', 'carlos@colegio.demo');
  t3 := _cg_create_auth_user('profe.ciencias', 'demo1234', 'teacher', 'Luisa Fernández', '1020304050', '3003334455', 'luisa@colegio.demo');
  p1 := _cg_create_auth_user('papa.gomez', 'demo1234', 'parent', 'Jorge Gómez', '80123456', '3104445566', 'jorge@correo.demo');
  p2 := _cg_create_auth_user('mama.ruiz', 'demo1234', 'parent', 'Patricia Ruiz', '52987654', '3115556677', 'patricia@correo.demo');
  perform _cg_create_auth_user('porteria', 'demo1234', 'guard', 'Hernán Vigilante', '1098765', '3126667788', null);

  insert into rooms (name) values ('Salón 101') returning id into r1;
  insert into rooms (name) values ('Salón 102') returning id into r2;
  insert into rooms (name) values ('Laboratorio de ciencias') returning id into r3;
  insert into rooms (name) values ('Sala de informática') returning id into r4;

  insert into groups (name, grade, director_id) values ('6°A', 6, t1) returning id into g1;
  insert into groups (name, grade, director_id) values ('7°A', 7, t2) returning id into g2;

  insert into subjects (name, group_id, teacher_id, color) values ('Matemáticas', g1, t1, '#7c5cff') returning id into m6;
  insert into subjects (name, group_id, teacher_id, color) values ('Lengua castellana', g1, t2, '#00e5ff') returning id into l6;
  insert into subjects (name, group_id, teacher_id, color) values ('Ciencias naturales', g1, t3, '#3ddc97') returning id into c6;
  insert into subjects (name, group_id, teacher_id, color) values ('Matemáticas', g2, t1, '#7c5cff') returning id into m7;
  insert into subjects (name, group_id, teacher_id, color) values ('Lengua castellana', g2, t2, '#00e5ff') returning id into l7;
  insert into subjects (name, group_id, teacher_id, color) values ('Ciencias naturales', g2, t3, '#3ddc97') returning id into c7;

  -- rotación de salones: los grupos cambian de salón físico según el bloque
  for d in 1..5 loop
    insert into schedule (group_id, subject_id, room_id, day, start_time, end_time) values
      (g1, m6, r1, d, '07:00', '08:30'), (g1, l6, r2, d, '08:30', '10:00'), (g1, c6, r3, d, '10:30', '12:00'), (g1, m6, r4, d, '12:00', '13:00'),
      (g2, l7, r1, d, '07:00', '08:30'), (g2, c7, r3, d, '08:30', '10:00'), (g2, m7, r2, d, '10:30', '12:00'), (g2, l7, r4, d, '12:00', '13:00');
  end loop;

  s1 := _cg_create_auth_user('sofia.gomez', 'demo1234', 'student', 'Sofía Gómez', '1011223344');
  s2 := _cg_create_auth_user('mateo.gomez', 'demo1234', 'student', 'Mateo Gómez', '1011223355');
  s3 := _cg_create_auth_user('valentina.ruiz', 'demo1234', 'student', 'Valentina Ruiz', '1011223366');
  s4 := _cg_create_auth_user('samuel.ruiz', 'demo1234', 'student', 'Samuel Ruiz', '1011223377');
  insert into students (id, group_id, doc_id, birth_date, eps, clinic, blood_type, parent_id, guardian2) values
    (s1, g1, '1011223344', '2014-03-10', 'Sura', 'Clínica Las Américas', 'O+', p1, '{"name":"Marta Gómez","relation":"Abuela","phone":"3201112233"}'),
    (s2, g2, '1011223355', '2013-07-22', 'Sura', 'Clínica Las Américas', 'A+', p1, '{"name":"Marta Gómez","relation":"Abuela","phone":"3201112233"}'),
    (s3, g1, '1011223366', '2014-01-05', 'Sanitas', null, 'B+', p2, '{}'),
    (s4, g2, '1011223377', '2013-11-30', 'Compensar', 'Hospital San José', 'O-', p2, '{}');

  -- tareas y notas (escala 1.0 a 5.0)
  foreach st in array array[m6, l6, c6, m7, l7, c7] loop
    insert into tasks (subject_id, title, description, kind, period, due_date, weight)
      values (st, 'Taller diagnóstico', 'Resolver el taller de la guía 1', 'taller', 1, current_date - 20, 1) returning id into tk;
    insert into grades (task_id, student_id, value)
      select tk, s.id, round((3 + random() * 2)::numeric, 1) from students s join subjects sb on sb.group_id = s.group_id where sb.id = st;
    insert into tasks (subject_id, title, description, kind, period, due_date, weight)
      values (st, 'Evaluación periodo 1', 'Examen escrito de los temas vistos', 'examen', 1, current_date - 5, 2) returning id into tk;
    insert into grades (task_id, student_id, value)
      select tk, s.id, round((2.5 + random() * 2.5)::numeric, 1) from students s join subjects sb on sb.group_id = s.group_id where sb.id = st;
    insert into tasks (subject_id, title, description, kind, period, due_date, weight)
      values (st, 'Proyecto de aula', 'Exposición por grupos', 'proyecto', 2, current_date + 10, 1);
    insert into topics (subject_id, week_start, title, description, done) values
      (st, date_trunc('week', current_date)::date - 7, 'Repaso de conceptos previos', 'Actividad de nivelación', true),
      (st, date_trunc('week', current_date)::date, 'Tema central de la unidad', 'Clase magistral + taller práctico', false),
      (st, date_trunc('week', current_date)::date + 7, 'Aplicación y proyecto', 'Trabajo colaborativo', false);
  end loop;

  insert into attendance (student_id, subject_id, date, status, teacher_id) values
    (s1, m6, current_date - 1, 'presente', t1), (s3, m6, current_date - 1, 'ausente', t1),
    (s2, l7, current_date - 1, 'tarde', t2), (s4, l7, current_date - 1, 'presente', t2);

  insert into events (title, kind, place, starts_at, ends_at, responsible, description, requirements, cost, group_id, created_by) values
    ('Salida pedagógica al Museo de Ciencias', 'salida', 'Museo interactivo Maloka, Bogotá', now() + interval '12 days', now() + interval '12 days 6 hours',
     'Luisa Fernández', 'Recorrido guiado por las salas de biología y física.', 'Uniforme de educación física, refrigerio, autorización firmada', 35000, g1, t3),
    ('Reunión de padres de familia', 'reunion', 'Auditorio principal', now() + interval '5 days', null, 'Rectoría', 'Entrega de informes del primer periodo.', null, null, null, null);
end $$;
