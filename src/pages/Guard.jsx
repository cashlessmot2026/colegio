import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Html5Qrcode } from 'html5-qrcode';
import Shell from '../components/Shell.jsx';
import Chat from '../components/Chat.jsx';
import { AnnouncementsFeed } from '../components/Announcements.jsx';
import { supabase, q, rpc } from '../lib/supabase.js';
import { todayISO, fmtDateTime } from '../lib/dates.js';
import { Card, GlowButton, Empty, Verdict, useToast, useAsync, Async, Stagger, StaggerItem } from '../components/ui.jsx';

const NAV = [
  { key: 'verificar', label: 'Verificar salida', icon: '🛡️' },
  { key: 'hoy', label: 'Salidas de hoy', icon: '🚪' },
  { key: 'chat', label: 'Chat', icon: '💬' },
  { key: 'avisos', label: 'Avisos', icon: '📢' },
];

export default function Guard() {
  const [tab, setTab] = useState('verificar');
  return (
    <Shell nav={NAV} active={tab} onNav={setTab} title={NAV.find((n) => n.key === tab)?.label} subtitle="Portería · control de salida en jornada escolar">
      {tab === 'verificar' && <Verify />}
      {tab === 'hoy' && <Today />}
      {tab === 'chat' && <Chat />}
      {tab === 'avisos' && <AnnouncementsFeed />}
    </Shell>
  );
}

function Verify() {
  const toast = useToast();
  const [doc, setDoc] = useState('');
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const scanner = useRef(null);

  const check = async (value) => {
    const v = (value ?? doc).trim();
    if (!v) return;
    setBusy(true);
    try {
      const [r] = await rpc('cg_guard_check', { p_doc: v });
      setResult(r);
      if (navigator.vibrate) navigator.vibrate(r?.authorized ? 80 : [200, 80, 200]);
    } catch (e) { toast(e); } finally { setBusy(false); }
  };

  const stopScan = async () => {
    try { if (scanner.current?.isScanning) await scanner.current.stop(); } catch { /* ya detenido */ }
    setScanning(false);
  };
  const startScan = async () => {
    setResult(null); setScanning(true);
    await new Promise((r) => setTimeout(r, 50));
    try {
      scanner.current = new Html5Qrcode('qr-reader');
      await scanner.current.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, async (text) => {
        await stopScan(); setDoc(text); check(text);
      });
    } catch { toast(new Error('No se pudo abrir la cámara. Digite el documento manualmente.')); setScanning(false); }
  };
  useEffect(() => () => { stopScan(); }, []); // eslint-disable-line

  const registerExit = async () => {
    try { await rpc('cg_guard_register_exit', { p_id: result.permission_id }); toast('Salida registrada. Se notificó al acudiente y al director de grupo.'); setResult(null); setDoc(''); } catch (e) { toast(e); }
  };

  return (
    <div className="grid g2">
      <Card glow title="Identificar estudiante">
        <div className="col">
          <AnimatePresence>
            {scanning && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}><div id="qr-reader" /></motion.div>}
          </AnimatePresence>
          {scanning ? <GlowButton variant="bad" onClick={stopScan}>Detener cámara</GlowButton> : <GlowButton variant="solid" size="lg" onClick={startScan}>📷 Escanear QR del carné</GlowButton>}
          <div className="row muted small" style={{ justifyContent: 'center' }}>— o —</div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); check(); }}>
            <input inputMode="numeric" placeholder="Número de documento del estudiante" value={doc} onChange={(e) => setDoc(e.target.value)} style={{ flex: 1, width: 'auto', fontSize: '1.1rem' }} />
            <GlowButton type="submit" disabled={busy}>{busy ? '…' : 'Verificar'}</GlowButton>
          </form>
        </div>
      </Card>
      <div>
        <AnimatePresence mode="wait">
          {!result ? (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Card><Empty icon="🛡️">Escanee o digite el documento para verificar la autorización</Empty></Card></motion.div>
          ) : (
            <motion.div key={result.permission_id || result.student_id || 'x'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Card glow>
                <Verdict ok={result.authorized} title={result.authorized ? 'AUTORIZADO' : 'NO AUTORIZADO'}>
                  {result.full_name && <h2>{result.full_name}</h2>}
                  {result.group_name && <p className="muted">Grupo {result.group_name}</p>}
                  <p style={{ marginTop: 8 }}>{result.reason}</p>
                  {result.authorized && (
                    <div className="col small" style={{ marginTop: 10, gap: 4 }}>
                      <span>👤 Recoge: <strong>{result.pickup_person}</strong></span>
                      <span>✍️ Autoriza: {result.requested_by} ({result.requester_role === 'parent' ? 'acudiente' : result.requester_role})</span>
                      <span className="muted">{fmtDateTime(result.created_at)}</span>
                      <GlowButton variant="ok" size="lg" onClick={registerExit} style={{ marginTop: 10 }}>🚪 Registrar salida</GlowButton>
                    </div>
                  )}
                  {!result.authorized && <p className="small muted" style={{ marginTop: 10 }}>No permita la salida. Use el chat para comunicarse con el director de grupo, el colegio o el acudiente.</p>}
                </Verdict>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Today() {
  const st = useAsync(() => q(supabase.from('exit_permissions').select('*, student:students(doc_id, profile:profiles!students_id_fkey(full_name))').eq('valid_date', todayISO()).order('created_at', { ascending: false })), []);
  useEffect(() => { const t = setInterval(st.reload, 30000); return () => clearInterval(t); }, []); // eslint-disable-line
  return (
    <Card title="Autorizaciones del día">
      <Async state={st}>{(rows) => !rows.length ? <Empty icon="🚪">No hay salidas autorizadas hoy</Empty> : (
        <Stagger>{rows.map((e) => (
          <StaggerItem key={e.id} className="list-item" style={{ alignItems: 'center' }}>
            <span style={{ fontSize: 24 }}>{e.status === 'usada' ? '✅' : e.status === 'revocada' ? '⛔' : '🟢'}</span>
            <div style={{ flex: 1 }}><strong>{e.student?.profile?.full_name}</strong><div className="small muted">Doc. {e.student?.doc_id} · {e.reason} · Recoge: {e.pickup_person}</div></div>
            <span className={`badge ${e.status === 'usada' ? 'ok' : e.status === 'revocada' ? 'bad' : 'info'}`}>{e.status === 'usada' ? `Salió ${new Date(e.used_at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : e.status}</span>
          </StaggerItem>
        ))}</Stagger>
      )}</Async>
    </Card>
  );
}
