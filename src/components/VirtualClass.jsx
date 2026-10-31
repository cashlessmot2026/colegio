import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase, upload, openFile, rpc } from '../lib/supabase.js';
import { useAuth } from '../context.jsx';
import { GlowButton, Avatar, Card, Empty, useToast } from './ui.jsx';

const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

/**
 * Aula virtual en topología estrella:
 *  - Docente: envía video + audio a cada estudiante y recibe el audio de cada uno.
 *  - Estudiante: sólo audio (micrófono), recibe video + audio del docente.
 * La señalización WebRTC viaja por un canal Realtime cuyo nombre contiene un secreto
 * que sólo entrega la base de datos (start_class / join_class) a usuarios autorizados.
 * Presence garantiza una sola conexión por usuario.
 */
export default function VirtualClass({ role, session, roster = [], onExit }) {
  const { profile } = useAuth();
  const toast = useToast();
  const me = profile.id;
  const isTeacher = role === 'teacher';

  const [people, setPeople] = useState({});      // presencia: id -> meta
  const [files, setFiles] = useState([]);
  const [chat, setChat] = useState([]);
  const [msg, setMsg] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [hand, setHand] = useState(false);
  const [teacherHere, setTeacherHere] = useState(false);
  const [blocked, setBlocked] = useState('');
  const [remoteAudio, setRemoteAudio] = useState({}); // estudiante -> stream (docente)

  const videoRef = useRef(null);
  const localStream = useRef(null);
  const videoTrack = useRef(null);
  const camTrack = useRef(null);
  const pcs = useRef({});        // peerId -> { pc, conn, pending: [] }
  const channel = useRef(null);
  const myConn = useRef(crypto.randomUUID());
  const joinedAt = useRef(Date.now());
  const rosterIds = useRef(new Set(roster.map((r) => r.id)));
  const fileRef = useRef(null);

  const send = (event, payload) => channel.current?.send({ type: 'broadcast', event, payload: { ...payload, from: me } });
  const track = (extra = {}) => channel.current?.track({ name: profile.full_name, role, conn: myConn.current, joined: joinedAt.current, hand, mic: micOn, ...extra });

  // --------- conexión con un par ---------
  const closePeer = (id) => { pcs.current[id]?.pc.close(); delete pcs.current[id]; setRemoteAudio((x) => { const y = { ...x }; delete y[id]; return y; }); };

  const newPc = (peerId, conn) => {
    closePeer(peerId);
    const pc = new RTCPeerConnection(ICE);
    const entry = { pc, conn, pending: [] };
    pcs.current[peerId] = entry;
    pc.onicecandidate = (e) => e.candidate && send('signal', { to: peerId, type: 'ice', data: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      if (isTeacher) setRemoteAudio((x) => ({ ...x, [peerId]: e.streams[0] }));
      else if (videoRef.current) videoRef.current.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') closePeer(peerId); };
    return entry;
  };

  const offerTo = async (studentId, conn) => {
    const { pc } = newPc(studentId, conn);
    localStream.current.getAudioTracks().forEach((t) => pc.addTrack(t, localStream.current));
    if (videoTrack.current) pc.addTrack(videoTrack.current, localStream.current);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send('signal', { to: studentId, type: 'offer', data: offer });
  };

  const flush = async (entry) => { for (const c of entry.pending.splice(0)) await entry.pc.addIceCandidate(c).catch(() => {}); };

  const onSignal = async ({ payload: s }) => {
    if (s.to !== me) return;
    try {
      if (s.type === 'offer' && !isTeacher) {
        const entry = newPc(s.from);
        await entry.pc.setRemoteDescription(s.data);
        localStream.current?.getAudioTracks().forEach((t) => entry.pc.addTrack(t, localStream.current));
        const ans = await entry.pc.createAnswer();
        await entry.pc.setLocalDescription(ans);
        send('signal', { to: s.from, type: 'answer', data: ans });
        await flush(entry);
      } else if (s.type === 'answer' && isTeacher) {
        const entry = pcs.current[s.from];
        if (entry) { await entry.pc.setRemoteDescription(s.data); await flush(entry); }
      } else if (s.type === 'ice') {
        const entry = pcs.current[s.from];
        if (!entry) return;
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(s.data).catch(() => {});
        else entry.pending.push(s.data);
      }
    } catch (e) { console.warn('señalización', e); }
  };

  // --------- ciclo de vida ---------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        localStream.current = await navigator.mediaDevices.getUserMedia(isTeacher ? { audio: true, video: { width: 1280, height: 720 } } : { audio: true, video: false });
      } catch {
        toast(new Error(isTeacher ? 'No se pudo acceder a cámara/micrófono. Revise los permisos del navegador.' : 'No se pudo acceder al micrófono. Podrá escuchar la clase.'));
        try { localStream.current = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { localStream.current = new MediaStream(); }
      }
      if (cancelled) { localStream.current.getTracks().forEach((t) => t.stop()); return; }
      if (isTeacher) {
        camTrack.current = videoTrack.current = localStream.current.getVideoTracks()[0] || null;
        if (videoRef.current) { videoRef.current.srcObject = localStream.current; videoRef.current.muted = true; }
      }

      const ch = supabase.channel(`aula-${session.secret}`, { config: { presence: { key: me }, broadcast: { self: false } } });
      channel.current = ch;
      ch.on('broadcast', { event: 'signal' }, onSignal)
        .on('broadcast', { event: 'file' }, ({ payload }) => setFiles((x) => [...x, payload]))
        .on('broadcast', { event: 'msg' }, ({ payload }) => setChat((x) => [...x, payload]))
        .on('broadcast', { event: 'mute' }, ({ payload }) => {
          if (payload.to === me) { localStream.current?.getAudioTracks().forEach((t) => (t.enabled = false)); setMicOn(false); toast('El docente silenció tu micrófono', 'info'); }
        })
        .on('broadcast', { event: 'lower' }, ({ payload }) => { if (payload.to === me) setHand(false); })
        .on('broadcast', { event: 'end' }, () => { toast('El docente finalizó la clase', 'info'); onExit?.(); })
        .on('presence', { event: 'sync' }, () => {
          const state = ch.presenceState();
          // una sola sesión por usuario: si hay otra conexión más antigua con mi usuario, esta se retira
          const mine = (state[me] || []).slice().sort((a, b) => a.joined - b.joined);
          if (mine.length > 1 && mine[0].conn !== myConn.current) {
            setBlocked('Ya tienes una sesión abierta en esta clase desde otro dispositivo o pestaña. Solo se permite una conexión por usuario.');
            ch.untrack(); supabase.removeChannel(ch); return;
          }
          const flat = {};
          for (const [id, metas] of Object.entries(state)) flat[id] = metas.slice().sort((a, b) => a.joined - b.joined)[0];
          setPeople(flat);
          setTeacherHere(Object.values(flat).some((p) => p.role === 'teacher'));
          if (isTeacher) {
            for (const [id, p] of Object.entries(flat)) {
              if (id === me || p.role !== 'student' || !rosterIds.current.has(id)) continue;
              if (!pcs.current[id] || pcs.current[id].conn !== p.conn) offerTo(id, p.conn);
            }
            for (const id of Object.keys(pcs.current)) if (!flat[id]) closePeer(id);
          }
        })
        .subscribe(async (st) => { if (st === 'SUBSCRIBED') await track(); });
    })();
    return () => {
      cancelled = true;
      Object.keys(pcs.current).forEach(closePeer);
      localStream.current?.getTracks().forEach((t) => t.stop());
      if (channel.current) { channel.current.untrack(); supabase.removeChannel(channel.current); }
    };
  }, []); // eslint-disable-line

  useEffect(() => { track(); }, [hand, micOn]); // eslint-disable-line

  // --------- controles ---------
  const toggleMic = () => { const on = !micOn; localStream.current?.getAudioTracks().forEach((t) => (t.enabled = on)); setMicOn(on); };
  const toggleCam = () => { const on = !camOn; if (camTrack.current) camTrack.current.enabled = on; setCamOn(on); };
  const replaceVideo = (t) => {
    videoTrack.current = t;
    for (const { pc } of Object.values(pcs.current)) pc.getSenders().find((s) => s.track?.kind === 'video' || s.track === null)?.replaceTrack(t);
    if (videoRef.current) videoRef.current.srcObject = new MediaStream([t, ...localStream.current.getAudioTracks()]);
  };
  const toggleShare = async () => {
    if (sharing) { replaceVideo(camTrack.current); setSharing(false); return; }
    try {
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const t = ds.getVideoTracks()[0];
      t.onended = () => { replaceVideo(camTrack.current); setSharing(false); };
      replaceVideo(t); setSharing(true);
    } catch { /* cancelado */ }
  };
  const shareFile = async (file) => {
    try {
      const f = await upload('colegio-clases', file, session.id);
      const item = { ...f, by: profile.full_name, at: Date.now() };
      setFiles((x) => [...x, item]); send('file', item); toast('Archivo compartido con la clase');
    } catch (e) { toast(e); }
  };
  const sendMsg = (e) => {
    e.preventDefault(); if (!msg.trim()) return;
    const m = { name: profile.full_name, text: msg.trim(), at: Date.now(), role };
    setChat((x) => [...x, m]); send('msg', m); setMsg('');
  };
  const end = async () => {
    if (isTeacher) { send('end', {}); await rpc('cg_end_class', { p_id: session.id }).catch(() => {}); }
    onExit?.();
  };

  if (blocked) return <Card glow><Empty icon="⛔">{blocked}</Empty><div className="row" style={{ justifyContent: 'center' }}><GlowButton onClick={onExit}>Volver</GlowButton></div></Card>;

  const students = Object.entries(people).filter(([, p]) => p.role === 'student');
  const hands = students.filter(([, p]) => p.hand);

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <span className="badge bad"><motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>●</motion.span> EN VIVO</span>
        <strong>{session.subject}</strong>
        {isTeacher && <span className="badge info" style={{ fontSize: '1rem', letterSpacing: '.3em' }}>CÓDIGO {session.code}</span>}
        <span className="spacer" />
        <span className="badge">👥 {students.length} estudiante(s)</span>
        {hands.length > 0 && <span className="badge warn">✋ {hands.length}</span>}
      </div>

      <div className="stage">
        <div className="col" style={{ gap: 0 }}>
          <div className="video-main">
            <video ref={videoRef} autoPlay playsInline />
            {!isTeacher && !teacherHere && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Empty icon="⏳">Esperando al docente…</Empty></div>}
            {isTeacher && !camOn && !sharing && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Avatar name={profile.full_name} size={110} /></div>}
            <span className="tag badge">{isTeacher ? (sharing ? '🖥 Compartiendo pantalla' : 'Tú (docente)') : `🎓 ${session.teacher}`}</span>
          </div>
          {Object.entries(remoteAudio).map(([id, stream]) => <AudioSink key={id} stream={stream} />)}
          <div className="controls">
            <GlowButton variant={micOn ? 'ok' : 'bad'} onClick={toggleMic}>{micOn ? '🎙️ Micrófono' : '🔇 Silenciado'}</GlowButton>
            {isTeacher && <GlowButton variant={camOn ? 'ok' : 'bad'} onClick={toggleCam}>{camOn ? '📹 Cámara' : '🚫 Cámara'}</GlowButton>}
            {isTeacher && <GlowButton variant={sharing ? 'warn' : ''} onClick={toggleShare}>🖥 {sharing ? 'Dejar de compartir' : 'Compartir pantalla'}</GlowButton>}
            {!isTeacher && (
              <motion.div animate={hand ? { rotate: [0, -12, 12, -8, 0] } : {}} transition={{ repeat: hand ? Infinity : 0, duration: 1.2 }}>
                <GlowButton variant={hand ? 'warn' : ''} onClick={() => setHand(!hand)}>✋ {hand ? 'Bajar mano' : 'Levantar la mano'}</GlowButton>
              </motion.div>
            )}
            <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files[0]; if (f) shareFile(f); e.target.value = ''; }} />
            <GlowButton onClick={() => fileRef.current.click()}>📎 Adjuntar archivo</GlowButton>
            <GlowButton variant="bad" onClick={end}>{isTeacher ? '⏹ Finalizar clase' : '🚪 Salir'}</GlowButton>
          </div>
        </div>

        <div className="col">
          <Card title={`Participantes (${students.length}${isTeacher ? '/' + roster.length : ''})`}>
            <div className="people">
              <AnimatePresence>
                {Object.entries(people).sort(([, a], [, b]) => (b.hand ? 1 : 0) - (a.hand ? 1 : 0)).map(([id, p]) => (
                  <motion.div layout key={id} className={`person ${p.hand ? 'hand' : ''}`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                    <Avatar name={p.name} size={30} />
                    <span className="small" style={{ flex: 1 }}>{p.name}{id === me ? ' (tú)' : ''}{p.role === 'teacher' ? ' 🎓' : ''}</span>
                    {p.hand && <motion.span animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 0.8 }}>✋</motion.span>}
                    <span title={p.mic ? 'Micrófono activo' : 'Silenciado'}>{p.mic ? '🎙️' : '🔇'}</span>
                    {isTeacher && p.role === 'student' && (
                      <>
                        {p.hand && <button className="icon-btn" style={{ width: 28, height: 28 }} title="Bajar mano" onClick={() => send('lower', { to: id })}>⤵</button>}
                        {p.mic && <button className="icon-btn" style={{ width: 28, height: 28 }} title="Silenciar" onClick={() => send('mute', { to: id })}>🔇</button>}
                      </>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </Card>
          <Card title="Archivos de la clase">
            {files.length === 0 ? <p className="small muted">Aún no se han compartido archivos</p> : (
              <div className="col" style={{ gap: 6 }}>
                {files.map((f, i) => (
                  <motion.a key={i} href="#" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="small" onClick={(e) => { e.preventDefault(); openFile('colegio-clases', f.path, f.name).catch(toast); }}>📎 {f.name} <span className="muted">· {f.by}</span></motion.a>
                ))}
              </div>
            )}
          </Card>
          <Card title="Chat de la clase">
            <div className="col" style={{ gap: 4, maxHeight: 180, overflowY: 'auto', marginBottom: 8 }}>
              {chat.map((m, i) => <div key={i} className="small"><strong style={{ color: m.role === 'teacher' ? 'var(--b)' : 'var(--text)' }}>{m.name}:</strong> {m.text}</div>)}
            </div>
            <form className="row" onSubmit={sendMsg}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Mensaje…" style={{ flex: 1, width: 'auto' }} /><GlowButton size="sm" type="submit">➤</GlowButton></form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AudioSink({ stream }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <audio ref={ref} autoPlay />;
}
