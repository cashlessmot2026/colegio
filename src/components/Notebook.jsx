import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const W = 800, H = 1060;               // tamaño lógico de cada hoja (proporción carta)
const LINE = 34, MARGIN = 86, TOP = 96;
const COLORS = ['#1b1b4b', '#1565c0', '#c62828', '#2e7d32'];

// Dibuja el fondo de la hoja: cuadriculada (matemáticas) o de renglones con margen rojo
function paper(ctx, style) {
  ctx.fillStyle = '#fffef8'; ctx.fillRect(0, 0, W, H);
  if (style === 'cuadros') {
    ctx.strokeStyle = 'rgba(70,120,200,.18)'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 26) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 26) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  } else {
    ctx.strokeStyle = 'rgba(70,120,200,.32)'; ctx.lineWidth = 1;
    for (let y = TOP; y < H; y += LINE) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(220,60,60,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(MARGIN, 0); ctx.lineTo(MARGIN, H); ctx.stroke();
  }
}

/**
 * Cuaderno de varias hojas para justificar respuestas o resolver ejercicios.
 * value: array de imágenes (dataURL) por hoja. onChange(pages) se dispara al terminar cada trazo.
 */
export default function Notebook({ value = [], onChange, readOnly, height = 520 }) {
  const canvasRef = useRef(null);
  const [pages, setPages] = useState(value.length ? value : [null]);
  const [idx, setIdx] = useState(0);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(3);
  const [style, setStyle] = useState('renglones');
  const drawing = useRef(false);
  const last = useRef(null);
  const history = useRef([]);

  // pinta la hoja actual (fondo + contenido guardado)
  const render = useCallback((src) => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d');
    paper(ctx, style);
    if (src) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, W, H); img.src = src; }
  }, [style]);

  useEffect(() => { render(pages[idx]); history.current = []; }, [idx, render]); // eslint-disable-line
  useEffect(() => { if (readOnly && value.length) { setPages(value); } }, [readOnly, value]);

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H, e.pressure || 0.5];
  };
  const down = (e) => {
    if (readOnly) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    history.current.push(canvasRef.current.toDataURL('image/jpeg', 0.7));
    if (history.current.length > 20) history.current.shift();
    drawing.current = true; last.current = pos(e);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const [x, y, p] = pos(e); const [lx, ly] = last.current;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (tool === 'eraser') {
      // el borrador repinta el fondo de papel en lugar de dejar transparente
      ctx.save(); ctx.beginPath(); ctx.arc(x, y, size * 6, 0, Math.PI * 2); ctx.clip(); paper(ctx, style); ctx.restore();
    } else {
      ctx.strokeStyle = color; ctx.lineWidth = size * (e.pointerType === 'pen' ? 0.6 + p : 1);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke();
    }
    last.current = [x, y];
  };
  const commit = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const data = canvasRef.current.toDataURL('image/jpeg', 0.72);
    const next = pages.map((p, i) => (i === idx ? data : p));
    setPages(next); onChange?.(next);
  };
  const undo = () => {
    const prev = history.current.pop(); if (!prev) return;
    render(prev);
    const next = pages.map((p, i) => (i === idx ? prev : p));
    setPages(next); onChange?.(next);
  };
  const clearPage = () => {
    history.current.push(canvasRef.current.toDataURL('image/jpeg', 0.7));
    render(null);
    const next = pages.map((p, i) => (i === idx ? null : p));
    setPages(next); onChange?.(next);
  };
  const addPage = () => { const next = [...pages, null]; setPages(next); setIdx(next.length - 1); onChange?.(next); };
  const removePage = () => {
    if (pages.length === 1) return clearPage();
    const next = pages.filter((_, i) => i !== idx); setPages(next); setIdx(Math.max(0, idx - 1)); onChange?.(next);
  };

  return (
    <div className="notebook">
      {!readOnly && (
        <div className="nb-tools">
          <button type="button" className={`nb-btn ${tool === 'pen' ? 'on' : ''}`} onClick={() => setTool('pen')} title="Lápiz">✏️</button>
          <button type="button" className={`nb-btn ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')} title="Borrador">🧽</button>
          {COLORS.map((c) => (
            <button type="button" key={c} className={`nb-color ${color === c && tool === 'pen' ? 'on' : ''}`} style={{ background: c }} onClick={() => { setColor(c); setTool('pen'); }} aria-label="Color" />
          ))}
          <input type="range" min="1" max="8" value={size} onChange={(e) => setSize(Number(e.target.value))} title="Grosor" style={{ width: 80 }} />
          <select value={style} onChange={(e) => setStyle(e.target.value)} style={{ width: 'auto', padding: '5px 8px' }} title="Tipo de hoja">
            <option value="renglones">Renglones</option><option value="cuadros">Cuadriculada</option>
          </select>
          <span className="spacer" />
          <button type="button" className="nb-btn" onClick={undo} title="Deshacer">↶</button>
          <button type="button" className="nb-btn" onClick={clearPage} title="Borrar hoja">🗑</button>
        </div>
      )}
      <div className="nb-stage" style={{ maxHeight: height }}>
        <AnimatePresence mode="wait">
          <motion.div key={idx} initial={{ rotateY: -25, opacity: 0, x: 40 }} animate={{ rotateY: 0, opacity: 1, x: 0 }} exit={{ rotateY: 25, opacity: 0, x: -40 }}
            transition={{ duration: 0.35 }} style={{ transformPerspective: 1200 }}>
            {readOnly ? (
              pages[idx] ? <img src={pages[idx]} alt={`Hoja ${idx + 1}`} className="nb-sheet" /> : <div className="nb-sheet nb-empty">Hoja en blanco</div>
            ) : (
              <canvas ref={canvasRef} width={W} height={H} className="nb-sheet"
                onPointerDown={down} onPointerMove={move} onPointerUp={commit} onPointerCancel={commit} onPointerLeave={commit} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="nb-pager">
        <button type="button" className="nb-btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>←</button>
        <span className="small">Hoja {idx + 1} de {pages.length}</span>
        <button type="button" className="nb-btn" disabled={idx === pages.length - 1} onClick={() => setIdx(idx + 1)}>→</button>
        {!readOnly && <><button type="button" className="nb-btn" onClick={addPage}>＋ Hoja</button><button type="button" className="nb-btn" onClick={removePage} title="Quitar hoja">－</button></>}
      </div>
    </div>
  );
}
