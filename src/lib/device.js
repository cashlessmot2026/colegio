import { useEffect, useState } from 'react';

// Detecta el tipo de dispositivo y lo expone en <html data-device data-touch data-standalone data-os>
// para que el CSS adapte la interfaz (celular, tablet, computador, app instalada, pantalla táctil).
function detect() {
  const w = window.innerWidth;
  const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : 'other';
  const device = w <= 760 ? 'mobile' : w <= 1180 ? 'tablet' : 'desktop';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const landscape = w > window.innerHeight;
  return { device, touch, os, standalone, landscape, width: w, mobile: device === 'mobile', tablet: device === 'tablet', desktop: device === 'desktop' };
}

function apply(d) {
  const el = document.documentElement;
  el.dataset.device = d.device;
  el.dataset.touch = d.touch ? 'yes' : 'no';
  el.dataset.os = d.os;
  el.dataset.standalone = d.standalone ? 'yes' : 'no';
  el.dataset.orientation = d.landscape ? 'landscape' : 'portrait';
  // altura real de la ventana (en móviles 100vh incluye la barra del navegador)
  el.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
}

let current = typeof window !== 'undefined' ? detect() : null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  apply(current);
  let t;
  const update = () => { clearTimeout(t); t = setTimeout(() => { current = detect(); apply(current); listeners.forEach((f) => f(current)); }, 80); };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  window.visualViewport?.addEventListener('resize', update);
}

// Etiqueta cada celda con el título de su columna (data-label) para que en celular
// las tablas se muestren como tarjetas apiladas sin columnas ocultas.
function labelTables(root = document) {
  root.querySelectorAll('table').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => {
        const label = td.colSpan > 1 ? '' : heads[i] ?? '';
        if (td.dataset.label !== label) td.dataset.label = label;
      });
    });
  });
}
if (typeof window !== 'undefined' && 'MutationObserver' in window) {
  let raf;
  const obs = new MutationObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => labelTables()); });
  const start = () => obs.observe(document.body, { childList: true, subtree: true });
  if (document.body) start(); else window.addEventListener('DOMContentLoaded', start);
}

export function useDevice() {
  const [d, setD] = useState(current);
  useEffect(() => { listeners.add(setD); return () => listeners.delete(setD); }, []);
  return d;
}
