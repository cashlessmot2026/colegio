// Pulseras NFC con Web NFC (Chrome para Android, requiere HTTPS).
// Se usa el número de serie (UID) de la pulsera; también sirve un lector USB que lo "escribe" como teclado.

export const nfcSupported = () => typeof window !== 'undefined' && 'NDEFReader' in window;

// "04:a2:3b:1c" → "04A23B1C" (mismo formato que guarda la base de datos)
export const normalizeUid = (x) => (x || '').replace(/[^0-9a-f]/gi, '').toUpperCase();

export const prettyUid = (x) => normalizeUid(x).match(/.{1,2}/g)?.join(':') || '';

/**
 * Escucha pulseras NFC. Llama onTag(uid) por cada lectura hasta que se aborte la señal.
 * Devuelve una función para detener.
 */
export async function listenNfc(onTag, onError) {
  if (!nfcSupported()) throw new Error('Este dispositivo no soporta NFC en el navegador. Use Chrome en Android o un lector USB.');
  const ctrl = new AbortController();
  const reader = new window.NDEFReader();
  let last = { uid: '', at: 0 };
  reader.onreading = (ev) => {
    const uid = normalizeUid(ev.serialNumber);
    if (!uid) { onError?.(new Error('No se pudo leer el número de serie de la pulsera')); return; }
    // evita lecturas duplicadas mientras la pulsera sigue cerca del teléfono
    if (uid === last.uid && Date.now() - last.at < 2500) return;
    last = { uid, at: Date.now() };
    if (navigator.vibrate) navigator.vibrate(60);
    onTag(uid);
  };
  reader.onreadingerror = () => onError?.(new Error('No se pudo leer la pulsera. Acérquela de nuevo.'));
  try {
    await reader.scan({ signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'NotAllowedError') throw new Error('Permiso de NFC denegado. Actívelo en la configuración del navegador.');
    if (e.name === 'NotSupportedError') throw new Error('El NFC del teléfono está apagado o no es compatible.');
    throw e;
  }
  return () => ctrl.abort();
}

// Lee una sola pulsera (para asignarla)
export function readOnce(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let stop = null;
    const t = setTimeout(() => { stop?.(); reject(new Error('No se detectó ninguna pulsera')); }, timeoutMs);
    listenNfc((uid) => { clearTimeout(t); stop?.(); resolve(uid); }, () => {})
      .then((s) => { stop = s; })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}
