// js/parchment.js — WEB-PARCH (hoja 3D) + PARCH-ANIM (papel antiguo, física) + ESCRITURA (letra antigua legible escrita POR TRAZOS)
// Hoja de pergamino 3D de DOBLE ROLLO que se desenrolla (tipo decreto real). Cara impresa = textura ANTIGUA de BL-PARCH2 (papel del
// usuario + diseño floral, hilos en pan de oro). El texto de content.js va en una capa aparte, compuesto en letra antigua y legible
// (Fondamento cancilleresca + versalitas IM Fell English SC + nombres en pan de oro Great Vibes; tinta ferrogálica ≈ #24150c):
//  · HORNEADO (normal): assets/tex/texto_tinta.png (cobertura/material/acumulación), texto_orden.png (instante 16-bit en que la
//    pluma pasa por cada píxel según el ESQUELETO real de cada glifo, de tools/escritura/) y texto_meta.json (trazos, renglones,
//    remojos, huella). La tinta corre por el trazo; puntos de la i, tildes y cruces de la t al final de la palabra; la pluma se
//    levanta entre trazos; acumulación al final de cada trazo; nombres: mordiente y luego se doran con chispas.
//  · EN VIVO (respaldo, si la huella de texto_meta.json no coincide con content.js o faltan los PNG): misma composición dibujada
//    en un canvas y barrido letra a letra (como PARCH-ANIM). Para rehornear: node tools/escritura/hornear_pergamino.mjs
//
// Contrato (SPEC.md; lo existente no cambia):
//   export const CLOSED, DIMENSIONS, TEXT_AREA; export function rollState(u), unrollEase(k)
//   export async function createParchment({ THREE, renderer, texBase?, ornamentUrl?, text?, segmentsX?, segmentsY?, idle?, envMap?, live?, dir? })
//     → { group, setUnroll(u), getRolls(), setLightSweep(x), update(time, dt), dispose(),
//         setWriting(t 0..1), getWriting(), getPen() (compat. PARCH-ANIM), setReducedMotion(on), setTextOpacity(a 0..1),
//         getPenAt(t 0..1) → { pos (Vector3 local), tangent, down, pressure, strokeIndex, lineIndex, lift, gold, dip, speed },
//         getFocus(t 0..1) → { x0, y0, x1, y1 (caja local del renglón en curso), lineIndex, id, center },
//         writing { seconds, baked, hash, timeline, lines[], strokes {count, items}, dips[], textArea }, uniforms, debug }
//   + export componerTexto(T, { dir, g }), textHash(T, dir), dibujarItem(g, item, color), DIRECCIONES, DIR_DEFECTO, fuentesCss(dir), LAYOUT_VERSION
// No crea renderer ni escena. Coordenadas locales (metros): parte plana en z = 0, texto mirando a +Z, ejes de los rollos ∥ X,
// rollos DELANTE de la hoja (+Z), papel enrollado hacia adelante → el texto queda adentro y por fuera se ve el reverso.
// La deformación (espiral de Arquímedes por mitad) se hace en el vertex shader; normales analíticas.

import { PARCHMENT_TEXT } from './content.js';

// ───────────────────────────── geometría compartida ─────────────────────────────
const W = 0.30;               // ancho de la hoja
const H = 0.52;               // largo (arco) de la hoja
const ROD_R = 0.011;          // radio de la varilla de madera
const TAU = 0.0008;           // grosor de papel por vuelta (exagerado para ver la espiral)
const ROD_GAP = 0.00025;      // holgura papel-varilla (evita z-fighting con la madera)
const R_IN = ROD_R + ROD_GAP; // radio de la capa más interna del papel
const LF_MAX = 0.45;          // largo plano visible abierto
const U_MAX = 1.04;           // setUnroll acepta un leve sobrepaso (>1) para la inercia; [0,1] conserva su significado
const EDGE_T = 0.00045;       // grosor visual del canto del papel (paredes laterales)
const TWO_PI = Math.PI * 2;

/** Radio exterior del rollo cuando la parte plana mide Lf: espiral de Arquímedes, A = largo enrollado por mitad. */
function rollRadius(Lf) {
  const A = Math.max(0, H / 2 - Lf / 2);
  return Math.sqrt(R_IN * R_IN + (A * TAU) / Math.PI);
}
// Cerrado: los dos rollos deben TOCARSE. La capa exterior es una espiral: del lado que mira al otro rollo (θ' = 3π/2) su radio
// ya es R − 0.75·τ, así que la parte plana mínima es Lf = 2(R − 0.75τ) − 0.1 mm (ligero contacto, sin rendija entre rollos).
const CONTACT_OVERLAP = 0.0001;
function solveClosed() {
  let Lf = 0.027;
  for (let i = 0; i < 80; i++) Lf = 2 * (rollRadius(Lf) - 0.75 * TAU) - CONTACT_OVERLAP;
  return { Lf, R: rollRadius(Lf) };
}
const _closed = solveClosed();
const R_C = _closed.R;      // ≈ 0.0138 m (objetivo del SPEC 0.0135 ± 0.0015)
const LF_MIN = _closed.Lf;  // ≈ 0.0263 m → centros en y = ±0.01315

export const CLOSED = Object.freeze({
  R: R_C,
  topCenter: Object.freeze([0, LF_MIN / 2, R_C]),
  bottomCenter: Object.freeze([0, -LF_MIN / 2, R_C]),
});

export const DIMENSIONS = Object.freeze({
  W, H, rodRadius: ROD_R, paperThickness: TAU, LfMin: LF_MIN, LfMax: LF_MAX,
  innerRadius: R_IN, legibleV: Object.freeze([0.07, 0.93]),
});

/** Estado puro de los rollos para un u (0 cerrado … 1 abierto; hasta 1.04 = sobrepaso de inercia). */
export function rollState(u) {
  const uu = Math.min(U_MAX, Math.max(0, Number(u) || 0));
  const Lf = LF_MIN + (LF_MAX - LF_MIN) * uu;
  const R = rollRadius(Lf);
  const turnsAngle = (TWO_PI * (R - R_IN)) / TAU; // ángulo acumulado del extremo pegado a la varilla
  return {
    u: uu, Lf, R,
    topCenter: [0, Lf / 2, R], bottomCenter: [0, -Lf / 2, R],
    angleTop: turnsAngle, angleBottom: -turnsAngle,
  };
}

// ───────────────────────────── desenrollado con inercia ─────────────────────────────
// Papel antiguo con peso: arranque lento (el rollo "se despega"), avance fluido, sobrepaso ≈ +1.3 % (≈ 6 mm de recorrido)
// y retroceso suave hasta asentarse en 1. Es la respuesta de un resorte amortiguado a una rampa suave, tabulada (LUT).
const EASE_N = 512;
const EASE_LUT = (() => {
  const lut = new Float32Array(EASE_N + 1); const sub = 8, dt = 1 / (EASE_N * sub);
  const w = 15.5, z = 0.62, ramp = 0.6; let x = 0, v = 0;
  for (let i = 0; i <= EASE_N; i++) {
    lut[i] = x;
    for (let k = 0; k < sub; k++) {
      const t = (i * sub + k) * dt; const s = Math.min(1, t / ramp); const tgt = s * s * s * (s * (s * 6 - 15) + 10);
      const a = w * w * (tgt - x) - 2 * z * w * v; v += a * dt; x += v * dt;
    }
  }
  for (let i = 0; i <= EASE_N; i++) { const t = i / EASE_N; const k = Math.min(1, Math.max(0, (t - 0.9) / 0.1)); lut[i] += (1 - lut[i]) * k * k * (3 - 2 * k); }
  lut[0] = 0; lut[EASE_N] = 1; return lut;
})();
/** k = progreso temporal 0..1 → u para setUnroll (puede pasar levemente de 1 antes de asentarse). */
export function unrollEase(k) {
  const x = Math.min(1, Math.max(0, Number(k) || 0)) * EASE_N; const i = Math.min(EASE_N - 1, x | 0); const f = x - i;
  return EASE_LUT[i] * (1 - f) + EASE_LUT[i + 1] * f;
}

// ───────────────────────────── zona del texto ─────────────────────────────
// ESCRITURA (decisión n.º 5): columna más ancha y alta, ajustada a la zona LIMPIA de antiguo_albedo (el diseño floral ocupa la
// izquierda y una ola entra abajo a la izquierda). La capa de texto cubre TEXT_UV; se compone en "px de composición" = px de una
// hoja de REF_W de ancho (2048 → 6.83 px/mm). La columna es COLUMN; LEFT_LIMIT da el u mínimo de papel limpio para cada v.
const REF_W = 2048, REF_H = Math.round(REF_W * (H / W));   // 2048 × 3550
const TEXT_UV = Object.freeze({ u0: 0.44, u1: 0.985, v0: 0.17, v1: 0.92 });
const COLUMN = Object.freeze({ u: 0.71, halfWidth: 0.236, vTop: 0.893, vBottom: 0.212 });
const LEFT_LIMIT = [[0.95, 0.54], [0.875, 0.525], [0.845, 0.49], [0.62, 0.47], [0.585, 0.505], [0.5, 0.505], [0.465, 0.48],
  [0.245, 0.48], [0.215, 0.525], [0.2, 0.56], [0.18, 0.59], [0.16, 0.625], [0.14, 0.655], [0.12, 0.74]];
function leftLimit(v) {
  const L = LEFT_LIMIT;
  if (v >= L[0][0]) return L[0][1];
  for (let i = 1; i < L.length; i++) {
    if (v >= L[i][0]) { const f = (v - L[i][0]) / (L[i - 1][0] - L[i][0]); return L[i][1] + (L[i - 1][1] - L[i][1]) * f; }
  }
  return L[L.length - 1][1];
}
/** Rectángulo del texto en coordenadas locales de la hoja abierta (metros): para encuadrar la cámara en pantallas estrechas. */
export const TEXT_AREA = Object.freeze({
  center: Object.freeze([(COLUMN.u - 0.5) * W, ((COLUMN.vTop + COLUMN.vBottom) / 2 - 0.5) * H, 0]),
  width: 2 * COLUMN.halfWidth * W, height: (COLUMN.vTop - COLUMN.vBottom) * H,
});

// ───────────────────────────── utilidades canvas / ruido ─────────────────────────────
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
// Todos los lienzos 2D en CPU (willReadFrequently): mezclar lienzos GPU y CPU obliga a lecturas GPU→CPU que bloquean ~250 ms c/u.
const g2d = (c) => c.getContext('2d', { willReadFrequently: true });
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Ruido suave (valor) escalando una rejilla aleatoria pequeña en dos pasos (evita el patrón de rombos). */
function noiseCanvas(w, h, cx, cy, seed, lo = 0, hi = 255, alpha = false) {
  const s = mk(cx, cy), g = g2d(s); const id = g.createImageData(s.width, s.height); const r = mulberry32(seed);
  for (let i = 0; i < s.width * s.height; i++) {
    const v = lo + (hi - lo) * r(); const o = i * 4;
    if (alpha) { id.data[o] = id.data[o + 1] = id.data[o + 2] = 255; id.data[o + 3] = v; }
    else { id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255; }
  }
  g.putImageData(id, 0, 0);
  const m = mk(Math.min(w, cx * 4), Math.min(h, cy * 4)), gm = g2d(m);
  gm.imageSmoothingEnabled = true; gm.imageSmoothingQuality = 'high'; gm.drawImage(s, 0, 0, m.width, m.height);
  const c = mk(w, h), gc = g2d(c); gc.imageSmoothingEnabled = true; gc.imageSmoothingQuality = 'low'; gc.drawImage(m, 0, 0, w, h);
  return c;
}

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = url;
  });
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

