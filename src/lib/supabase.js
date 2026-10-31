import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'colegio-auth' },
  realtime: { params: { eventsPerSecond: 20 } },
});

// Los usuarios los asigna el colegio; internamente Supabase Auth usa un correo sintético.
export const usernameToEmail = (u) => `${u.trim().toLowerCase()}@colegio.app`;

// Lanza un error legible si la consulta falla
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(translate(error.message));
  return data;
}

export const rpc = (fn, args) => q(supabase.rpc(fn, args));

function translate(msg = '') {
  if (/Invalid login credentials/i.test(msg)) return 'Usuario o contraseña incorrectos';
  if (/row-level security/i.test(msg)) return 'No tiene permiso para esta acción';
  if (/duplicate key/i.test(msg)) return 'El registro ya existe';
  if (/Failed to fetch/i.test(msg)) return 'Sin conexión con el servidor';
  if (/Could not find the (table|function)/i.test(msg)) return 'La base de datos está desactualizada: ejecute de nuevo supabase/schema.sql en el SQL Editor de Supabase';
  return msg;
}

// Subida de archivos a Storage (buckets privados) y descarga con URL firmada
export async function upload(bucket, file, prefix = '') {
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_');
  const path = `${prefix ? prefix + '/' : ''}${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(translate(error.message));
  return { path, name: file.name };
}

export async function signedUrl(bucket, path, download) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error) throw new Error(translate(error.message));
  return data.signedUrl;
}

// Abre la pestaña de forma síncrona (evita el bloqueador de ventanas) y luego carga la URL firmada.
// Con `name` fuerza la descarga con ese nombre de archivo.
export async function openFile(bucket, path, name) {
  const w = window.open('about:blank', '_blank');
  try {
    const u = await signedUrl(bucket, path, name);
    if (w) w.location.href = u; else window.location.href = u;
  } catch (e) { w?.close(); throw e; }
}
