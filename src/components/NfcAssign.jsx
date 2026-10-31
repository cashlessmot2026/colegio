import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase.js';
import { listenNfc, nfcSupported, normalizeUid, prettyUid } from '../lib/nfc.js';
import { Modal, GlowButton, Field, useToast } from './ui.jsx';

// Ondas animadas de "acerque la pulsera"
export function NfcPulse({ active, label }) {
  return (
    <div className="nfc-pulse">
      {active && [0, 1, 2].map((i) => (
        <motion.span key={i} className="nfc-ring" initial={{ scale: 0.4, opacity: 0.8 }} animate={{ scale: 2.2, opacity: 0 }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.65, ease: 'easeOut' }} />
      ))}
      <motion.div className="nfc-core" animate={active ? { scale: [1, 1.08, 1] } : {}} transition={{ repeat: Infinity, duration: 1.4 }}>📿</motion.div>
      {label && <p className="small muted" style={{ marginTop: 12, textAlign: 'center' }}>{label}</p>}
    </div>
  );
}

// Asignar / cambiar / quitar la pulsera NFC de un estudiante (panel del colegio)
export default function NfcAssign({ student, onClose, onSaved }) {
  const toast = useToast();
  const [uid, setUid] = useState('');
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(!nfcSupported());
  const stopRef = useRef(null);
  const name = student?.profile?.full_name;

  const stop = () => { stopRef.current?.(); stopRef.current = null; setScanning(false); };
  useEffect(() => { setUid(''); setManual(!nfcSupported()); return stop; }, [student?.id]); // eslint-disable-line

  const scan = async () => {
    setUid(''); setScanning(true);
    try {
      stopRef.current = await listenNfc((u) => { setUid(u); stop(); }, (e) => toast(e));
    } catch (e) { toast(e); setScanning(false); setManual(true); }
  };
  const save = async (value) => {
    const v = value === null ? null : normalizeUid(value);
    if (value !== null && (!v || v.length < 4)) return toast(new Error('Código de pulsera inválido'));
    const { error } = await supabase.from('students').update({ nfc_uid: v }).eq('id', student.id);
    if (error) return toast(new Error(/duplicate|unique/i.test(error.message) ? 'Esta pulsera ya está asignada a otro estudiante' : error.message));
    toast(v ? `Pulsera asignada a ${name}` : 'Pulsera desvinculada');
    onSaved();
  };

  return (
    <Modal open={!!student} onClose={() => { stop(); onClose(); }} title={`📿 Pulsera NFC · ${name || ''}`}>
      {student && (
        <div className="col" style={{ gap: 14 }}>
          {student.nfc_uid && (
            <div className="list-item" style={{ alignItems: 'center' }}>
              <span>✅</span><div style={{ flex: 1 }}><strong>Pulsera actual</strong><div className="small muted mono">{prettyUid(student.nfc_uid)}</div></div>
              <GlowButton size="sm" variant="bad" onClick={() => window.confirm('¿Desvincular la pulsera? El estudiante ya no podrá identificarse con ella.') && save(null)}>Desvincular</GlowButton>
            </div>
          )}
          {!manual && (
            <div className="col" style={{ alignItems: 'center' }}>
              <NfcPulse active={scanning} label={scanning ? 'Acerque la pulsera a la parte trasera del teléfono…' : 'Pulse “Leer pulsera” y acérquela al teléfono'} />
              {scanning ? <GlowButton variant="bad" onClick={stop}>Cancelar</GlowButton> : <GlowButton variant="solid" size="lg" onClick={scan}>📲 Leer pulsera</GlowButton>}
            </div>
          )}
          {manual && (
            <Field label="Código (UID) de la pulsera: digítelo o use un lector NFC USB sobre este campo">
              <input autoFocus className="mono" placeholder="04:A2:3B:1C:5D:80" value={uid} onChange={(e) => setUid(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save(uid)} />
            </Field>
          )}
          <AnimatePresence>
            {uid && !manual && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="list-item" style={{ alignItems: 'center', borderColor: 'var(--ok)' }}>
                <span style={{ fontSize: 22 }}>📿</span><div style={{ flex: 1 }}><strong>Pulsera detectada</strong><div className="small mono">{prettyUid(uid)}</div></div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="row">
            <button type="button" className="small" style={{ background: 'none', border: 0, color: 'var(--b)', cursor: 'pointer', padding: 0 }} onClick={() => { stop(); setManual(!manual); }}>
              {manual ? (nfcSupported() ? '📲 Leer con el NFC del teléfono' : '') : '⌨️ Ingresar el código manualmente / lector USB'}
            </button>
            <span className="spacer" />
            <GlowButton variant="ok" disabled={!uid} onClick={() => save(uid)}>{student.nfc_uid ? 'Reemplazar pulsera' : 'Asignar pulsera'}</GlowButton>
          </div>
          {!nfcSupported() && <p className="small muted">Este navegador no tiene NFC. Para leer pulseras con el celular use <b>Chrome en Android</b>; en computador conecte un lector NFC USB.</p>}
        </div>
      )}
    </Modal>
  );
}