// ───────────────────────────── fuentes: letra antigua (decisión n.º 5) ─────────────────────────────
// Direcciones tipográficas probadas lado a lado (tests/escritura.html?comparar=1). DIR_DEFECTO es la elegida.
// Cada estilo es una plantilla CSS con {px}. Todas son de Google Fonts (las familias van también en el <link> de index.html).
const fnt = (tpl) => (px) => tpl.replace('{px}', (Math.round(px * 100) / 100).toString());
export const DIRECCIONES = Object.freeze({
  cancilleresca: Object.freeze({
    titulo: 'Cancilleresca: Fondamento + IM Fell English SC + Great Vibes',
    familias: ['Fondamento:ital@0;1', 'IM Fell English SC', 'Great Vibes'],
    versalitas: fnt('{px}px "IM Fell English SC", serif'), titular: fnt('{px}px Fondamento, serif'),
    nombres: fnt('{px}px "Great Vibes", cursive'), verso: fnt('italic {px}px Fondamento, serif'),
    cifras: fnt('{px}px Fondamento, serif'), sub: fnt('italic {px}px Fondamento, serif'),
    lugar: fnt('{px}px Fondamento, serif'), cierre: fnt('italic {px}px Fondamento, serif'),
  }),
  imprenta: Object.freeze({
    titulo: 'Imprenta antigua: IM Fell English + IM Fell English SC + Pinyon Script',
    familias: ['IM Fell English:ital@0;1', 'IM Fell English SC', 'Pinyon Script'],
    versalitas: fnt('{px}px "IM Fell English SC", serif'), titular: fnt('italic {px}px "IM Fell English", serif'),
    nombres: fnt('{px}px "Pinyon Script", cursive'), verso: fnt('italic {px}px "IM Fell English", serif'),
    cifras: fnt('{px}px "IM Fell English", serif'), sub: fnt('italic {px}px "IM Fell English", serif'),
    lugar: fnt('{px}px "IM Fell English", serif'), cierre: fnt('italic {px}px "IM Fell English", serif'),
  }),
  almendra: Object.freeze({
    titulo: 'Libro iluminado: Almendra + Almendra SC + Pinyon Script',
    familias: ['Almendra:ital@0;1', 'Almendra SC', 'Pinyon Script'],
    versalitas: fnt('{px}px "Almendra SC", serif'), titular: fnt('{px}px Almendra, serif'),
    nombres: fnt('{px}px "Pinyon Script", cursive'), verso: fnt('italic {px}px Almendra, serif'),
    cifras: fnt('{px}px Almendra, serif'), sub: fnt('italic {px}px Almendra, serif'),
    lugar: fnt('{px}px Almendra, serif'), cierre: fnt('italic {px}px Almendra, serif'),
  }),
});
export const DIR_DEFECTO = 'cancilleresca';
const ESTILOS = ['versalitas', 'titular', 'nombres', 'verso', 'cifras', 'sub', 'lugar', 'cierre'];
export function fuentesCss(dirName = DIR_DEFECTO) {
  const D = DIRECCIONES[dirName] || DIRECCIONES[DIR_DEFECTO];
  return 'https://fonts.googleapis.com/css2?' + D.familias.map((f) => 'family=' + f.replace(/ /g, '+')).join('&') + '&display=swap';
}
const famOf = (font) => { const m = /[\d.]+px\s+"?([^",]+)"?/.exec(font); return m ? m[1].trim() : ''; };
/** Carga (si hace falta) la hoja de Google Fonts de la dirección y espera cada estilo; true si todas las familias quedaron cargadas. */
async function ensureFonts(dirName = DIR_DEFECTO) {
  if (typeof document === 'undefined' || !document.fonts) return false;
  const D = DIRECCIONES[dirName] || DIRECCIONES[DIR_DEFECTO];
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => decodeURIComponent(l.href).replace(/\+/g, ' '));
  const fams = D.familias.map((f) => f.split(':')[0]);
  const has = fams.every((f) => links.some((h) => h.includes('family=' + f)));
  const id = 'parch-fonts-' + dirName;
  if (!has && !document.getElementById(id)) {
    const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; l.href = fuentesCss(dirName);
    const ready = new Promise((r) => { l.onload = r; l.onerror = r; });
    document.head.appendChild(l); await withTimeout(ready, 4000);
  }
  const sample = 'Josué y Marjhory ÁÉÍÓÚáéíóúñ—“”0123456789: Te invitamos';
  const specs = ESTILOS.map((k) => D[k](60));
  await withTimeout(Promise.all(specs.map((s) => document.fonts.load(s, sample).catch(() => null))), 6000);
  const loaded = (fam) => [...document.fonts].some((ff) => ff.family.replace(/["']/g, '') === fam && ff.status === 'loaded');
  return specs.every((s) => loaded(famOf(s)));
}

// ───────────────────────────── texturas procedurales de respaldo ─────────────────────────────
// Se usan solo si assets/tex/pergamino_* no existen todavía (BL-PARCH los hornea en paralelo) o fallan al cargar.
function fallbackPaper(w, h, seed, dark) {
  const c = mk(w, h), g = g2d(c);
  g.fillStyle = dark ? '#ddc9a2' : '#eee0c0'; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'multiply';
  [[10, 17, 196, 255, 0.55], [36, 62, 212, 255, 0.45], [140, 242, 224, 255, 0.35]].forEach(([cx, cy, lo, hi, a], i) => {
    g.globalAlpha = a; g.drawImage(noiseCanvas(w, h, cx, cy, seed + i * 17, lo, hi), 0, 0);
  });
  g.globalAlpha = 1;
  const r = mulberry32(seed + 5);
  for (let i = 0; i < (dark ? 70 : 45); i++) { // foxing / manchas
    const x = r() * w, y = r() * h, rad = (2 + r() ** 3 * 26) * (w / 1024);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(150,95,45,${0.12 + r() * 0.2})`); gr.addColorStop(1, 'rgba(150,95,45,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) { // fibras
    const x = r() * w, y = r() * h, L = (3 + r() * 12) * (w / 1024), a = Math.PI / 2 + (r() - 0.5) * 0.9;
    g.strokeStyle = r() < 0.5 ? `rgba(120,85,45,${0.05 + r() * 0.07})` : `rgba(255,248,230,${0.08 + r() * 0.1})`;
    g.lineWidth = 0.6 + r() * 0.8; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  const edge = (x0, y0, x1, y1) => { const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, 'rgba(130,80,35,0.55)'); gr.addColorStop(1, 'rgba(130,80,35,0)'); return gr; };
  const e = 0.06 * w;
  g.fillStyle = edge(0, 0, e, 0); g.fillRect(0, 0, e, h);
  g.fillStyle = edge(w, 0, w - e, 0); g.fillRect(w - e, 0, e, h);
  g.fillStyle = edge(0, 0, 0, e); g.fillRect(0, 0, w, e);
  g.fillStyle = edge(0, h, 0, h - e); g.fillRect(0, h - e, w, e);
  g.globalCompositeOperation = 'source-over';
  return c;
}
function fallbackHeight(w, h, seed) { // 0.5 = 0 mm (mismo código que pergamino_height.jpg)
  const c = mk(w, h), g = g2d(c);
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.7; g.drawImage(noiseCanvas(w, h, 6, 10, seed, 60, 196), 0, 0);
  g.globalAlpha = 0.35; g.drawImage(noiseCanvas(w, h, 16, 27, seed + 3, 70, 186), 0, 0);
  g.globalAlpha = 1; return c;
}
function normalFromHeight(hc, mmPerUnit, strength) { // mapa normal OpenGL desde la altura (Sobel)
  const w = hc.width, h = hc.height; const src = g2d(hc, true).getImageData(0, 0, w, h).data;
  const out = mk(w, h), go = g2d(out); const id = go.createImageData(w, h); const d = id.data;
  const pxmm = (W * 1000) / w; const k = (mmPerUnit / 255) * strength / pxmm;
  const H_ = (x, y) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H_(x + 1, y) - H_(x - 1, y)) * 0.5 * k, dy = (H_(x, y - 1) - H_(x, y + 1)) * 0.5 * k;
    const l = Math.hypot(dx, dy, 1), o = (y * w + x) * 4;
    d[o] = (-dx / l * 0.5 + 0.5) * 255; d[o + 1] = (-dy / l * 0.5 + 0.5) * 255; d[o + 2] = (1 / l * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  go.putImageData(id, 0, 0); return out;
}
function fallbackMask(w, h, seed) {
  const c = mk(w, h), g = g2d(c); g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const r = mulberry32(seed); const n = 220; const inset = 0.012 * w;
  const jag = (i, s) => inset + (Math.sin(i * 0.37 + s) * 0.5 + Math.sin(i * 1.71 + s * 2.3) * 0.3 + r() * 0.9) * 0.006 * w;
  g.fillStyle = '#fff'; g.beginPath();
  for (let i = 0; i <= n; i++) g.lineTo(jag(i, 1), (i / n) * h);
  for (let i = 0; i <= n; i++) g.lineTo((i / n) * w, h - jag(i, 7));
  for (let i = n; i >= 0; i--) g.lineTo(w - jag(i, 3), (i / n) * h);
  for (let i = n; i >= 0; i--) g.lineTo((i / n) * w, jag(i, 5));
  g.closePath(); g.fill();
  return c;
}

// ───────────────────────────── ornamento floral (referencia-0.jpg) ─────────────────────────────
// Recorta las flores de la izquierda, "niveles" para que el beige quede blanco, aclara las masas marrones lisas
// (normalización local parcial) → queda impresión envejecida de flores e hilos; además devuelve la máscara de hilos dorados.
function processOrnament(img) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sx = iw / 1053, sy = ih / 1477;
  const cw = Math.round(478 * sx), ch = ih;
  const c = mk(cw, ch), g = g2d(c, true); g.drawImage(img, 0, 0, cw, ch, 0, 0, cw, ch);
  const src = g.getImageData(0, 0, cw, ch);
  // fondo de referencia: zona vacía a la derecha del original
  const b = mk(32, 32), gb = g2d(b, true); gb.drawImage(img, 640 * sx, 300 * sy, 330 * sx, 760 * sy, 0, 0, 32, 32);
  const bd = gb.getImageData(0, 0, 32, 32).data; let br = 0, bg = 0, bb = 0;
  for (let i = 0; i < bd.length; i += 4) { br += bd[i]; bg += bd[i + 1]; bb += bd[i + 2]; }
  const n = bd.length / 4; br = br / n; bg = bg / n; bb = bb / n;
  // desenfoque grande (bajar/subir resolución) = tono local
  const s1 = mk(cw / 8, ch / 8), gs1 = g2d(s1); gs1.imageSmoothingQuality = 'high'; gs1.drawImage(c, 0, 0, s1.width, s1.height);
  const s2 = mk(cw / 20, ch / 20), gs2 = g2d(s2); gs2.imageSmoothingQuality = 'high'; gs2.drawImage(s1, 0, 0, s2.width, s2.height);
  const bl = mk(cw, ch), gbl = g2d(bl, true); gbl.imageSmoothingQuality = 'high'; gbl.drawImage(s2, 0, 0, cw, ch);
  const blur = gbl.getImageData(0, 0, cw, ch).data;
  const out = new ImageData(cw, ch), th = new ImageData(cw, ch);
  const d = src.data, o = out.data, t = th.data;
  const beta = 0.9; // cuánto se "aplanan" las masas marrones
  const POW = new Float32Array(256); for (let i = 0; i < 256; i++) POW[i] = Math.pow(Math.max(0.06, i / 255), beta);
  const PB = (v) => POW[Math.min(255, (v * 255) | 0)];
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % cw, py = (i / 4 / cw) | 0;
    const r = d[i] / br, gg = d[i + 1] / bg, bb2 = d[i + 2] / bb;
    const lr = Math.max(0.06, Math.min(1, blur[i] / br)), lg = Math.max(0.06, Math.min(1, blur[i + 1] / bg)), lb = Math.max(0.06, Math.min(1, blur[i + 2] / bb));
    let R = Math.min(1, r / PB(lr)), G = Math.min(1, gg / PB(lg)), B = Math.min(1, bb2 / PB(lb));
    // curva de niveles: blancos limpios, sombras de impresión
    const lum = 0.3 * R + 0.59 * G + 0.11 * B;
    const blum = (0.3 * blur[i] / br + 0.59 * blur[i + 1] / bg + 0.11 * blur[i + 2] / bb);
    const mass = sstep(0.86, 0.5, blum); // dentro de las masas marrones lisas → solo un lavado tenue
    const ink = Math.pow(sstep(0.975, 0.3, lum), 0.72) * (1 - 0.5 * mass); // 0 = papel, 1 = tinta plena
    // color de impresión: sepia → oro según croma original
    const mx = Math.max(d[i], d[i + 1], d[i + 2]) / 255, mn = Math.min(d[i], d[i + 1], d[i + 2]) / 255;
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    const warm = d[i] >= d[i + 1] && d[i + 1] >= d[i + 2] ? 1 : 0;
    const gold = warm * sstep(0.28, 0.5, sat) * sstep(0.5, 0.72, mx);
    const tr = 0.42 + 0.32 * gold, tg = 0.27 + 0.27 * gold, tb = 0.15 + 0.08 * gold; // color de tinta a plena carga
    // desvanecido: hacia el texto (derecha) y en los extremos
    const fx = 1 - sstep(0.5, 0.97, px / cw), fy = sstep(0.0, 0.05, py / ch) * (1 - sstep(0.94, 1.0, py / ch));
    const a = Math.min(1, ink * fx * fy * 1.08);
    o[i] = 255 * (1 - a * (1 - tr)); o[i + 1] = 255 * (1 - a * (1 - tg)); o[i + 2] = 255 * (1 - a * (1 - tb)); o[i + 3] = 255;
    t[i] = t[i + 1] = t[i + 2] = 255; t[i + 3] = 255 * clamp01(gold * fx * fy * sstep(0.12, 0.45, ink) * 1.3);
  }
  const print = mk(cw, ch); g2d(print).putImageData(out, 0, 0);
  const threads = mk(cw, ch); g2d(threads).putImageData(th, 0, 0);
  return { print, threads, w: cw, h: ch, sx, sy };
}

// ───────────────────────────── texto: composición (decisión n.º 5) ─────────────────────────────
// componerTexto() devuelve la columna como una LISTA DE ELEMENTOS con el mismo formato que la spec del motor de escritura
// (tools/escritura/rasterizar-pagina.js): { id, tipo: 'texto'|'forma', texto, fuente, x, y (línea base), alinear, espaciado,
// capa: 'tinta'|'sepia'|'oro', clase, renglon, velocidad, pausa, pausaFija } en px de composición (rectángulo TEXT_UV a REF_W).
// La usan: el horneado (tools/escritura/hornear_pergamino.mjs → texto_tinta/orden/meta) y la composición en vivo de respaldo.
export const LAYOUT_VERSION = 6;
const setLS = (g, sp) => { try { g.letterSpacing = (sp || 0) + 'px'; } catch { /* sin letterSpacing en canvas */ } };
function medir(g, font, str, sp = 0) {
  g.font = font; setLS(g, sp);
  const n = [...str].length; const m = g.measureText(str);
  setLS(g, 0);
  const w = Math.max(0, m.width - (n ? sp : 0));
  return { w, asc: m.actualBoundingBoxAscent || 0, desc: m.actualBoundingBoxDescent || 0, l: m.actualBoundingBoxLeft || 0, r: Math.max(m.actualBoundingBoxRight || 0, w) };
}
const P2 = (v) => Math.round(v * 100) / 100;
const pathFilete = (x0, x1, y, w) => `M${P2(x0)} ${P2(y - w / 2)}L${P2(x1)} ${P2(y)}L${P2(x0)} ${P2(y + w / 2)}Z`;
const pathCirculo = (cx, cy, r) => `M${P2(cx - r)} ${P2(cy)}a${P2(r)} ${P2(r)} 0 1 0 ${P2(2 * r)} 0a${P2(r)} ${P2(r)} 0 1 0 ${P2(-2 * r)} 0Z`;
const pathRombo = (cx, cy, rx, ry) => `M${P2(cx - rx)} ${P2(cy)}L${P2(cx)} ${P2(cy - ry)}L${P2(cx + rx)} ${P2(cy)}L${P2(cx)} ${P2(cy + ry)}Z`;
// ❦ vectorial (hoja-corazón con zarcillo), unidad = tamaño k, se gira −0.42 rad con la matriz
const FLEURON_HOJA = 'M0.05 0.46C-0.5 0.12 -0.66 -0.36 -0.3 -0.43C-0.12 -0.46 -0.01 -0.34 0 -0.2C0.03 -0.34 0.15 -0.46 0.33 -0.42C0.68 -0.33 0.52 0.12 0.05 0.46Z';
const FLEURON_TALLO = 'M0 -0.22C-0.04 -0.52 -0.38 -0.78 -0.62 -0.62C-0.8 -0.5 -0.74 -0.3 -0.58 -0.32C-0.46 -0.34 -0.48 -0.48 -0.56 -0.47';

/** Parte una línea en 2..4 renglones equilibrados (por palabras) si no cabe en maxW. No cambia el texto, solo dónde salta. */
function wrapBalanced(g, font, str, maxW) {
  const W_ = (s) => medir(g, font, s).w;
  if (W_(str) <= maxW) return [str];
  const words = str.split(' ');
  for (let n = 2; n <= 4; n++) {
    const target = W_(str) / n; const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && W_(t) > target * 1.1 && lines.length < n - 1) { lines.push(cur); cur = w; } else cur = t;
    }
    lines.push(cur);
    for (let i = 0; i < lines.length - 1; i++) { // ningún renglón termina en palabra de una letra ("y", "a", "o"…)
      const ws = lines[i].split(' ');
      if (ws.length > 1 && [...ws[ws.length - 1]].length === 1) { lines[i] = ws.slice(0, -1).join(' '); lines[i + 1] = ws[ws.length - 1] + ' ' + lines[i + 1]; }
    }
    if (lines.every((l) => W_(l) <= maxW)) return lines;
  }
  return [str];
}

/** Composición de la columna. opts: { dir, g (contexto 2D para medir con las fuentes ya cargadas) }. */
export function componerTexto(T = PARCHMENT_TEXT, opts = {}) {
  const dirName = DIRECCIONES[opts.dir] ? opts.dir : DIR_DEFECTO; const D = DIRECCIONES[dirName];
  const g = opts.g || g2d(mk(8, 8));
  const RW = Math.round((TEXT_UV.u1 - TEXT_UV.u0) * REF_W), RH = Math.round((TEXT_UV.v1 - TEXT_UV.v0) * REF_H);
  const cx = (COLUMN.u - TEXT_UV.u0) * REF_W, half = COLUMN.halfWidth * REF_W, colW = 2 * half;
  const yTop = (TEXT_UV.v1 - COLUMN.vTop) * REF_H, yBot = (TEXT_UV.v1 - COLUMN.vBottom) * REF_H;
  const xR = cx + half;
  const xLat = (y) => Math.max(cx - half, (leftLimit(TEXT_UV.v1 - y / REF_H) - TEXT_UV.u0) * REF_W);
  const ratio = (st, ch = 'x') => Math.max(0.15, medir(g, D[st](100), ch).asc / 100);
  const R = { vs: ratio('versalitas', 'x'), vsCap: ratio('versalitas', 'T'), ti: ratio('titular'), no: ratio('nombres'), ve: ratio('verso'),
    ci: ratio('cifras', '0'), su: ratio('sub'), lu: ratio('lugar'), ce: ratio('cierre') };

  function plan(k, y0) {
    const items = []; let y = y0; let over = 0; const XB = 46 * k;
    const span = (a, b) => { let l = -1e9; for (let s = 0; s <= 6; s++) l = Math.max(l, xLat(a + (b - a) * s / 6)); return l; };
    const txt = (o) => {
      let px = o.px, sp = o.sp || 0; let font = D[o.est](px); let m = medir(g, font, o.texto, sp);
      let x = o.x ?? cx; const al = o.alinear || 'center';
      const lim = (o.libre ? -1e9 : span(o.y - m.asc, o.y + m.desc)) + 0.25 * XB;
      if (o.ajustar && m.l + m.r > xR + 0.2 * XB - lim) { // renglón de lucimiento: se achica para caber en el papel limpio a su altura
        const f = (xR + 0.2 * XB - lim) / (m.l + m.r); px *= f; sp *= f; font = D[o.est](px); m = medir(g, font, o.texto, sp);
      }
      let left = al === 'center' ? x - m.w / 2 : al === 'right' ? x - m.w : x;
      const ya = o.y - m.asc, yd = o.y + m.desc;
      let inkL = left - m.l, inkR = left + m.r;
      if (inkL < lim) { // la ola/flores de la izquierda: corre el renglón a la derecha si cabe
        const d = lim - inkL;
        if (inkR + d <= xR + 0.2 * XB) { left += d; x += d; inkL += d; inkR += d; } else over = Math.max(over, d - Math.max(0, xR + 0.2 * XB - inkR));
      }
      if (inkR > xR + 0.2 * XB) over = Math.max(over, inkR - xR - 0.2 * XB);
      const it = { id: o.id, tipo: 'texto', texto: o.texto, fuente: font, x, y: o.y, alinear: al, left, ancho: m.w, espaciado: sp,
        capa: o.capa || 'tinta', clase: o.clase, renglon: o.renglon, velocidad: o.vel ?? 1, caja: [inkL, ya, inkR, yd] };
      if (o.est === 'versalitas') it.engrosar = +(0.075 * XB).toFixed(2);   // trazo con cuerpo para las versalitas finas
      if (o.pausa != null) it.pausa = o.pausa;
      if (o.pausaFija != null) it.pausaFija = o.pausaFija;
      items.push(it); return { it, m };
    };
    const forma = (o) => { const it = Object.assign({ tipo: 'forma', relleno: true, capa: 'sepia', velocidad: 1.5 }, o); items.push(it); return it; };

    // 1) antetítulo en versalitas antiguas espaciadas
    {
      let px = (0.95 * XB) / R.vs, sp = 0.16 * px;
      const w = medir(g, D.versalitas(px), T.kicker || '', sp).w;
      if (w > colW * 0.92) { const f = (colW * 0.92) / w; px *= f; sp *= f; }
      const yb = y + R.vsCap * px;
      txt({ id: 'antetitulo', texto: T.kicker || '', est: 'versalitas', px, sp, y: yb, clase: 'kicker', renglon: 'antetitulo', vel: 1.1, pausa: 0.1, ajustar: true });
      y = yb + 1.05 * XB;
    }
    // 2) título
    {
      let px = (1.42 * XB) / R.ti; const w = medir(g, D.titular(px), T.title || '').w;
      if (w > colW * 0.97) px *= (colW * 0.97) / w;
      const m = medir(g, D.titular(px), T.title || '');
      const yb = y + m.asc;
      txt({ id: 'titulo', texto: T.title || '', est: 'titular', px, y: yb, clase: 'title', renglon: 'titulo', vel: 0.95, pausa: 0.3, ajustar: true });
      y = yb + Math.max(m.desc, 0.55 * XB) + 0.45 * XB;
    }
    // 3) filetes (de afuera hacia el centro, izquierda → derecha) + ❦ en oro
    {
      const yc = y + 0.95 * XB; const r0 = 1.75 * XB, r1 = Math.min(half - 0.9 * XB, 9.6 * XB), w = 0.14 * XB;
      const d = (sg) => pathFilete(cx + sg * r0, cx + sg * r1, yc, w) + pathCirculo(cx + sg * r0, yc, 0.13 * XB) + pathRombo(cx + sg * (r1 + 0.42 * XB), yc, 0.42 * XB, 0.14 * XB);
      forma({ id: 'filete-izq', d: d(-1), clase: 'fillet', renglon: 'adorno', pausa: 0.25 });
      if (!T.flourish || T.flourish === '❦') {
        const k2 = 2.45 * XB, c = Math.cos(-0.42), s = Math.sin(-0.42);
        const mtx = [P2(k2 * c), P2(k2 * s), P2(-k2 * s), P2(k2 * c), P2(cx), P2(yc + 0.05 * XB)];
        forma({ id: 'floron', d: FLEURON_HOJA, matriz: mtx, capa: 'oro', clase: 'fleuron', renglon: 'adorno', velocidad: 0.9, pausa: 0.08 });
        forma({ id: 'floron-zarcillo', d: FLEURON_TALLO, matriz: mtx, relleno: false, grosor: 0.07, capa: 'oro', clase: 'fleuron', renglon: 'adorno', velocidad: 0.9, pausa: 0.02 });
      } else {
        txt({ id: 'floron', texto: T.flourish, est: 'titular', px: 2.4 * XB / R.ti, y: yc + 0.8 * XB, capa: 'oro', clase: 'fleuron', renglon: 'adorno', vel: 0.9 });
      }
      forma({ id: 'filete-der', d: d(1), clase: 'fillet', renglon: 'adorno', pausa: 0.05 });
      y = yc + 1.15 * XB;
    }
    // 4) nombres en pan de oro: «Josué» a la izquierda, «y» pequeña bajo su final, «Marjhory» a la derecha
    {
      const [a, mid, b] = T.names || ['Josué', 'y', 'Marjhory'];
      const wa = medir(g, D.nombres(100), a).w, wb = medir(g, D.nombres(100), b).w;
      let N = (2.1 * XB) / R.no;
      N = Math.min(N, (half * 0.98) / (wb / 200 + 0.17), (half * 0.98) / (wa / 200 + 0.3));
      txt({ id: 'nombre-1', texto: a, est: 'nombres', px: N, x: cx - 0.3 * N, y: y + 0.8 * N, capa: 'oro', clase: 'name', renglon: 'nombres', vel: 0.55, pausa: 0.45 });
      txt({ id: 'nombre-y', texto: mid, est: 'nombres', px: 0.5 * N, x: cx + 0.6 * N, y: y + 1.05 * N, capa: 'oro', clase: 'name', renglon: 'nombres', vel: 0.6, pausa: 0.12 });
      txt({ id: 'nombre-2', texto: b, est: 'nombres', px: N, x: cx + 0.17 * N, y: y + 1.93 * N, capa: 'oro', clase: 'name', renglon: 'nombres', vel: 0.55, pausa: 0.15 });
      y += 2.28 * N + 0.55 * XB;
    }
    // 5) versículo en cursiva antigua (renglones equilibrados; el texto no cambia). Remojo de la pluma antes.
    {
      const px = XB / R.ve; const f = D.verso(px);
      const lines = (T.verse || []).flatMap((l) => wrapBalanced(g, f, l, colW * 0.97));
      let yb = y + 1.75 * XB;
      lines.forEach((l, i) => {
        txt({ id: 'verso-' + i, texto: l, est: 'verso', px, y: yb, clase: 'verse', renglon: 'verso-' + i, ...(i ? { pausa: 0.22 } : { pausaFija: 1.25, pausa: 0.1 }) });
        if (i < lines.length - 1) yb += 2.6 * XB;
      });
      y = yb + 1.25 * XB;
    }
    // 6) fecha y hora en dos columnas con divisor
    {
      const cols = T.details || []; const dx = 0.27 * colW; const colMax = half - 0.7 * XB;
      let lpx = (0.86 * XB) / R.vs, lsp = 0.2 * lpx;
      cols.forEach((c) => { const w = medir(g, D.versalitas(lpx), c.label || '', lsp).w; if (w > colMax) { const f = colMax / w; lpx *= f; lsp *= f; } });
      let vpx = (2.35 * XB) / R.ci;
      cols.forEach((c) => { const w = medir(g, D.cifras(vpx), c.value || '').w; if (w > colMax) vpx *= colMax / w; });
      let spx = (0.92 * XB) / R.su;
      cols.forEach((c) => { const w = medir(g, D.sub(spx), c.sub || '').w; if (w > colMax) spx *= colMax / w; });
      const yl = y + R.vsCap * lpx + 0.15 * XB, yv = yl + 0.7 * XB + R.ci * vpx, ys = yv + 2.15 * XB;
      cols.forEach((c, i) => {
        const x = cx + (i === 0 ? -dx : dx);
        txt({ id: `fecha-${i}-etiqueta`, texto: c.label || '', est: 'versalitas', px: lpx, sp: lsp, x, y: yl, clase: 'label', renglon: 'fecha', vel: 1.1, pausa: i ? 0.3 : 0.45 });
        txt({ id: `fecha-${i}-valor`, texto: c.value || '', est: 'cifras', px: vpx, x, y: yv, clase: 'value', renglon: 'fecha', vel: 0.85, pausa: 0.12 });
        txt({ id: `fecha-${i}-sub`, texto: c.sub || '', est: 'sub', px: spx, x, y: ys, clase: 'sub', renglon: 'fecha', pausa: 0.12 });
        if (i === 0 && cols.length > 1) {
          const y0 = yl - R.vsCap * lpx - 0.1 * XB, y1 = ys + 0.35 * XB, ym = (y0 + y1) / 2;
          forma({ id: 'divisor', d: pathRombo(cx, ym, 0.075 * XB, (y1 - y0) / 2) + pathRombo(cx, ym, 0.3 * XB, 0.48 * XB), clase: 'divider', renglon: 'fecha', velocidad: 1.4, pausa: 0.2 });
        }
      });
      y = ys + 0.55 * XB + 1.15 * XB;
    }
    // 7) lugar: etiqueta con filetes + nombre del lugar. Segundo remojo de la pluma antes.
    {
      const s = T.placeLabel || ''; let lpx = (0.86 * XB) / R.vs; const lsp = 0.26 * lpx;
      const lw = medir(g, D.versalitas(lpx), s, lsp).w;
      const yl = y + R.vsCap * lpx; const ym = yl - (R.vsCap * lpx) / 2;
      const a0 = lw / 2 + 0.75 * XB, a1 = Math.min(lw / 2 + 6.2 * XB, half - 0.4 * XB);
      forma({ id: 'lugar-filete-izq', d: pathFilete(cx - a0, cx - a1, ym, 0.11 * XB) + pathCirculo(cx - a0, ym, 0.1 * XB), clase: 'fillet', renglon: 'lugar', velocidad: 1.7, pausaFija: 1.25, pausa: 0.1 });
      txt({ id: 'lugar-etiqueta', texto: s, est: 'versalitas', px: lpx, sp: lsp, y: yl, clase: 'label', renglon: 'lugar', vel: 1.1, pausa: 0.08 });
      forma({ id: 'lugar-filete-der', d: pathFilete(cx + a0, cx + a1, ym, 0.11 * XB) + pathCirculo(cx + a0, ym, 0.1 * XB), clase: 'fillet', renglon: 'lugar', velocidad: 1.7, pausa: 0.05 });
      let px = (1.12 * XB) / R.lu; const w = medir(g, D.lugar(px), T.place || '').w;
      if (w > colW * 0.985) px *= (colW * 0.985) / w;
      const m = medir(g, D.lugar(px), T.place || '');
      const yp = yl + 0.85 * XB + m.asc;
      txt({ id: 'lugar', texto: T.place || '', est: 'lugar', px, y: yp, clase: 'place', renglon: 'lugar', pausa: 0.14, ajustar: true });
      y = yp + Math.max(m.desc, 0.5 * XB) + 0.85 * XB;
    }
    // 8) despedida
    {
      const px = (0.98 * XB) / R.ce; const f = D.cierre(px);
      let yb = y + 1.6 * XB;
      const avail = Math.min(colW * 0.95, xR - (xLat(yb + 3 * XB) + 0.25 * XB));   // la ola de abajo a la izquierda estrecha el papel
      const lines = (T.closing || []).flatMap((l) => wrapBalanced(g, f, l, avail));
      lines.forEach((l, i) => {
        txt({ id: 'cierre-' + i, texto: l, est: 'cierre', px, y: yb, clase: 'closing', renglon: 'cierre-' + i, pausa: i ? 0.2 : 0.4 });
        if (i < lines.length - 1) yb += 2.5 * XB;
      });
      y = yb + 0.75 * XB;
    }
    return { items, bottom: y, over, XB };
  }

  // mayor escala que cabe (alto disponible y bordes limpios), centrada en vertical
  let lo = 0.55, hi = 1.3;
  const fits = (k) => { const p = plan(k, yTop); return p.over <= 0.5 && p.bottom <= yBot; };
  if (fits(hi)) lo = hi; else for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (fits(m)) lo = m; else hi = m; }
  let p = plan(lo, yTop);
  const slack = yBot - p.bottom;
  if (slack > 2) { const p2 = plan(lo, yTop + slack / 2); if (p2.over <= 0.5 && p2.bottom <= yBot) p = p2; }
  return {
    version: LAYOUT_VERSION, dir: dirName, familias: D.familias.slice(), ancho: RW, alto: RH, ref: [REF_W, REF_H],
    rect: [TEXT_UV.u0, TEXT_UV.v0, TEXT_UV.u1, TEXT_UV.v1], k: lo, alturaX: p.XB, items: p.items,
  };
}

/** Huella del texto + fuentes + composición: si no coincide con texto_meta.json se compone en vivo (respaldo). */
export function textHash(T = PARCHMENT_TEXT, dirName = DIR_DEFECTO) {
  const D = DIRECCIONES[dirName] || DIRECCIONES[DIR_DEFECTO];
  const s = JSON.stringify([LAYOUT_VERSION, dirName, D.familias, ESTILOS.map((k) => D[k](10)), TEXT_UV, COLUMN, LEFT_LIMIT, T]);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Dibuja un elemento de la composición (px de composición; aplica la transformación vigente del contexto). */
export function dibujarItem(g, it, color = '#000') {
  g.fillStyle = color; g.strokeStyle = color;
  if (it.tipo === 'texto') {
    g.font = it.fuente; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; setLS(g, it.espaciado);
    g.fillText(it.texto, it.left, it.y);
    if (it.engrosar > 0) { g.lineJoin = 'round'; g.lineWidth = it.engrosar; g.strokeText(it.texto, it.left, it.y); }
    setLS(g, 0);
  } else {
    const m = it.matriz || [1, 0, 0, 1, 0, 0];
    g.save(); g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const p = new Path2D(it.d);
    if (it.relleno === false) { g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = it.grosor || 1; g.stroke(p); } else g.fill(p);
    g.restore();
  }
}
const MATERIAL = { tinta: 0, sepia: 128, oro: 255 };

// ───────────────────────────── respaldo en vivo: capa de texto + guion de la pluma por elemento ─────────────────────────────
// Solo si texto_* no existe o su huella no coincide con content.js: dibuja los elementos y arma un mapa de orden por barrido
// (letra a letra con inclinación; formas de izquierda a derecha o de arriba abajo). Es lo que hacía PARCH-ANIM, con la letra nueva.
function cajaForma(it) {
  const nums = (it.d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
  const m = it.matriz || [1, 0, 0, 1, 0, 0]; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = m[0] * nums[i] + m[2] * nums[i + 1] + m[4], y = m[1] * nums[i] + m[3] * nums[i + 1] + m[5];
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const s = Math.hypot(m[0], m[1]) * (it.relleno === false ? (it.grosor || 1) : 0.02) + 2;
  return [x0 - s, y0 - s, x1 + s, y1 + s];
}
function guionVivo(C, g) {
  const SPEED = 0.62; const els = [];
  let t = 0.15;
  for (const it of C.items) {
    const vel = it.velocidad || 1;
    const el = { it, kind: it.clase, layer: it.capa === 'oro' ? 'gold' : 'ink', renglon: it.renglon };
    t += ((it.pausa ?? 0.12) + (it.pausaFija || 0)) * SPEED;
    if (it.tipo === 'texto') {
      g.font = it.fuente; setLS(g, it.espaciado);
      const chars = [...it.texto]; const xs = [0]; let acc = '';
      for (const c of chars) { acc += c; xs.push(g.measureText(acc).width); }
      setLS(g, 0);
      const px = Number(/([\d.]+)px/.exec(it.fuente)[1]);
      el.xs = xs.map((v) => v + it.left); el.wts = chars.map((c, i) => (xs[i + 1] - xs[i]) * (c === ' ' ? 0.45 : 1) + 0.04 * px);
      el.fontPx = px; el.yb = it.y; el.slant = it.clase === 'name' ? 0.3 : it.clase === 'kicker' || it.clase === 'label' ? 0.05 : 0.22;
      el.bbox = it.caja.slice(); el.mode = 'text'; el.dur = (0.034 * chars.length + 0.18) / vel * SPEED;
    } else {
      el.bbox = cajaForma(it); const w = el.bbox[2] - el.bbox[0], h = el.bbox[3] - el.bbox[1];
      el.mode = h > 3 * w ? 'down' : 'ltr'; el.dur = 0.45 / vel * SPEED;
    }
    el.t0 = t; el.t1 = t + el.dur; t = el.t1;
    if (el.layer === 'gold') { el.g0 = el.t1 + 0.2; el.g1 = el.g0 + (it.clase === 'name' ? 0.55 : 0.3); }
    els.push(el);
  }
  const seconds = Math.max(t + 1.0, ...els.filter((e) => e.g1).map((e) => e.g1 + 0.5));
  for (const el of els) {
    if (el.mode === 'text') {
      const n = el.wts.length; const cum = [0]; for (let i = 0; i < n; i++) cum.push(cum[i] + el.wts[i]);
      const sum = cum[n] || 1;
      const x0 = Math.floor(el.bbox[0] - el.slant * el.fontPx - 4), x1 = Math.ceil(el.bbox[2] + el.slant * el.fontPx * 0.4 + 4);
      const lut = new Float32Array(Math.max(2, x1 - x0 + 1));
      for (let j = 0, i = 0; j < lut.length; j++) {
        const X = x0 + j;
        if (X <= el.xs[0]) { lut[j] = 0; continue; }
        if (X >= el.xs[n]) { lut[j] = 1; continue; }
        while (i < n - 1 && X > el.xs[i + 1]) i++;
        const span = Math.max(1e-6, el.xs[i + 1] - el.xs[i]);
        lut[j] = (cum[i] + el.wts[i] * ((X - el.xs[i]) / span)) / sum;
      }
      el.frac = (X, Y) => { const j = Math.round(X - el.slant * (el.yb - Y)) - x0; return lut[j < 0 ? 0 : j >= lut.length ? lut.length - 1 : j]; };
      el.penAt = (f) => { let lo = 0, hi = lut.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (lut[m] < f) lo = m + 1; else hi = m; } return [x0 + lo, el.yb - 0.3 * el.fontPx * 0.5]; };
    } else if (el.mode === 'down') {
      el.frac = (X, Y) => clamp01((Y - el.bbox[1]) / Math.max(1, el.bbox[3] - el.bbox[1]));
      el.penAt = (f) => [(el.bbox[0] + el.bbox[2]) / 2, el.bbox[1] + (el.bbox[3] - el.bbox[1]) * f];
    } else {
      el.frac = (X) => clamp01((X - el.bbox[0]) / Math.max(1, el.bbox[2] - el.bbox[0]));
      el.penAt = (f) => [el.bbox[0] + (el.bbox[2] - el.bbox[0]) * f, (el.bbox[1] + el.bbox[3]) / 2];
    }
  }
  return { els, seconds };
}

/** Capa de texto en vivo (RGBA: A = cobertura, G = material) + mapa de orden RG (segundos) a media resolución. */
function componerVivo(C, S, g) {
  const rw = Math.ceil(C.ancho * S), rh = Math.ceil(C.alto * S);
  const tc = mk(rw, rh), gt = g2d(tc); gt.setTransform(S, 0, 0, S, 0, 0);
  for (const it of C.items) { const v = MATERIAL[it.capa] ?? 0; dibujarItem(gt, it, `rgb(255,${v},0)`); }
  const GS = guionVivo(C, g);
  const f = 0.5 * S; const ow = Math.max(1, Math.ceil(C.ancho * f)), oh = Math.max(1, Math.ceil(C.alto * f));
  const n = ow * oh; const R = new Float32Array(n).fill(GS.seconds * 1.01), G = new Float32Array(n).fill(GS.seconds * 1.01), own = new Float32Array(n);
  const sc = mk(8, 8);
  for (const el of GS.els) {
    const m = 10; const b = el.bbox;
    const x0 = Math.max(0, Math.floor((b[0] - m) * f)), y0 = Math.max(0, Math.floor((b[1] - m) * f));
    const x1 = Math.min(ow, Math.ceil((b[2] + m) * f)), y1 = Math.min(oh, Math.ceil((b[3] + m) * f));
    const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) continue;
    sc.width = w; sc.height = h; const sg = g2d(sc);
    sg.setTransform(f, 0, 0, f, -x0, -y0); sg.shadowColor = '#000'; sg.shadowBlur = Math.max(2, 6 * f);
    dibujarItem(sg, el.it, '#000');
    const d = sg.getImageData(0, 0, w, h).data;
    const gold = el.layer === 'gold'; const dt = el.t1 - el.t0; const dg = gold ? el.g1 - el.g0 : 0;
    for (let j = 0; j < h; j++) {
      const Y = (y0 + j + 0.5) / f;
      for (let i = 0; i < w; i++) {
        const a = d[(j * w + i) * 4 + 3] / 255; if (a < 0.03) continue;
        const idx = (y0 + j) * ow + x0 + i; if (a <= own[idx]) continue; own[idx] = a;
        const X = (x0 + i + 0.5) / f; const fr = el.frac(X, Y);
        R[idx] = el.t0 + dt * fr + (hash2(x0 + i, y0 + j, 91) - 0.5) * 0.02;
        G[idx] = gold ? el.g0 + dg * fr : R[idx];
      }
    }
  }
  sc.width = sc.height = 1;
  return { text: tc, order: { R, G, ow, oh }, guion: GS };
}

// ───────────────────────────── texto horneado: assets/tex/texto_* ─────────────────────────────
async function cargarHorneado(texBase, hash) {
  try {
    const r = await fetch(texBase + 'texto_meta.json', { cache: 'no-cache' });
    if (!r.ok) return { ok: false, why: 'sin texto_meta.json' };
    const meta = await r.json();
    if (meta.hash !== hash || meta.version !== LAYOUT_VERSION) return { ok: false, why: `huella distinta (${meta.hash} ≠ ${hash})`, meta };
    const [tinta, orden] = await Promise.all([loadImage(texBase + (meta.archivos?.tinta || 'texto_tinta.png')), loadImage(texBase + (meta.archivos?.orden || 'texto_orden.png'))]);
    if (!tinta || !orden) return { ok: false, why: 'faltan texto_tinta/texto_orden' };
    return { ok: true, meta, tinta, orden };
  } catch (e) { return { ok: false, why: String(e) }; }
}
/** texto_orden.png (RGB: R·256+G = instante 0..65534 de duracion; B = demora del dorado en 10 ms) → R/G en segundos. */
function decodificarOrden(img, meta) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = mk(w, h), g = g2d(c); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, w, h).data; c.width = c.height = 1;
  const SEC = meta.segundos; const k = SEC / 65534; const never = SEC * 1.01;
  const R = new Float32Array(w * h), G = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const q = d[p] * 256 + d[p + 1];
    if (q >= 65535) { R[i] = never; G[i] = never; continue; }
    const t = q * k; R[i] = t; G[i] = t + d[p + 2] * 0.01;
  }
  return { R, G, ow: w, oh: h };
}

/** Respaldo (sin assets/tex/antiguo_*): papel pergamino_albedo (o procedural) + ornamento floral de referencia-0 impreso. */
function composePaperFallback({ cw, ch, albedoImg, ornament }) {
  const paper = mk(cw, ch), g = g2d(paper);
  if (albedoImg) g.drawImage(albedoImg, 0, 0, cw, ch);
  else g.drawImage(fallbackPaper(Math.round(cw / 2), Math.round(ch / 2), 11, false), 0, 0, cw, ch);
  let threads = null;
  if (ornament) {
    threads = mk(cw, ch); const gt = g2d(threads);
    const sc = (ch * 0.8) / ornament.h; const ow = ornament.w * sc, oh = ornament.h * sc;
    const ox = -0.045 * cw, oy = ch * 0.07;
    g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.94; g.imageSmoothingQuality = 'high';
    g.drawImage(ornament.print, ox, oy, ow, oh); g.restore();
    gt.imageSmoothingQuality = 'high'; gt.drawImage(ornament.threads, ox, oy, ow, oh);
  }
  return { paper, threads };
}

/** Bordes del papel por fila (para las paredes del canto) a partir de la máscara. Devuelve arrays de u ∈ [0,1]. */
function maskEdges(maskSrc, rows) {
  const w = Math.min(512, maskSrc.width), h = Math.round(w * (maskSrc.height / maskSrc.width));
  const c = mk(w, h), g = g2d(c, true); g.drawImage(maskSrc, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data;
  const left = new Float32Array(rows), right = new Float32Array(rows), run = Math.max(3, Math.round(w * 0.006));
  for (let i = 0; i < rows; i++) {
    const v = Math.min(0.965, Math.max(0.035, i / (rows - 1))); const y = Math.min(h - 1, Math.round((1 - v) * (h - 1)));
    const lum = (x) => d[(y * w + x) * 4 + 1];
    let l = -1, r = -1;
    for (let x = 0, cnt = 0; x < w; x++) { cnt = lum(x) > 127 ? cnt + 1 : 0; if (cnt >= run) { l = x - run + 1; break; } }
    for (let x = w - 1, cnt = 0; x >= 0; x--) { cnt = lum(x) > 127 ? cnt + 1 : 0; if (cnt >= run) { r = x + run - 1; break; } }
    left[i] = l < 0 ? 0.5 : (l + 0.5) / w; right[i] = r < 0 ? 0.5 : (r + 0.5) / w;
  }
  // suaviza (3 tomas) y repara filas vacías
  const sm = (a) => { const b = new Float32Array(a); for (let i = 1; i < a.length - 1; i++) b[i] = (a[i - 1] + 2 * a[i] + a[i + 1]) / 4; return b; };
  return { left: sm(left), right: sm(right) };
}

// ───────────────────────────── GLSL ─────────────────────────────
const GLSL_DEFORM = /* glsl */`
uniform float pLf;
uniform float pR;
uniform float pTau;
uniform float pW;
uniform float pH;
uniform float pTime;
uniform float pBow;
uniform float pCup;
uniform float pEdgeWave;
uniform float pFlutter;
uniform float pBreath;
uniform float pHeightAmt;
uniform sampler2D pHeight;
varying vec4 vParch; // x: a (arco dentro del rollo, ≤0 en la parte plana), y: vueltas, z: e (distancia a la tangencia), w: x local
#define P_PI 3.14159265358979
#define P_TWO_PI 6.28318530717959
float pSmoothD(float a, float b, float x, out float d) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  d = (x > a && x < b) ? 6.0 * t * (1.0 - t) / (b - a) : 0.0;
  return t * t * (3.0 - 2.0 * t);
}
// desplazamiento a lo largo de la normal y sus derivadas analíticas: (D, dD/dx, dD/ds)
// = [taza lateral + ondas del borde + aleteo + respiración + cockling horneado] · g(e) + arco de memoria del rollo
vec3 parchDisp(float x, float s, float e, float sg) {
  float dg; float sm = pSmoothD(0.0, 0.06, e, dg);
  float g = mix(0.035, 1.0, sm);
  float g_s = (1.0 - 0.035) * dg * (-sg);
  float xn = 2.0 * x / pW;
  float cup = pCup * (xn * xn - 0.3333);
  float cup_x = pCup * 2.0 * xn * (2.0 / pW);
  float ax = abs(xn); float dq; float q = pSmoothD(0.62, 1.0, ax, dq);
  float m = q * q; float m_x = 2.0 * q * dq * (2.0 / pW) * sign(xn);
  float ph1 = s * 57.0 + 1.3 + 0.25 * sin(pTime * 0.37); float ph2 = s * 131.0 + x * 23.0 + 4.1;
  float wv = sin(ph1) + 0.55 * sin(ph2);
  float wv_s = 57.0 * cos(ph1) + 72.05 * cos(ph2);
  float wv_x = 12.65 * cos(ph2);
  float ew = pEdgeWave * m * wv, ew_x = pEdgeWave * (m_x * wv + m * wv_x), ew_s = pEdgeWave * m * wv_s;
  // aleteo de los bordes laterales: onda viajera lenta, modulada (más fuerte mientras el papel se mueve)
  float fp = s * 41.0 - pTime * 2.3 + x * 6.0;
  float fa = 0.62 + 0.38 * sin(pTime * 0.83 + s * 4.0 + sign(xn) * 1.9);
  float fs = sin(fp), fc = cos(fp);
  float fl = pFlutter * m * fs * fa, fl_s = pFlutter * m * 41.0 * fc * fa, fl_x = pFlutter * (m_x * fs + m * 6.0 * fc) * fa;
  float b1 = s * 8.0 + pTime * 0.45, b2 = x * 9.0 - pTime * 0.31 + 1.7;
  float ba = pBreath * 0.00045;
  float br = ba * sin(b1) * sin(b2), br_s = ba * 8.0 * cos(b1) * sin(b2), br_x = ba * 9.0 * sin(b1) * cos(b2);
  float F = cup + ew + fl + br, F_x = cup_x + ew_x + fl_x + br_x, F_s = ew_s + fl_s + br_s;
  float h = 0.5 * pLf; float bow = 0.0, bow_s = 0.0;
  if (abs(s) < h) { float w = 1.0 - (s * s) / (h * h); bow = -pBow * w * w; bow_s = 4.0 * pBow * s * w / (h * h); }
  // cockling (ondulación del papel viejo) horneado por BL-PARCH: 0.5 = 0 mm; su pendiente entra en la normal
  vec2 huv = vec2(x / pW + 0.5, s / pH + 0.5);
  vec2 hts = 2.0 / vec2(textureSize(pHeight, 0));
  float hk = pHeightAmt * 0.003;
  float hc = (textureLod(pHeight, huv, 0.0).r - 0.5) * hk;
  float hx = (textureLod(pHeight, huv + vec2(hts.x, 0.0), 0.0).r - textureLod(pHeight, huv - vec2(hts.x, 0.0), 0.0).r) * hk / (2.0 * hts.x * pW);
  float hs = (textureLod(pHeight, huv + vec2(0.0, hts.y), 0.0).r - textureLod(pHeight, huv - vec2(0.0, hts.y), 0.0).r) * hk / (2.0 * hts.y * pH);
  F += hc; F_x += hx; F_s += hs;
  return vec3(g * F + bow, g * F_x, g_s * F + g * F_s + bow_s);
}
void parchDeform(vec3 p, out vec3 pos, out vec3 nrm) {
  float x = p.x, s = p.y, off = p.z;
  float sg = s < 0.0 ? -1.0 : 1.0;
  float as_ = abs(s);
  float h = 0.5 * pLf;
  float a = as_ - h;
  vec2 P = vec2(as_, 0.0), T = vec2(1.0, 0.0);
  float k = 0.0, turns = 0.0;
  if (a > 0.0) {
    float r = sqrt(max(pR * pR - pTau * a / P_PI, 1e-10));
    float th = P_TWO_PI * (pR - r) / pTau;
    vec2 rad = vec2(sin(th), -cos(th));
    P = vec2(h, pR) + r * rad;
    T = normalize(vec2(cos(th), sin(th)) - (pTau / (P_TWO_PI * r)) * rad);
    k = 1.0 / r; turns = th / P_TWO_PI;
  }
  vec3 tS = vec3(0.0, T.x, sg * T.y);
  vec3 nB = vec3(0.0, -sg * T.y, T.x);
  vec3 base = vec3(x, sg * P.x, P.y);
  float e = h - as_;
  vec3 D = parchDisp(x, s, e, sg);
  float dn = D.x + off;
  pos = base + nB * dn;
  vec3 dPdx = vec3(1.0, 0.0, 0.0) + nB * D.y;
  vec3 dPds = tS * (1.0 - k * dn) + nB * D.z;
  nrm = normalize(cross(dPdx, dPds));
  vParch = vec4(a, turns, e, x);
}
`;

const GLSL_FRAG_PARS = /* glsl */`
uniform float pW;
uniform float pH;
uniform float pR;
uniform float pLf;
uniform float pTime;
uniform sampler2D pBackMap;
uniform vec3 pBackTint;
uniform sampler2D pThreadMap;
uniform sampler2D pTextMap;
uniform sampler2D pOrderMap;
uniform vec4 pTextRect;
uniform vec2 pTextSize;
uniform float pTextSharp;
uniform float pCovFromA;
uniform float pTextFade;
uniform float pWrite;
uniform float pRevSoft;
uniform float pWetDur;
uniform float pGildDur;
uniform float pFrontDecay;
uniform float pPenGlow;
uniform float pGildFlash;
uniform vec3 pInkColor;
uniform vec3 pSepiaColor;
uniform vec3 pWetColor;
uniform vec4 pDips;
uniform float pLoadSpan;
uniform float pThreadMetal;
uniform float pThreadRough;
uniform float pSweep;
uniform float pSweepGain;
uniform float pGoldGlow;
uniform float pGoldRough;
uniform float pGoldBump;
uniform float pLodBias;
uniform vec4 pPaperLift;   // CREMA: (curva global, curva en la columna, desaturación global, desaturación en la columna)
uniform vec4 pLiftRect;    // CREMA: columna de texto en UV (u0, v0, u1, v1) donde el papel se aclara más
uniform vec3 pPaperCream;  // CREMA: tono crema (lineal) hacia el que se lleva el papel
uniform float pInkBold;    // CREMA: cuerpo de la tinta (>1 = trazo más lleno y oscuro desde lejos)
uniform float pGoldMetal;  // CREMA: metalicidad del pan de oro de los nombres
uniform float pGoldTone;   // CREMA: cuánto refleja el oro (1 = espejo; < 1 = oro viejo más hondo, se lee sobre crema)
varying vec4 vParch;
float parchAO() {
  float a = vParch.x, turns = vParch.y, e = vParch.z;
  float endLeak = smoothstep(0.5 * pW - 0.007, 0.5 * pW, abs(vParch.w));
  float ao = 1.0;
  if (a > 0.0) {
    bool inner = gl_FrontFacing || turns > 0.97;
    if (inner) {
      float depth = turns + (gl_FrontFacing ? 0.5 : 0.0);
      ao = mix(0.42, 0.10, smoothstep(0.0, 3.0, depth));
      ao = mix(ao, 0.8, endLeak);
    } else {
      ao = 1.0 - 0.55 * smoothstep(0.55, 0.97, turns);
    }
  } else if (gl_FrontFacing) {
    float rr = max(pR, 0.004);
    float e2 = max(pLf - e, 0.0);
    float f1 = 1.0 - 0.45 * exp(-e / (0.5 * rr)) - 0.15 * exp(-e / (2.5 * rr));
    float f2 = 1.0 - 0.45 * exp(-e2 / (0.5 * rr)) - 0.15 * exp(-e2 / (2.5 * rr));
    ao = f1 * f2 * mix(0.18, 1.0, smoothstep(0.6 * rr, 3.5 * rr, 0.5 * pLf));
  }
  return clamp(ao, 0.0, 1.0);
}
float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), f.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// pan de oro procedural (en px de composición): tono variable, juntas de las hojas, craquelado que deja ver el bol y lascas
vec3 parchGoldLeaf(vec2 tuv) {
  vec2 p = tuv * pTextSize;
  float n = pNoise(p / 38.0) * 0.6 + pNoise(p / 11.0) * 0.28 + pNoise(p / 3.5) * 0.12;
  // FIX (legibilidad, decisión n.º 5): oro viejo más profundo (los nombres medían 1.7–1.9:1 contra el papel); el brillo queda
  // para los destellos (barrido de luz y dorado)
  // CREMA: sobre papel claro, oro aún más profundo (bronce dorado); el brillo lo ponen los reflejos y los destellos
  vec3 c = mix(vec3(0.11, 0.058, 0.012), vec3(0.42, 0.26, 0.065), smoothstep(0.12, 0.88, n));
  vec2 q = fract(p / 190.0 + vec2(0.13, 0.37));
  float seam = 1.0 - 0.16 * (1.0 - smoothstep(0.0, 0.012, min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y))));
  vec2 g = p / 22.0; vec2 gi = floor(g), gf = fract(g); float f1 = 9.0, f2 = 9.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 r = o + vec2(pHash(gi + o), pHash(gi + o + 17.3)) * 0.8 + 0.1 - gf;
    float d = dot(r, r);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
  }
  float crack = (1.0 - smoothstep(0.02, 0.09, sqrt(f2) - sqrt(f1))) * step(0.35, pHash(gi * 1.7 + 3.1));
  float flake = step(0.966, pHash(floor(p / 2.2)));
  return mix(c * seam, vec3(0.17, 0.045, 0.02), max(crack * 0.5, flake * 0.8));
}
`;

// Cara: papel antiguo + capa de texto. La escritura compara el mapa de orden (instante de cada píxel según los TRAZOS reales del
// glifo) con pWrite: la tinta corre por el trazo, húmeda y brillante en la punta, se seca más oscura; acumulación al final de cada
// trazo (canal B), tinta más cargada tras cada remojo (pDips). Nombres: mordiente y luego se doran con chispas. Sin grano ni sepia.
const GLSL_MAP = /* glsl */`
float pGold = 0.0, pThread = 0.0, pInk = 0.0, pWet = 0.0; vec2 parchBump = vec2(0.0); vec3 pEmit = vec3(0.0);
#ifdef USE_MAP
  if (gl_FrontFacing) {
    diffuseColor *= texture(map, vMapUv, pLodBias);
    { // CREMA (decisión n.º 9.4): papel más claro y crema (sobre todo en la columna de texto) para leer desde lejos; la curva
      // aclara medios y altos y respeta los oscuros, así quedan las fibras, manchas y el diseño floral
      vec2 lq = (vMapUv - pLiftRect.xy) / (pLiftRect.zw - pLiftRect.xy);
      float lm = smoothstep(-0.12, 0.1, lq.x) * smoothstep(-0.05, 0.06, lq.y) * smoothstep(-0.05, 0.06, 1.0 - lq.y);
      float pl = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
      float pk = mix(pPaperLift.x, pPaperLift.y, lm);
      float pl2 = 1.0 - pow(1.0 - min(pl, 0.995), pk);
      vec3 ch = diffuseColor.rgb / pl, cc = pPaperCream / dot(pPaperCream, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(ch, cc, mix(pPaperLift.z, pPaperLift.w, lm)) * pl2;
    }
    pThread = texture(pThreadMap, vMapUv).r;
    vec2 tuv = (vMapUv - pTextRect.xy) / (pTextRect.zw - pTextRect.xy);
    vec2 tDx = dFdx(tuv), tDy = dFdy(tuv);
    if (tuv.x > 0.0 && tuv.x < 1.0 && tuv.y > 0.0 && tuv.y < 1.0) {
      vec4 tx = textureGrad(pTextMap, tuv, tDx * pTextSharp, tDy * pTextSharp);
      float cov = mix(tx.r, tx.a, pCovFromA) * pTextFade;
      cov = 1.0 - pow(1.0 - clamp(cov, 0.0, 1.0), pInkBold); // CREMA: trazo con más cuerpo (bordes suavizados más llenos)
      float matv = tx.g;
      float pool = tx.b * (1.0 - pCovFromA);
      float gk = smoothstep(0.7, 0.92, matv);
      float sep = smoothstep(0.25, 0.45, matv) * (1.0 - gk);
      float rev = 1.0, wet = 0.0, front = 0.0, gild = 1.0, flash = 0.0, load = 1.0, spread = 0.0;
      if (pWrite < 0.9999) {
        vec2 od = textureLod(pOrderMap, tuv, 0.0).rg;
        float age = pWrite - od.r;
        rev = smoothstep(0.0, pRevSoft, age);
        wet = rev * (1.0 - smoothstep(0.0, pWetDur * (1.0 + 1.6 * pool), age));
        front = rev * exp(-max(age, 0.0) / pFrontDecay);
        float gl = clamp((pWrite - od.g) / pGildDur, 0.0, 1.0);
        gild = gl * gl * (3.0 - 2.0 * gl);
        flash = gild * (1.0 - gild) * 4.0;
        float last = 0.0;
        if (od.r >= pDips.x) last = pDips.x;
        if (od.r >= pDips.y) last = pDips.y;
        if (od.r >= pDips.z) last = pDips.z;
        load = 1.0 - smoothstep(0.0, pLoadSpan, od.r - last);
        if (wet > 0.001) {
          vec4 sb = textureGrad(pTextMap, tuv, tDx * 5.0 + vec2(0.0022, 0.0), tDy * 5.0 + vec2(0.0, 0.0009));
          spread = mix(sb.r, sb.a, pCovFromA) * wet;
        }
      }
      float a = cov * rev;
      float aS = max(a, spread * 0.42 * (1.0 - gk));
      float rim = 0.0;   // filete oscuro de bol alrededor del oro (como en los códices iluminados): los nombres se leen mejor
      if (gk > 0.01) {
        vec2 e2 = 1.0 / vec2(textureSize(pTextMap, 0));
        vec4 bl = textureGrad(pTextMap, tuv, tDx * 3.0 + vec2(e2.x * 5.0, 0.0), tDy * 3.0 + vec2(0.0, e2.y * 5.0));
        rim = clamp(mix(bl.r, bl.a, pCovFromA) * pTextFade * 5.5 - cov, 0.0, 1.0) * gk * rev;
        // sombra suave del oro en relieve (la vela está arriba a la izquierda → cae abajo a la derecha)
        // CREMA: sombra más marcada (sobre papel claro el oro necesita su relieve oscuro para leerse desde lejos)
        vec4 sh = textureGrad(pTextMap, tuv + vec2(-e2.x * 4.0, e2.y * 4.0), tDx * 4.0 + vec2(e2.x * 3.0, 0.0), tDy * 4.0 + vec2(0.0, e2.y * 3.0));
        rim = max(rim, clamp(mix(sh.r, sh.a, pCovFromA) * pTextFade * 2.2 - cov, 0.0, 1.0) * gk * rev * 0.85);
      }
      vec3 dry = mix(pInkColor, pSepiaColor, sep) * (1.0 + 0.3 * (1.0 - load));
      vec3 inkC = mix(dry, pWetColor, pow(wet, 0.75)) * (1.0 - 0.28 * pool);
      vec3 base = diffuseColor.rgb;
      vec3 cInk = mix(base, inkC, aS);
      vec3 mord = mix(vec3(0.16, 0.05, 0.022), vec3(0.085, 0.024, 0.012), wet);
      vec3 leaf = gk > 0.001 ? parchGoldLeaf(tuv) : vec3(0.8, 0.6, 0.3);
      vec3 cGold = mix(base * (1.0 - 0.95 * rim * vec3(0.85, 0.9, 0.95)), mix(mord, leaf, gild), a);
      diffuseColor.rgb = mix(cInk, cGold, gk);
      pInk = aS * (1.0 - gk);
      pGold = a * gk * gild;
      pWet = wet * a * (1.0 - gk * gild);
      pEmit = vec3(1.0, 0.8, 0.52) * pPenGlow * front * a * (1.0 - gk * gild);
      vec2 cell = floor(tuv * pTextSize / 2.0);
      float tw = fract(sin(dot(cell + floor(pTime * 14.0) * vec2(7.13, 3.71), vec2(12.9898, 78.233))) * 43758.5453);
      pEmit += leaf * gk * flash * a * pGildFlash * (0.35 + 1.8 * step(0.8, tw));
      if (pGold > 0.004) { // relieve del pan de oro: biselado desde la cobertura
        vec2 e = 1.0 / vec2(textureSize(pTextMap, 0));
        vec4 l4 = textureGrad(pTextMap, tuv - vec2(e.x, 0.0), tDx, tDy), r4 = textureGrad(pTextMap, tuv + vec2(e.x, 0.0), tDx, tDy);
        vec4 d4 = textureGrad(pTextMap, tuv - vec2(0.0, e.y), tDx, tDy), u4 = textureGrad(pTextMap, tuv + vec2(0.0, e.y), tDx, tDy);
        float cL = mix(l4.r, l4.a, pCovFromA), cR = mix(r4.r, r4.a, pCovFromA), cD = mix(d4.r, d4.a, pCovFromA), cU = mix(u4.r, u4.a, pCovFromA);
        parchBump = vec2(cL - cR, cD - cU) * pGoldBump * gild;
      }
    }
  } else {
    // reverso: v comprimido hacia el centro para que el borde tostado de los extremos no domine el rollo abierto
    diffuseColor *= texture(pBackMap, vec2(vMapUv.x, 0.5 + (vMapUv.y - 0.5) * 0.94)) * vec4(pBackTint, 1.0);
    diffuseColor.rgb *= 1.0 - 0.4 * smoothstep(0.984, 0.998, abs(vMapUv.y - 0.5) * 2.0); // línea de cola en la varilla
  }
#endif
float pAO = parchAO();
`;

// Los extremos superior/inferior de la hoja van pegados a las varillas: corte recto (se ignora el rasgado de la máscara en v≈0/1).
const GLSL_ALPHAMAP = /* glsl */`
#ifdef USE_ALPHAMAP
  diffuseColor.a *= texture2D( alphaMap, vec2( vAlphaMapUv.x, clamp( vAlphaMapUv.y, 0.035, 0.965 ) ) ).g;
#endif
`;

// ───────────────────────────── API principal ─────────────────────────────
const INK_DRY = [0.0091, 0.0049, 0.0027];    // CREMA: #1a120c casi negro (tinta ferrogálica seca, antes #24150c), lineal
const INK_SEPIA = [0.095, 0.045, 0.016];     // adornos (filetes, divisor) en sepia, lineal
const INK_WET = [0.0125, 0.0115, 0.022];     // recién puesta: negro azulado (agalla de hierro fresca, ≈ misma luminancia); seca a negro café
const WET_REAL_S = 0.95;                      // la tinta brilla húmeda ~1 s de tiempo REAL (se adapta a la velocidad de la escena)

export async function createParchment(opts = {}) {
  const THREE = opts.THREE; const renderer = opts.renderer;
  if (!THREE) throw new Error('createParchment: falta opts.THREE');
  const texBase = opts.texBase ?? new URL('../assets/tex/', import.meta.url).href;
  const ornamentUrl = opts.ornamentUrl ?? new URL('../assets/photos/referencia-0.jpg', import.meta.url).href;
  const T = opts.text || PARCHMENT_TEXT;
  const dirName = DIRECCIONES[opts.dir] ? opts.dir : DIR_DEFECTO;
  const segX = Math.max(24, opts.segmentsX | 0 || 48);
  const segY = Math.max(480, opts.segmentsY | 0 || 640);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const maxTex = renderer?.capabilities?.maxTextureSize || 4096;
  let cw = opts.textureWidth || (coarse ? 1536 : 2048);
  while (cw * (H / W) > maxTex && cw > 512) cw = Math.round(cw * 0.75);
  const ch = Math.round(cw * (H / W));
  const aniso = renderer?.capabilities?.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;

  const TM = {}; let tm0 = performance.now(); const lap = (k) => { const t = performance.now(); TM[k] = Math.round(t - tm0); tm0 = t; };
  const hash = textHash(T, dirName);
  // carga en paralelo: texturas ANTIGUAS (prioridad), altura del cockling y el TEXTO HORNEADO (si su huella coincide no hacen
  // falta ni las fuentes ni componer nada: solo decodificar el mapa de orden)
  const useAntiguo = opts.legacy !== true;
  const A = (n) => (useAntiguo ? loadImage(texBase + 'antiguo_' + n) : Promise.resolve(null));
  const bakedP = opts.live === true ? Promise.resolve({ ok: false, why: 'opts.live' }) : cargarHorneado(texBase, hash);
  let [albedoImg, backImg, normalImg, roughImg, maskImg, goldImg, heightImg, baked] = await Promise.all([
    A('albedo.jpg'), A('back.jpg'), A('normal.jpg'), A('rough.jpg'), A('mask.png'), A('gold.png'),
    loadImage(texBase + 'pergamino_height.jpg'), bakedP,
  ]);
  const antiguo = !!albedoImg;
  const usingFallback = { albedo: !albedoImg, back: !backImg, normal: !normalImg, rough: !roughImg, mask: !maskImg, gold: !goldImg, height: !heightImg, text: !baked.ok };
  let ornImg = null;
  if (!albedoImg || !backImg || !normalImg || !roughImg || !maskImg) {
    const P = (img, n) => (img ? Promise.resolve(img) : loadImage(texBase + 'pergamino_' + n));
    [albedoImg, backImg, normalImg, roughImg, maskImg, ornImg] = await Promise.all([
      P(albedoImg, 'albedo.jpg'), P(backImg, 'back.jpg'), P(normalImg, 'normal.jpg'), P(roughImg, 'rough.jpg'), P(maskImg, 'mask.png'),
      antiguo ? null : loadImage(ornamentUrl),
    ]);
  }
  lap('load');

  // ── papel: albedo antiguo directo (reducido si hace falta) o respaldo compuesto con el ornamento
  const resize = (img, w) => { const c = mk(w, Math.round(w * (img.naturalHeight || img.height) / (img.naturalWidth || img.width))); const g = g2d(c); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, c.width, c.height); return c; };
  let paperSrc, threadsSrc = null;
  if (antiguo) {
    paperSrc = (albedoImg.naturalWidth || albedoImg.width) > cw * 1.05 ? resize(albedoImg, cw) : albedoImg;
    threadsSrc = goldImg;
  } else {
    const ornament = ornImg ? processOrnament(ornImg) : null; lap('ornament');
    const fb = composePaperFallback({ cw, ch, albedoImg, ornament });
    paperSrc = fb.paper;
    if (fb.threads) { const t = mk(Math.round(cw / 2), Math.round(ch / 2)), gt = g2d(t); gt.fillStyle = '#000'; gt.fillRect(0, 0, t.width, t.height); gt.drawImage(fb.threads, 0, 0, t.width, t.height); threadsSrc = t; }
  }
  lap('paper');

  // ── texto: HORNEADO (trazos reales del motor de escritura) o composición EN VIVO de respaldo
  const idle = typeof opts.idle === 'function' ? () => Promise.resolve(opts.idle()).catch(() => {}) : null;
  const toH = THREE.DataUtils.toHalfFloat;
  let textSrc, OM, SEC, model, fontsOk = null, C = null, bakedInfo = null;
  const rect = [TEXT_UV.u0, TEXT_UV.v0, TEXT_UV.u1, TEXT_UV.v1];
  const compToLocal = (X, Y, out) => { out[0] = (TEXT_UV.u0 + X / REF_W - 0.5) * W; out[1] = (TEXT_UV.v1 - Y / REF_H - 0.5) * H; return out; };
  if (baked.ok) {
    const meta = baked.meta; SEC = meta.segundos;
    if (idle) await idle();
    // texto_tinta: RGB (R = cobertura, G = material, B = acumulación). En pantallas táctiles se reduce a 3/4 (memoria)
    textSrc = coarse && (baked.tinta.naturalWidth || baked.tinta.width) > 900 ? resize(baked.tinta, Math.round((baked.tinta.naturalWidth || baked.tinta.width) * 0.75)) : baked.tinta;
    // texto_orden: instante 16-bit empaquetado + demora del dorado → RG half-float normalizado por SEC
    const img = baked.orden; const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const c = mk(w, h), g = g2d(c); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, w, h).data; c.width = c.height = 1;
    const k = meta.duracionMapa / 65534 / SEC; const NEVER = toH(1.02);
    const LUT = new Uint16Array(65536); for (let q = 0; q < 65535; q++) LUT[q] = toH(q * k); LUT[65535] = NEVER;
    const data = new Uint16Array(w * h * 2);
    for (let j = 0; j < h; j++) {
      const src = j * w, dst = (h - 1 - j) * w;        // DataTexture no invierte Y
      for (let i = 0; i < w; i++) {
        const p = (src + i) * 4; const q = d[p] * 256 + d[p + 1]; const o = (dst + i) * 2;
        data[o] = LUT[q];
        data[o + 1] = d[p + 2] && q < 65535 ? toH(q * k + d[p + 2] * 0.02 / SEC) : LUT[q];
      }
    }
    OM = { data, ow: w, oh: h };
    model = modeloHorneado(meta, compToLocal);
    bakedInfo = { hash: meta.hash, trazos: meta.trazos.length, segundos: SEC, tinta: meta.tinta, orden: meta.orden };
    lap('text-baked');
  } else {
    if (baked.why && !/opts\.live/.test(baked.why)) console.info('[parchment] texto en vivo (respaldo):', baked.why);
    fontsOk = await ensureFonts(dirName);
    if (idle) await idle();
    const g = g2d(mk(8, 8));
    C = componerTexto(T, { dir: dirName, g }); lap('layout');
    const S = cw / REF_W;
    const V = componerVivo(C, S, g);
    textSrc = V.text; SEC = V.guion.seconds;
    const n = V.order.ow * V.order.oh; const data = new Uint16Array(n * 2);
    for (let j = 0; j < V.order.oh; j++) {
      const src = j * V.order.ow, dst = (V.order.oh - 1 - j) * V.order.ow;
      for (let i = 0; i < V.order.ow; i++) { data[(dst + i) * 2] = toH(V.order.R[src + i] / SEC); data[(dst + i) * 2 + 1] = toH(V.order.G[src + i] / SEC); }
    }
    OM = { data, ow: V.order.ow, oh: V.order.oh };
    model = modeloVivo(V.guion, C, compToLocal);
    lap('text-live');
  }

  // ── texturas three
  const disposables = [];
  const tex = (src, srgb, mips = true) => {
    const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = mips;
    t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = aniso; t.needsUpdate = true; disposables.push(t); return t;
  };
  const paperTex = tex(paperSrc, true); paperTex.anisotropy = Math.min(aniso, 8);
  const textTex = tex(textSrc, false); textTex.anisotropy = Math.min(aniso, 8);
  if (!baked.ok) textTex.premultiplyAlpha = false;
  const threadTex = threadsSrc ? tex(threadsSrc, false) : tex(mk(4, 4), false); threadTex.anisotropy = Math.min(aniso, 4);
  const backTex = tex(backImg || fallbackPaper(512, 888, 29, true), true); backTex.anisotropy = Math.min(aniso, 4);
  let heightSrc = heightImg; let normalSrc = normalImg;
  if (!heightSrc) heightSrc = fallbackHeight(256, 444, 41);
  if (!normalSrc) normalSrc = normalFromHeight(heightSrc, 3.0, 1.0);
  else if (coarse && (normalSrc.naturalWidth || normalSrc.width) > 1100) normalSrc = resize(normalSrc, 1024);
  const normalTex = tex(normalSrc, false); normalTex.anisotropy = Math.min(aniso, 4);
  const roughTex = tex(roughImg || noiseCanvas(256, 444, 64, 111, 23, 196, 236), false); roughTex.anisotropy = Math.min(aniso, 2);
  const maskSrc = maskImg || fallbackMask(512, 888, 3);
  const maskTex = tex(maskSrc, false); maskTex.anisotropy = 4;
  const heightTex = tex(heightSrc, false, false);
  const orderTex = new THREE.DataTexture(OM.data, OM.ow, OM.oh, THREE.RGFormat, THREE.HalfFloatType);
  orderTex.minFilter = orderTex.magFilter = THREE.LinearFilter; orderTex.generateMipmaps = false;
  orderTex.wrapS = orderTex.wrapT = THREE.ClampToEdgeWrapping; orderTex.colorSpace = THREE.NoColorSpace; orderTex.needsUpdate = true;
  disposables.push(orderTex);
  lap('textures');

  // ── uniformes compartidos (hoja, sombras, canto)
  const dips = model.dips.map((d) => d.end / SEC);
  const U = {
    pLf: { value: LF_MIN }, pR: { value: R_C }, pTau: { value: TAU }, pW: { value: W }, pH: { value: H },
    pTime: { value: 0 }, pBow: { value: 0 }, pCup: { value: 0.0011 }, pEdgeWave: { value: 0.0006 }, pFlutter: { value: 0.0003 }, pBreath: { value: 1 },
    pHeightAmt: { value: heightImg ? 2.6 : 1.4 }, pHeight: { value: heightTex },
    pBackTint: { value: antiguo || backImg ? new THREE.Color(0.97, 0.92, 0.86) : new THREE.Color(0.93, 0.8, 0.63) },
    pBackMap: { value: backTex }, pThreadMap: { value: threadTex },
    pTextMap: { value: textTex }, pOrderMap: { value: orderTex }, pTextRect: { value: new THREE.Vector4(rect[0], rect[1], rect[2], rect[3]) },
    pTextSize: { value: new THREE.Vector2(Math.round((TEXT_UV.u1 - TEXT_UV.u0) * REF_W), Math.round((TEXT_UV.v1 - TEXT_UV.v0) * REF_H)) },
    pTextSharp: { value: 0.85 }, pCovFromA: { value: baked.ok ? 0 : 1 }, pTextFade: { value: 1 },
    pWrite: { value: 1 }, pRevSoft: { value: 0.03 / SEC }, pWetDur: { value: WET_REAL_S / SEC }, pGildDur: { value: 0.35 / SEC },
    pFrontDecay: { value: 0.035 / SEC }, pPenGlow: { value: 0.45 }, pGildFlash: { value: 1.6 },
    pInkColor: { value: new THREE.Vector3(...INK_DRY) }, pSepiaColor: { value: new THREE.Vector3(...INK_SEPIA) }, pWetColor: { value: new THREE.Vector3(...INK_WET) },
    pDips: { value: new THREE.Vector4(dips[0] ?? 9, dips[1] ?? 9, dips[2] ?? 9, 9) }, pLoadSpan: { value: 4.5 / SEC },
    pThreadMetal: { value: antiguo ? 0.7 : 0.6 }, pThreadRough: { value: antiguo ? 0.34 : 0.36 },
    pSweep: { value: -9 }, pSweepGain: { value: 1.25 }, pGoldGlow: { value: 0.07 }, pGoldRough: { value: 0.25 }, pGoldBump: { value: 1.4 },
    pLodBias: { value: -0.3 },
    // CREMA (decisión n.º 9.4): papel claro en la columna, tinta con cuerpo y oro de los nombres menos espejo (se ajustan en vivo)
    pPaperLift: { value: new THREE.Vector4(1.5, 2.8, 0.25, 0.65) },
    pLiftRect: { value: new THREE.Vector4(TEXT_UV.u0 + 0.06, TEXT_UV.v0 - 0.02, TEXT_UV.u1, TEXT_UV.v1 + 0.02) },
    pPaperCream: { value: new THREE.Vector3(0.88, 0.78, 0.6) },
    pInkBold: { value: 1.7 },
    pGoldMetal: { value: 0.6 }, pGoldTone: { value: 0.6 },
  };
  const bindUniforms = (shader) => { for (const k in U) shader.uniforms[k] = U[k]; };
  const vertDeform = (vs, withNormal) => {
    vs = vs.replace('#include <common>', '#include <common>\n' + GLSL_DEFORM);
    if (withNormal) {
      vs = vs.replace('#include <beginnormal_vertex>', 'vec3 parchP; vec3 objectNormal; parchDeform(position, parchP, objectNormal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3( tangent.xyz );\n#endif');
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = parchP;');
    } else {
      vs = vs.replace('#include <begin_vertex>', '#include <begin_vertex>\n{ vec3 pn_; parchDeform(position, transformed, pn_); }');
    }
    return vs;
  };

  // ── material de la hoja
  const ALPHA_TEST = antiguo ? 0.45 : 0.5;
  const ns = antiguo ? 2.0 : normalImg ? 2.4 : 1;
  const mat = new THREE.MeshPhysicalMaterial({
    map: paperTex, normalMap: normalTex, normalScale: new THREE.Vector2(ns, ns), roughnessMap: roughTex, roughness: 1.0, metalness: 0.0,
    alphaMap: maskTex, alphaTest: ALPHA_TEST, side: THREE.DoubleSide, sheen: 0.2, sheenRoughness: 0.78, sheenColor: new THREE.Color(0xf6e3c0),
    specularIntensity: 0.42, envMapIntensity: 1.0,
  });
  mat.alphaToCoverage = true;
  if (opts.envMap) mat.envMap = opts.envMap;
  mat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    shader.vertexShader = vertDeform(shader.vertexShader, true);
    const nfm = THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * mix(1.0, 0.3, pGold) * (1.0 - 0.75 * pWet) * (1.0 - 0.6 * pInk);\n\tmapN.xy += parchBump;');
    if (nfm === THREE.ShaderChunk.normal_fragment_maps) console.warn('[parchment] normal_fragment_maps no parcheado (cambió three)');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_FRAG_PARS)
      .replace('#include <map_fragment>', GLSL_MAP)
      .replace('#include <alphamap_fragment>', GLSL_ALPHAMAP)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.62, pInk * 0.5);
        roughnessFactor = mix(roughnessFactor, pThreadRough, pThread * 0.6);
        roughnessFactor = mix(roughnessFactor, pGoldRough, pGold);
        roughnessFactor = mix(roughnessFactor, 0.6, pWet);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, pThreadMetal, pThread);
        metalnessFactor = mix(metalnessFactor, pGoldMetal, pGold);`)
      .replace('#include <normal_fragment_maps>', nfm)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec2 q = vMapUv - 0.5;
          float along = (q.x * pW * 0.9063 + q.y * pH * 0.4226) / 0.17;
          float band = exp(-pow((along - pSweep * 1.15) / 0.16, 2.0));
          float gAmt = max(pGold, pThread * 0.55);
          totalEmissiveRadiance += diffuseColor.rgb * gAmt * (pGoldGlow + band * pSweepGain * 1.35) * pAO;
          if (gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * band * 0.03 * pAO * (1.0 - pInk) + pEmit * pAO;
        }`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.directDiffuse *= pAO; reflectedLight.directSpecular *= pAO;
        reflectedLight.indirectDiffuse *= pAO; reflectedLight.indirectSpecular *= pAO;
        reflectedLight.indirectSpecular *= mix(1.0, 0.8 * pGoldTone, pGold);   // FIX legibilidad: oro algo más profundo (sin perder el barrido)
        reflectedLight.directSpecular *= mix(1.0, pGoldTone, pGold);           // CREMA: sobre papel claro el oro se lee más hondo
        #ifdef USE_SHEEN
        sheenSpecularDirect *= pAO; sheenSpecularIndirect *= pAO;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'parch-sheet-v3';

  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: maskTex, alphaTest: ALPHA_TEST, side: THREE.DoubleSide });
  depthMat.onBeforeCompile = (shader) => { bindUniforms(shader); shader.vertexShader = vertDeform(shader.vertexShader, false); shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', GLSL_ALPHAMAP); };
  depthMat.customProgramCacheKey = () => 'parch-depth-v2';
  const distMat = new THREE.MeshDistanceMaterial({ alphaMap: maskTex, alphaTest: ALPHA_TEST, side: THREE.DoubleSide });
  distMat.onBeforeCompile = (shader) => { bindUniforms(shader); shader.vertexShader = vertDeform(shader.vertexShader, false); shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', GLSL_ALPHAMAP); };
  distMat.customProgramCacheKey = () => 'parch-dist-v2';

  // ── geometría de la hoja (la deformación ocurre en GPU; position.z = desplazamiento extra a lo largo de la normal)
  const geo = new THREE.PlaneGeometry(W, H, segX, segY);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.015), Math.hypot(W / 2, H / 2) + 0.03);
  geo.boundingBox = new THREE.Box3(new THREE.Vector3(-W / 2 - 0.01, -H / 2 - 0.02, -0.02), new THREE.Vector3(W / 2 + 0.01, H / 2 + 0.02, 0.06));
  const sheet = new THREE.Mesh(geo, mat);
  sheet.name = 'pergamino_hoja'; sheet.castShadow = true; sheet.receiveShadow = true;
  sheet.customDepthMaterial = depthMat; sheet.customDistanceMaterial = distMat;

  // ── canto del papel (paredes laterales siguiendo el borde deshilachado → se ve la espiral en los extremos)
  const rows = segY + 1; const edges = maskEdges(maskSrc, rows);
  const ePos = new Float32Array(rows * 4 * 3); const eUv = new Float32Array(rows * 4 * 2); const eIdx = [];
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < rows; i++) {
      const v = i / (rows - 1); const s = -H / 2 + H * v;
      const u = side === 0 ? edges.left[i] : edges.right[i]; const x = (u - 0.5) * W;
      const base = (side * rows + i) * 2;
      ePos.set([x, s, EDGE_T / 2], base * 3); ePos.set([x, s, -EDGE_T / 2], (base + 1) * 3);
      const ut = u + (side === 0 ? 0.03 : -0.03);
      eUv.set([ut, v], base * 2); eUv.set([ut, v], (base + 1) * 2);
      if (i < rows - 1) {
        const a = base, b = base + 1, c = base + 2, d = base + 3;
        if (side === 1) eIdx.push(b, c, a, b, d, c); else eIdx.push(b, a, c, b, c, d);
      }
    }
  }
  const eGeo = new THREE.BufferGeometry();
  eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
  eGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rows * 4 * 3), 3));
  eGeo.setAttribute('uv', new THREE.BufferAttribute(eUv, 2));
  eGeo.setIndex(eIdx);
  eGeo.boundingSphere = geo.boundingSphere.clone(); eGeo.boundingBox = geo.boundingBox.clone();
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf0dfbf, roughness: 0.88, metalness: 0, map: backTex });
  edgeMat.onBeforeCompile = (shader) => {
    bindUniforms(shader);
    shader.vertexShader = vertDeform(shader.vertexShader, true).replace('parchDeform(position, parchP, objectNormal);', 'parchDeform(position, parchP, objectNormal); objectNormal = vec3(sign(position.x), 0.0, 0.0);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vParch;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= mix(1.0, 0.7, smoothstep(0.0, 3.0, vParch.y));');
  };
  edgeMat.customProgramCacheKey = () => 'parch-edge-v2';
  const edgeMesh = new THREE.Mesh(eGeo, edgeMat); edgeMesh.name = 'pergamino_canto'; edgeMesh.receiveShadow = true;

  lap('materials');
  const group = new THREE.Group(); group.name = 'Pergamino';
  group.add(sheet, edgeMesh);

  // ── estado: desenrollado
  let cur = rollState(0);
  let baseBow = 0;
  function setUnroll(u) {
    cur = rollState(u);
    U.pLf.value = cur.Lf; U.pR.value = cur.R;
    baseBow = 0.0032 * sstep(0.3, 1.0, Math.min(1, cur.u));
    U.pBow.value = baseBow + phys.flex;
  }
  function getRolls() {
    return {
      top: { center: new THREE.Vector3(0, cur.Lf / 2, cur.R), radius: cur.R, angle: cur.angleTop },
      bottom: { center: new THREE.Vector3(0, -cur.Lf / 2, cur.R), radius: cur.R, angle: cur.angleBottom },
    };
  }
  function setLightSweep(x) { U.pSweep.value = x; }

  // ── física secundaria del papel (sin cambiar setUnroll)
  const phys = { lastU: null, lastT: null, vel: 0, velS: 0, acc: 0, flex: 0, flexV: 0, flutter: 0.0003, reduced: false };
  const FLEX_W = TWO_PI * 1.55, FLEX_Z = 0.16, FLEX_K = 0.0015;
  // velocidad de reproducción de la escritura (s naturales por s reales): la tinta húmeda dura ~1 s REAL aunque la escena acelere
  const play = { lastW: null, rate: 1 };
  function update(time /* s */, dt) {
    if (Number.isFinite(time)) U.pTime.value = time;
    let h = Number.isFinite(dt) && dt > 0 ? dt : phys.lastT != null && Number.isFinite(time) ? time - phys.lastT : 1 / 60;
    if (Number.isFinite(time)) phys.lastT = time;
    h = Math.min(0.05, Math.max(1e-4, h));
    const u = cur.u;
    if (phys.lastU == null) phys.lastU = u;
    const v = (u - phys.lastU) / h; phys.lastU = u;
    const a1 = 1 - Math.exp(-h / 0.06);
    const velPrev = phys.velS; phys.velS += (v - phys.velS) * a1;
    const acc = Math.max(-25, Math.min(25, (phys.velS - velPrev) / h)); phys.acc += (acc - phys.acc) * a1;
    if (!phys.reduced) {
      const n = Math.ceil(h / 0.004), hs = h / n;
      for (let i = 0; i < n; i++) {
        const f = -FLEX_W * FLEX_W * phys.flex - 2 * FLEX_Z * FLEX_W * phys.flexV - FLEX_K * FLEX_W * FLEX_W * phys.acc;
        phys.flexV += f * hs; phys.flex += phys.flexV * hs;
      }
      phys.flex = Math.max(-0.005, Math.min(0.005, phys.flex));
      const target = 0.00026 + 0.0011 * Math.min(1, Math.abs(phys.velS) * 1.6) + 0.06 * Math.min(0.01, Math.abs(phys.flexV));
      phys.flutter += (target - phys.flutter) * (1 - Math.exp(-h / 0.25));
    } else { phys.flex = 0; phys.flexV = 0; phys.flutter = 0; }
    U.pBow.value = baseBow + phys.flex;
    U.pFlutter.value = phys.flutter;
    if (play.lastW != null) {
      const jump = (writeT - play.lastW) * SEC, dw = jump / h;   // saltos (seek, volver arriba) no cuentan como velocidad
      if (jump > 0 && jump < 0.6 && dw > 0.05 && writeT < 1) { const r = Math.min(8, Math.max(0.6, dw)); play.rate += (r - play.rate) * (1 - Math.exp(-h / 0.3)); }
    }
    play.lastW = writeT;
    U.pWetDur.value = (WET_REAL_S * play.rate) / SEC;
    U.pFrontDecay.value = (0.035 * play.rate) / SEC;
  }
  function setReducedMotion(on) { phys.reduced = !!on; U.pBreath.value = on ? 0 : 1; if (on) { U.pFlutter.value = 0; } }
  setUnroll(0);

  // ── escritura a mano: estado, pluma y renglón en curso
  let writeT = 1;
  function setWriting(t) { writeT = clamp01(Number.isFinite(+t) ? +t : 1); U.pWrite.value = writeT; }
  /** Opacidad de toda la capa de texto (0..1): para el fundido corto de prefers-reduced-motion (con setWriting(1)). */
  function setTextOpacity(a) { U.pTextFade.value = clamp01(Number.isFinite(+a) ? +a : 1); }
  const _pen = { pos: new THREE.Vector3(), tangent: new THREE.Vector3(1, 0, 0), down: false, pressure: 0, strokeIndex: -1, lineIndex: -1,
    lift: 1, gold: false, dip: 0, speed: 0, t: 0 };
  const surfaceZ = (y) => 0.0004 - U.pBow.value * Math.max(0, 1 - (y / Math.max(0.01, cur.Lf / 2)) ** 2) ** 2;
  const _a = [0, 0], _b = [0, 0];
  /** Pluma en el instante t (0..1 como setWriting): pos (local de la hoja), tangente, abajo/arriba, presión, trazo y renglón. */
  function getPenAt(t) {
    const ts = clamp01(Number.isFinite(+t) ? +t : 0) * SEC; const S = model.strokes; _pen.t = clamp01(+t || 0);
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S[m].t0 <= ts) lo = m; else hi = m - 1; }
    const s = S[lo]; _pen.dip = 0; _pen.gold = !!s?.gold;
    if (!s) return _pen;
    if (ts < s.t0 || (ts > s.t1 && lo === S.length - 1)) { // antes del primero o después del último: levantada
      const p = ts < s.t0 ? 0 : s.n - 1;
      _pen.pos.set(s.p[p * 4], s.p[p * 4 + 1], surfaceZ(s.p[p * 4 + 1]) + 0.012);
      _pen.down = false; _pen.pressure = 0; _pen.lift = 1; _pen.strokeIndex = ts < s.t0 ? -1 : lo; _pen.lineIndex = s.line; _pen.speed = 0;
      return _pen;
    }
    if (ts <= s.t1) { // trazando: interpola en la polilínea por tiempo
      let a = 0, b = s.n - 1;
      while (b - a > 1) { const m = (a + b) >> 1; if (s.p[m * 4 + 2] <= ts) a = m; else b = m; }
      const ta = s.p[a * 4 + 2], tb = s.p[b * 4 + 2]; const f = tb > ta ? clamp01((ts - ta) / (tb - ta)) : 0;
      const x = s.p[a * 4] + (s.p[b * 4] - s.p[a * 4]) * f, y = s.p[a * 4 + 1] + (s.p[b * 4 + 1] - s.p[a * 4 + 1]) * f;
      const r = s.p[a * 4 + 3] + (s.p[b * 4 + 3] - s.p[a * 4 + 3]) * f;
      const dx = s.p[b * 4] - s.p[a * 4], dy = s.p[b * 4 + 1] - s.p[a * 4 + 1]; const L = Math.hypot(dx, dy);
      if (L > 1e-7) _pen.tangent.set(dx / L, dy / L, 0);
      _pen.speed = tb > ta ? L / (tb - ta) : 0;
      const env = Math.min(1, (ts - s.t0) / 0.04, (s.t1 - ts) / 0.04);
      _pen.pos.set(x, y, surfaceZ(y)); _pen.down = true; _pen.lift = 0;
      _pen.pressure = clamp01(r / s.rRef) * (0.55 + 0.45 * clamp01(env)); _pen.strokeIndex = lo; _pen.lineIndex = s.line;
      return _pen;
    }
    // en el aire, hacia el trazo siguiente (o mojando la pluma en el tintero)
    const n = S[lo + 1]; const g0 = s.t1, g1 = n.t0; const f = clamp01((ts - g0) / Math.max(1e-4, g1 - g0)); const e = f * f * (3 - 2 * f);
    _a[0] = s.p[(s.n - 1) * 4]; _a[1] = s.p[(s.n - 1) * 4 + 1]; _b[0] = n.p[0]; _b[1] = n.p[1];
    const dist = Math.hypot(_b[0] - _a[0], _b[1] - _a[1]);
    const dip = model.dips.find((d) => d.start <= ts + 1e-3 && d.end >= ts - 1e-3 && d.end <= g1 + 0.6);
    const hLift = dip ? 0.03 : Math.min(0.012, 0.0018 + 0.12 * dist);
    const x = _a[0] + (_b[0] - _a[0]) * e, y = _a[1] + (_b[1] - _a[1]) * e;
    _pen.pos.set(x, y, surfaceZ(y) + hLift * Math.sin(Math.PI * f));
    if (dist > 1e-6) _pen.tangent.set((_b[0] - _a[0]) / dist, (_b[1] - _a[1]) / dist, 0);
    _pen.down = false; _pen.pressure = 0; _pen.lift = Math.sin(Math.PI * f); _pen.strokeIndex = lo; _pen.lineIndex = n.line; _pen.gold = !!n.gold;
    _pen.dip = dip ? clamp01((ts - dip.start) / Math.max(1e-4, dip.end - dip.start)) : 0;
    _pen.speed = dist / Math.max(1e-4, g1 - g0);
    return _pen;
  }
  /** Caja local {x0,y0,x1,y1} del renglón que se escribe en t (0..1); se adelanta ~0.25 s al siguiente para que la cámara llegue a tiempo. */
  const _focus = { x0: 0, y0: 0, x1: 0, y1: 0, lineIndex: 0, center: new THREE.Vector3(), id: '' };
  function getFocus(t) {
    const ts = clamp01(Number.isFinite(+t) ? +t : 0) * SEC; const L = model.lines;
    let i = 0; while (i + 1 < L.length && L[i + 1].t0 - 0.25 <= ts) i++;
    const l = L[i]; Object.assign(_focus, { x0: l.box[0], y0: l.box[1], x1: l.box[2], y1: l.box[3], lineIndex: i, id: l.id });
    _focus.center.set((l.box[0] + l.box[2]) / 2, (l.box[1] + l.box[3]) / 2, 0);
    return _focus;
  }
  // compatibilidad PARCH-ANIM / scroll3d: getPen() = pluma en el instante actual
  const _penC = { active: false, gold: false, gilding: false, kind: null, uv: [0, 0], position: new THREE.Vector3(), speed: 0 };
  function getPen() {
    const p = getPenAt(writeT); const ts = writeT * SEC;
    _penC.active = p.down && writeT < 1; _penC.gold = p.gold; _penC.speed = p.speed;
    _penC.gilding = writeT < 1 && model.elements.some((e) => e.g0 != null && ts >= e.g0 && ts < e.g1 + 0.3);
    const s = model.strokes[Math.max(0, p.strokeIndex)]; _penC.kind = s ? model.elements[s.el]?.clase ?? null : null;
    _penC.position.copy(p.pos); _penC.uv[0] = p.pos.x / W + 0.5; _penC.uv[1] = p.pos.y / H + 0.5;
    return _penC;
  }
  const norm = (s) => s / SEC;
  const writing = {
    seconds: SEC, baked: !!baked.ok, hash,
    textArea: TEXT_AREA,
    timeline: model.elements.map((e) => ({ kind: e.clase, id: e.id, layer: e.capa === 'oro' ? 'gold' : 'ink', start: norm(e.t0), end: norm(e.t1), gildStart: e.g0 != null ? norm(e.g0) : null, gildEnd: e.g1 != null ? norm(e.g1) : null })),
    lines: model.lines.map((l, i) => ({ index: i, id: l.id, elements: l.elements, box: { x0: l.box[0], y0: l.box[1], x1: l.box[2], y1: l.box[3] }, start: norm(l.t0), end: norm(l.t1), startSec: l.t0, endSec: l.t1 })),
    strokes: { count: model.strokes.length, items: model.strokes.map((s) => ({ start: norm(s.t0), end: norm(s.t1), line: s.line, gold: s.gold, deferred: s.deferred })) },
    dips: model.dips.map((d) => ({ start: norm(d.start), end: norm(d.end), before: d.before })),
  };

  function dispose() {
    geo.dispose(); eGeo.dispose(); mat.dispose(); depthMat.dispose(); distMat.dispose(); edgeMat.dispose();
    disposables.forEach((t) => t.dispose());
    [textSrc instanceof HTMLCanvasElement ? textSrc : null, paperSrc instanceof HTMLCanvasElement ? paperSrc : null].forEach((c) => { if (c) c.width = c.height = 1; });
    group.removeFromParent();
  }
  lap('ready');

  return {
    group, setUnroll, getRolls, setLightSweep, update, dispose,
    setWriting, getWriting: () => writeT, getPen, getPenAt, getFocus, writing, setTextOpacity,
    setReducedMotion, get u() { return cur.u; }, get state() { return { ...cur }; },
    mesh: sheet, edgeMesh, material: mat, uniforms: U, usingFallback, fontsOk, antiguo,
    debug: { paper: paperSrc, text: textSrc, order: OM, layout: C, model, baked: bakedInfo, textureSize: [cw, ch], textRect: rect, timings: TM, physics: phys, play },
  };
}

// ───────────────────────────── modelo de escritura (trazos, renglones, remojos) ─────────────────────────────
function modeloHorneado(meta, toLocal) {
  const tmp = [0, 0];
  const elements = meta.elementos.map((e, i) => ({ ...e, i }));
  const idxById = new Map(meta.elementos.map((e, i) => [e.id, i]));
  const elIndex = new Map(); // índice de elemento del motor (e) → índice en elements (por id: el motor numera todos los elementos de la spec)
  const lines = meta.renglones.map((r) => {
    const a = toLocal(r.caja[0], r.caja[3], [0, 0]), b = toLocal(r.caja[2], r.caja[1], [0, 0]);
    return { id: r.id, elements: r.elementos, t0: r.t0, t1: r.t1, box: [a[0], a[1], b[0], b[1]] };
  });
  const rq = { ink: [], gold: [] };
  const strokes = meta.trazos.map((s) => {
    const n = s.p.length / 4; const p = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      toLocal(s.p[i * 4], s.p[i * 4 + 1], tmp);
      p[i * 4] = tmp[0]; p[i * 4 + 1] = tmp[1]; p[i * 4 + 2] = s.p[i * 4 + 2]; p[i * 4 + 3] = s.p[i * 4 + 3] * (W / REF_W);
      (s.o ? rq.gold : rq.ink).push(p[i * 4 + 3]);
    }
    return { t0: s.t0, t1: s.t1, n, p, line: s.r, gold: !!s.o, deferred: !!s.d, el: s.e, rRef: 1 };
  });
  const pct = (a, q) => { if (!a.length) return 1e-3; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))] || 1e-3; };
  const rI = pct(rq.ink, 0.9), rG = pct(rq.gold, 0.9);
  for (const s of strokes) s.rRef = s.gold ? rG : rI;
  // índice de elemento: el motor usa el índice de la spec; texto_meta lista solo los que tienen trazos → mapear por posición original
  for (const s of strokes) { const e = elements.find((x) => x.k === s.el); if (e) s.el = e.i; }
  const dips = (meta.remojos || []).map((d) => ({ start: d.t0, end: d.t1, before: d.antes }));
  void idxById; void elIndex;
  return { strokes, lines, elements, dips };
}
function modeloVivo(GS, C, toLocal) {
  const tmp = [0, 0]; const elements = []; const strokes = []; const rg = new Map();
  GS.els.forEach((el, i) => {
    const it = el.it;
    elements.push({ id: it.id, clase: it.clase, capa: it.capa, renglon: it.renglon, t0: el.t0, t1: el.t1, g0: el.g0 ?? null, g1: el.g1 ?? null, i });
    const n = 14; const p = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1); const [X, Y] = el.penAt(f); toLocal(X, Y, tmp);
      p[k * 4] = tmp[0]; p[k * 4 + 1] = tmp[1]; p[k * 4 + 2] = el.t0 + (el.t1 - el.t0) * f; p[k * 4 + 3] = 0.0006;
    }
    if (!rg.has(it.renglon)) rg.set(it.renglon, { id: it.renglon, elements: [], t0: el.t0, t1: el.g1 ?? el.t1, box: [1e9, 1e9, -1e9, -1e9] });
    const r = rg.get(it.renglon); r.elements.push(it.id); r.t0 = Math.min(r.t0, el.t0); r.t1 = Math.max(r.t1, el.g1 ?? el.t1);
    const a = toLocal(el.bbox[0], el.bbox[3], [0, 0]), b = toLocal(el.bbox[2], el.bbox[1], [0, 0]);
    r.box = [Math.min(r.box[0], a[0]), Math.min(r.box[1], a[1]), Math.max(r.box[2], b[0]), Math.max(r.box[3], b[1])];
    strokes.push({ t0: el.t0, t1: el.t1, n, p, line: 0, gold: el.layer === 'gold', deferred: false, el: i, rRef: 0.0006, renglon: it.renglon });
  });
  const lines = [...rg.values()].sort((a, b) => a.t0 - b.t0);
  const li = new Map(lines.map((l, i) => [l.id, i]));
  for (const s of strokes) s.line = li.get(s.renglon) ?? 0;
  const dips = [];
  C.items.forEach((it, i) => { if (it.pausaFija) { const el = GS.els[i]; dips.push({ start: el.t0 - it.pausaFija * 0.62 - 0.05, end: el.t0 - 0.05, before: it.id }); } });
  return { strokes, lines, elements, dips };
}
