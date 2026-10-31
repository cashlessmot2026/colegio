# EduControl · PWA de gestión escolar

Aplicación web progresiva (instalable como app en Android, iOS y escritorio). Está hecha con **React + Vite**, animada con **Motion** y usa **Supabase** (Postgres, Auth, Realtime y Storage).

## Interfaces

| Interfaz | Acceso | Funciones |
|---|---|---|
| 👨‍👩‍👧 **Padres de familia** | `/` | Consolidado de notas, notas por tarea, boletines por periodo (PDF), cronograma semanal, ubicación actual (salón y docente), asistencia, horario, salidas pedagógicas, solicitud de salida con geolocalización, documentos institucionales, chat con docentes, EPS/clínica, segundo responsable y contraseña del hijo |
| 🎒 **Estudiantes** | `/` | Notas, exámenes, clase virtual (código de 4 dígitos, solo audio, levantar la mano, subir archivos), agenda, horario y chat con docentes |
| 🧑‍🏫 **Docentes** | `/` | Asistencia del salón (según la rotación), reporte PDF por día o mes, tareas con notas y guías PDF, cronograma por temas, escala de calificación, dirección de grupo, clase virtual con video y audio, actividades y chat |
| 🏫 **Colegio (admin)** | `/` | Analítica por salón y por mes, ranking de docentes y de estudiantes, escala institucional, creación de docentes y estudiantes, grupos, salones, horarios, documentos, matrículas, vigilancia y chat |
| 🛡️ **Portería** | `/#/vigilante` | Escaneo del QR o digitación del documento, ✔ verde animado si el estudiante está autorizado y ✖ rojo si no, registro de la salida y chat |
| 📝 **Matrículas** (público) | `/#/matricula` | Formulario por pasos, documentos adjuntos, firmas digitales y línea de tiempo del estado |

## Puesta en marcha

1. **Base de datos.** En Supabase abre *SQL Editor*, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo.
   - Crea el usuario inicial **`admin` / `1234`**. Cambia esa contraseña desde el menú "🔑 Clave".
   - Si quieres datos de prueba, ejecuta también [`supabase/demo.sql`](supabase/demo.sql). Todas las cuentas demo usan la contraseña `demo1234`.
2. **Recomendado.** En *Authentication → Providers → Email* desactiva **"Allow new users to sign up"**: los usuarios los crea solo el colegio.
3. **Local.**
   ```bash
   npm install
   npm run dev      # http://localhost:5173
   npm run build    # genera dist/ listo para publicar (Vercel, Netlify, etc.)
   ```

La URL y la *anon key* de Supabase están en `.env`. La anon key es pública por diseño: la seguridad la aplican las políticas RLS.

## Seguridad

- Las contraseñas solo existen cifradas con **bcrypt** dentro de Supabase. El cliente no contiene ninguna credencial.
- El colegio asigna usuarios y contraseñas. El padre asigna y cambia la contraseña de su hijo.
- **RLS en todas las tablas**: un acudiente solo ve a sus hijos, un docente solo a sus grupos y el estudiante solo lo suyo.
- **Sesión única**: si alguien entra con la misma cuenta en otro dispositivo, la sesión anterior se cierra.
- Las clases virtuales solo admiten estudiantes del salón (lo valida la base de datos) y una conexión por usuario.
- Los archivos están en buckets privados y se descargan con URLs firmadas que vencen en una hora.

## Escalas de calificación (Colombia, Decreto 1290 de 2009)

| Escala | Bajo | Básico | Alto | Superior |
|---|---|---|---|---|
| 1.0 – 5.0 (la más usada) | 1.0–2.9 | 3.0–3.9 | 4.0–4.5 | 4.6–5.0 |
| 1 – 10 | 1.0–5.9 | 6.0–7.9 | 8.0–9.4 | 9.5–10 |
| 0 – 100 | 0–59 | 60–79 | 80–94 | 95–100 |

El colegio elige la escala institucional y puede permitir que cada docente use otra en su asignatura.

## Notas técnicas

- **Notificaciones**: las alertas de inasistencia, salidas, mensajes y clases llegan en tiempo real (Supabase Realtime) y se muestran como notificaciones del sistema mientras la app está abierta o en segundo plano. Para recibir push con la app totalmente cerrada hace falta desplegar una Edge Function con Web Push (VAPID).
- **Clases virtuales**: WebRTC entre pares con señalización por Realtime. El docente transmite video y audio a cada estudiante, y cada estudiante le envía solo su audio. Con más de unos 25 estudiantes o redes muy restrictivas conviene agregar un servidor TURN o un SFU como LiveKit.
- La cámara, el micrófono, la geolocalización y la instalación como PWA requieren **HTTPS** (o `localhost`).
