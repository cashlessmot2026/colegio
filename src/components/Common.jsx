// Vistas compartidas entre perfiles: horario, agenda de actividades, documentos institucionales
import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { useData } from '../context.jsx';
import { supabase, q, openFile } from '../lib/supabase.js';
import { DAYS } from '../lib/grading.js';
import { fmtTime, isoDay, nowHHMM, fmtDate, fmtDateTime } from '../lib/dates.js';
import { Card, Empty, Async, useAsync, GlowButton, Stagger, StaggerItem, useToast, Tabs } from './ui.jsx';

// Horario semanal de un grupo (o de un docente si se pasan bloques ya filtrados)
export function ScheduleGrid({ blocks, showGroup }) {
  const { subjectById, roomById, staffById, groupById } = useData();
  const times = useMemo(() => [...new Set(blocks.map((b) => fmtTime(b.start_time) + '-' + fmtTime(b.end_time)))].sort(), [blocks]);
  const today = isoDay(); const now = nowHHMM();
  if (!blocks.length) return <Empty icon="🗓️">El colegio aún no ha publicado el horario</Empty>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="sched">
        <div />
        {[1, 2, 3, 4, 5].map((d) => <div key={d} className="h" style={d === today ? { color: 'var(--b)', fontWeight: 700 } : undefined}>{DAYS[d]}</div>)}
        {times.map((t) => {
          const [s, e] = t.split('-');
          return (
            <div key={t} style={{ display: 'contents' }}>
              <div className="h">{s}<br />{e}</div>
              {[1, 2, 3, 4, 5].map((d) => {
                const b = blocks.find((x) => x.day === d && fmtTime(x.start_time) === s);
                if (!b) return <div key={d} />;
                const sb = subjectById[b.subject_id];
                const isNow = d === today && s <= now && e > now;
                return (
                  <motion.div key={d} className={`slot ${isNow ? 'now' : ''}`} whileHover={{ scale: 1.04 }}
                    style={{ borderLeft: `4px solid ${sb?.color || 'var(--a)'}` }}>
                    <strong>{sb?.name}</strong>
                    <div className="muted">{roomById[b.room_id]?.name || 'Sin salón'}{showGroup ? ` · ${groupById[b.group_id]?.name}` : ''}</div>
                    {!showGroup && <div className="muted">{staffById[sb?.teacher_id]?.full_name}</div>}
                  </motion.div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const KIND = { salida: ['🚌', 'Salida pedagógica'], evento: ['🎉', 'Evento'], reunion: ['🤝', 'Reunión'], academico: ['📚', 'Académico'] };

// Agenda de actividades: salidas pedagógicas, eventos, reuniones
export function EventsList({ groupIds, editable, onEdit, reloadKey }) {
  const { groupById } = useData();
  const [tab, setTab] = useState('proximas');
  const st = useAsync(async () => {
    let qq = supabase.from('events').select('*').order('starts_at');
    if (groupIds) qq = qq.or(`group_id.is.null,group_id.in.(${groupIds.join(',') || '00000000-0000-0000-0000-000000000000'})`);
    return q(qq);
  }, [groupIds?.join(), reloadKey]);
  return (
    <>
      <Tabs tabs={[{ key: 'proximas', label: 'Próximas' }, { key: 'pasadas', label: 'Realizadas' }]} value={tab} onChange={setTab} />
      <Async state={st}>{(events) => {
        const now = new Date().toISOString();
        const list = events.filter((e) => tab === 'proximas' ? (e.ends_at || e.starts_at) >= now : (e.ends_at || e.starts_at) < now);
        if (tab === 'pasadas') list.reverse();
        if (!list.length) return <Empty icon="📅">No hay actividades {tab === 'proximas' ? 'agendadas' : 'realizadas'}</Empty>;
        return (
          <Stagger className="grid g2">
            {list.map((e) => (
              <StaggerItem key={e.id}>
                <motion.div className="card" whileHover={{ y: -4, boxShadow: '0 0 30px rgba(124,92,255,.35)' }} style={{ height: '100%' }}>
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 26 }}>{KIND[e.kind]?.[0]}</span>
                    <div style={{ flex: 1 }}><h3>{e.title}</h3><span className="badge info">{KIND[e.kind]?.[1]}</span> <span className="badge">{e.group_id ? groupById[e.group_id]?.name : 'Todo el colegio'}</span></div>
                    {editable && <GlowButton size="sm" variant="ghost" onClick={() => onEdit(e)}>Editar</GlowButton>}
                  </div>
                  <div className="col small" style={{ gap: 4 }}>
                    <span>📅 {fmtDateTime(e.starts_at)}{e.ends_at ? ` → ${fmtDateTime(e.ends_at)}` : ''}</span>
                    {e.place && <span>📍 Lugar: <strong>{e.place}</strong></span>}
                    {e.responsible && <span>👤 Encargado: {e.responsible}</span>}
                    {e.cost != null && <span>💲 Costo: ${Number(e.cost).toLocaleString('es-CO')}</span>}
                    {e.description && <p className="muted" style={{ marginTop: 6 }}>{e.description}</p>}
                    {e.requirements && <p style={{ marginTop: 4 }}>🎒 <strong>Requisitos:</strong> {e.requirements}</p>}
                  </div>
                </motion.div>
              </StaggerItem>
            ))}
          </Stagger>
        );
      }}</Async>
    </>
  );
}

// Documentos institucionales (manual de convivencia, PEI, circulares…)
export function DocumentsList({ admin, onDelete, reloadKey }) {
  const toast = useToast();
  const st = useAsync(() => q(supabase.from('documents').select('*').order('created_at', { ascending: false })), [reloadKey]);
  return (
    <Async state={st}>{(docs) => !docs.length ? <Empty icon="📄">El colegio aún no ha publicado documentos</Empty> : (
      <Stagger className="grid g3">
        {docs.map((d) => (
          <StaggerItem key={d.id}>
            <motion.div className="card" whileHover={{ y: -4 }} style={{ height: '100%' }}>
              <div className="row"><span style={{ fontSize: 30 }}>📘</span><div style={{ flex: 1 }}><strong>{d.title}</strong><div className="small muted">{d.category} · {fmtDate(d.created_at)}</div></div></div>
              <div className="row" style={{ marginTop: 12 }}>
                <GlowButton size="sm" onClick={() => openFile('colegio-documentos', d.path).catch(toast)}>👁 Ver</GlowButton>
                <GlowButton size="sm" variant="ok" onClick={() => openFile('colegio-documentos', d.path, d.file_name).catch(toast)}>⬇ Descargar</GlowButton>
                {admin && <GlowButton size="sm" variant="bad" onClick={() => onDelete(d)}>Eliminar</GlowButton>}
              </div>
            </motion.div>
          </StaggerItem>
        ))}
      </Stagger>
    )}</Async>
  );
}
