// js/mapa.js — MAPA · mini mapa dorado de la ubicación (SPEC decisión n.º 7)
//
// Auto-montable: monta todo elemento [data-mapa] (marcado en assets/mapa/INTEGRAR.md). Sin dependencias (GSAP no hace
// falta), sin WebGL y sin peticiones a otros dominios: datos y relieve horneados en assets/mapa/ (tools/mapa/hornear.py).
// Al entrar en pantalla (y ser visible de verdad: se respeta la opacidad de los contenedores, p. ej. el bloque 2 de #final)
// se anima UNA vez (~7 s):
//   1) el relieve del valle aparece y los ríos y caminos se dibujan solos como tinta dorada (la PE-3S llega desde los dos
//      bordes y converge en el lugar; chispa de luz en la punta de cada trazo), nombres y rumbos (Ayacucho / Andahuaylas);
//   2) la cámara baja del valle al pueblo (zoom continuo en escala logarítmica, relieve de detalle con fundido);
//   3) se dibujan las calles, la ruta de acceso desde la carretera sube hasta el lugar, cae un PIN dorado que late con
//      ondas, y aparece la tarjeta "Ahuayro — Pailahuantuna · jueves 24 de diciembre · 5:00 p. m." (texto real del DOM).
// Inclinación 3D suave con el ratón o el giroscopio (si el navegador ya da deviceorientation). Tocar el mapa → EVENT.mapUrl.
// prefers-reduced-motion (o ?reduced=1, html.reduced, __inv.shell.reduced) → estado final sin animación ni inclinación.
// API de prueba: window.__mapa = { instancias, montar(el) } y window.__inv.mapa (lo mismo).
//   instancia: { listo: Promise, seek(t), play(), replay(), pausar(), get t(), duracion, estado(), dispose() }
import { EVENT } from './content.js';

const BASE = new URL('../assets/mapa/', import.meta.url);
const QS = new URLSearchParams(location.search);
const MQ_RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const FINE = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
// COMPAT-FLUIDEZ: con html.soft-motion (preferencia del sistema → modo suave de main.js) el mapa se dibuja igual
const reducido = () => !!((MQ_RM?.matches && !document.documentElement.classList.contains('soft-motion')) || QS.has('reduced') || document.documentElement.classList.contains('reduced') || window.__inv?.shell?.reduced);

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, t) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const eInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eOut = t => 1 - Math.pow(1 - t, 3);
const eInOutS = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const NS = 'http://www.w3.org/2000/svg';

// Línea de tiempo (s)
const T = {
  relieve: [0, 0.95], asienta: [0, 1.25], deriva: [1.25, 3.0],
  zoom: [3.0, 5.15],
  valleFuera: [3.5, 4.2], relValleFuera: [3.95, 4.8],
  relPueblo: [3.55, 4.4], pueblo: [3.75, 4.45],
  nomValle: 1.5, nomValleFuera: 3.0, meta: 2.6, metaFuera: [4.25, 4.8],
  calles: [4.35, 5.4], ruta: [4.95, 6.2], rayo: 5.55, pin: 5.85, info: 6.4, nomPueblo: 5.35, idle: 6.9, fin: 7.0,
};

let datosP = null;
const datos = () => (datosP ||= fetch(new URL('mapa.json', BASE)).then(r => {
  if (!r.ok) throw new Error('mapa.json ' + r.status);
  return r.json();
}));

/* ------------------------------------------------------------------ textos (de content.js) */
function textos() {
  const mes = String(EVENT.monthYear || '').split(' ')[0] || '';
  const fecha = `${String(EVENT.weekday || '').toLowerCase()} ${EVENT.day} de ${mes}`.trim();
  const h = Number((String(EVENT.isoStart || '').match(/T(\d{2})/) || [])[1]);
  const hora = `${EVENT.time} ${Number.isFinite(h) && h >= 12 ? 'p. m.' : 'a. m.'}`;
  return { lugar: EVENT.place, fecha, hora, iso: EVENT.isoStart, mapUrl: EVENT.mapUrl, rutaUrl: EVENT.directionsUrl };
}
function gms(v, pos, neg) {
  const a = Math.abs(v); let g = Math.floor(a); let m = Math.floor((a - g) * 60); let s = Math.round(((a - g) * 60 - m) * 60);
  if (s === 60) { s = 0; m++; } if (m === 60) { m = 0; g++; }
  return `${g}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″ ${v >= 0 ? pos : neg}`;
}

/* ------------------------------------------------------------------ utilidades SVG */
function el(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function camino(parent, cls, d, dibujable = true) {
  const a = { class: cls, d };
  if (dibujable) a.pathLength = '1';
  return el('path', a, parent);
}
const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ------------------------------------------------------------------ montaje */
const instancias = [];
let nInst = 0;

export function mountMapa(root, opts = {}) {
  if (!root || root.__mapa) return root?.__mapa;
  const tx = textos();
  const rm = () => opts.reducedMotion ?? reducido();

  // Enlaces y textos siempre al día con content.js (el HTML trae los mismos como respaldo sin JS)
  root.querySelectorAll('[data-mapa-url="map"]').forEach(a => { if (tx.mapUrl) a.href = tx.mapUrl; });
  root.querySelectorAll('[data-mapa-url="ruta"]').forEach(a => { if (tx.rutaUrl) a.href = tx.rutaUrl; });
  const lugarEl = root.querySelector('.mapa__lugar');
  if (lugarEl && tx.lugar) lugarEl.textContent = tx.lugar;
  const cuando = root.querySelector('.mapa__cuando');
  if (cuando) {
    cuando.innerHTML = '';
    const t = document.createElement('time');
    if (tx.iso) t.dateTime = tx.iso;
    t.innerHTML = '<span class="fecha"></span><span class="sep"> · </span><span class="hora"></span>';
    t.querySelector('.fecha').textContent = tx.fecha;
    t.querySelector('.hora').textContent = tx.hora;
    cuando.appendChild(t);
  }
  const mapA = root.querySelector('.mapa__map');
  const frame = root.querySelector('.mapa__frame');
  const info = root.querySelector('.mapa__info');
  if (!mapA || !frame) return null;
  if (mapA && tx.lugar && !mapA.getAttribute('aria-label')) mapA.setAttribute('aria-label', `Abrir en Google Maps la ubicación: ${tx.lugar}`);

  // ---------------------------------------------------------------- escenario (decorativo: aria-hidden)
  root.classList.add('is-on');
  const uid = ++nInst;                       // ids únicos de los degradados del pin (por si hubiera dos mapas)
  const stage = document.createElement('div');
  stage.className = 'mapa__stage';
  stage.setAttribute('aria-hidden', 'true');
  stage.innerHTML = `
    <div class="mapa__suelo"><img class="mapa__rel mapa__rel--valle" alt="" decoding="async" draggable="false"><img class="mapa__rel mapa__rel--pueblo" alt="" decoding="async" draggable="false"><svg class="mapa__svg" xmlns="${NS}"></svg><svg class="mapa__svg mapa__svg2" xmlns="${NS}"></svg></div>
    <div class="mapa__velo"></div>
    <div class="mapa__flota"><div class="mapa__nombres"></div>
      <div class="mapa__meta"><b></b><b></b><i></i></div>
      <div class="mapa__pin"><span class="mapa__pin-esc"><span class="mapa__pin-luz"></span><span class="mapa__pin-rayo"></span><span class="mapa__pin-halo"></span><span class="mapa__pin-ondas"><i></i><i></i><i></i></span><span class="mapa__pin-sombra"></span><span class="mapa__pin-golpe"></span><span class="mapa__pin-chispas"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
        <span class="mapa__pin-cuerpo"><svg viewBox="0 0 38 50"><defs>
          <linearGradient id="mapaPinOro${uid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff6dc"/><stop offset=".35" stop-color="#ecd09a"/><stop offset=".7" stop-color="#b98d55"/><stop offset="1" stop-color="#e8cc94"/></linearGradient>
          <radialGradient id="mapaPinTinta${uid}" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="#2a1d14"/><stop offset="1" stop-color="#120c09"/></radialGradient></defs>
          <path d="M19 49.2C19 49.2 3.2 32.6 3.2 19.1A15.8 15.8 0 1 1 34.8 19.1C34.8 32.6 19 49.2 19 49.2Z" fill="url(#mapaPinOro${uid})" stroke="#7a5a2e" stroke-width=".8"/>
          <path d="M19 47.2C19 47.2 5 31.6 5 19.1" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.1" stroke-linecap="round"/>
          <circle cx="19" cy="19" r="10.4" fill="url(#mapaPinTinta${uid})" stroke="#f6e3b4" stroke-width=".9"/>
          <circle cx="16.3" cy="19.6" r="4.3" fill="none" stroke="#e9cf98" stroke-width="1.35"/>
          <circle cx="21.7" cy="19.6" r="4.3" fill="none" stroke="#fff3d6" stroke-width="1.35"/>
          <path d="M16.3 13.7l1.3 1.5-1.3 1.3-1.3-1.3z" fill="#fff8ea"/>
        </svg></span></span></div>
    </div>
    <div class="mapa__brillo"></div>
    <div class="mapa__marco">${['tl', 'tr', 'br', 'bl'].map(c => `<svg class="mapa__esq mapa__esq--${c}" viewBox="0 0 40 40"><path class="mo" pathLength="1" d="M2 30V9.5Q2 2 9.5 2H30"/><path class="mo" pathLength="1" d="M7.5 19Q7.5 7.5 19 7.5"/><path class="md" d="M12.2 8.6l3.6 3.6-3.6 3.6-3.6-3.6z"/></svg>`).join('')}</div>
    <span class="mapa__chip mapa__coords"></span>
    <span class="mapa__chip mapa__brujula"><svg viewBox="-16 -18 32 34"><circle r="9.5" fill="rgba(14,10,8,.55)" stroke="rgba(246,227,180,.55)" stroke-width=".8"/><path d="M0-14.5 2.3-2.3 0 0-2.3-2.3Z" fill="#f6e3b4"/><path d="M0 14.5 2.3 2.3 0 0-2.3 2.3Z" fill="rgba(246,227,180,.4)"/><path d="M-14.5 0-2.3-2.3 0 0-2.3 2.3ZM14.5 0 2.3-2.3 0 0 2.3 2.3Z" fill="rgba(246,227,180,.55)"/><text y="-15.6" text-anchor="middle" font-size="7" font-weight="600" fill="#f6e3b4" font-family="Montserrat, sans-serif">N</text></svg></span>
    <span class="mapa__chip mapa__escala"><i></i><b></b></span>
    <span class="mapa__chip mapa__pista"><svg viewBox="0 0 12 12"><path d="M4.5 2.5h5v5M9.5 2.5 3 9"/></svg>Abrir en Google Maps</span>`;
  mapA.appendChild(stage);
  const $ = s => stage.querySelector(s);
  const suelo = $('.mapa__suelo'), flota = $('.mapa__flota'), brillo = $('.mapa__brillo');
  const relV = $('.mapa__rel--valle'), relP = $('.mapa__rel--pueblo');
  const svg = $('.mapa__svg'), svg2 = $('.mapa__svg2'), capaNom = $('.mapa__nombres'), meta = $('.mapa__meta'), pin = $('.mapa__pin');
  const escalaI = $('.mapa__escala i'), escalaB = $('.mapa__escala b');
  $('.mapa__coords').textContent = EVENT.geo ? `${gms(EVENT.geo.lat, 'N', 'S')} · ${gms(EVENT.geo.lng, 'E', 'O')}` : '';
  // la atribución y la tarjeta van por encima del mapa (hermanos del enlace: nunca dentro de él)

  // ---------------------------------------------------------------- estado
  const S = {
    D: null, W: 0, H: 0, var: 'd', listo: false, empezado: false, fin: false, t: 0, manual: false, raf: 0, last: 0,
    C1: null, C2: null, dibujos: [], fundidos: [], nombres: [], gV: null, gP: null, gR: null, chispas: [],
    escala: { v: null, p: null }, tilt: { x: 0, y: 0, tx: 0, ty: 0, raf: 0, on: false, g0: null }, visible: false, dispose: [],
  };

  // ---------------------------------------------------------------- cámara
  const encuadre = (caja, pad) => {
    const bw = caja[2] - caja[0], bh = caja[3] - caja[1];
    const k = Math.max(bw / Math.max(40, S.W - 2 * pad), bh / Math.max(40, S.H - 2 * pad));
    return { k, cx: (caja[0] + caja[2]) / 2, cy: (caja[1] + caja[3]) / 2 };
  };
  const aPantalla = (x, y, c) => [(x - c.cx) / c.k + S.W / 2, (y - c.cy) / c.k + S.H / 2];

  function camaras() {
    const D = S.D;
    const padV = Math.min(S.W, S.H) * 0.04;
    S.C1 = encuadre(D.valle.caja, padV);
    // pueblo: la caja (pin + ruta + Ahuayro) con margen, ampliada hacia arriba lo justo para que la tarjeta quepa ENCIMA del
    // pin (así no tapa la ruta). Dos pasadas: el margen en metros depende de la escala.
    // En pantallas bajas la caja es solo pin + ruta (sin el centro de Ahuayro) y la tarjeta es compacta.
    const bajo = S.H < 330 && D.pueblo.caja_ruta;
    info?.classList.toggle('is-compacta', S.H < 330 || S.W < 420);
    const base = bajo ? D.pueblo.caja_ruta : D.pueblo.caja;
    const pad = Math.min(S.W, S.H) * 0.05;
    const hInfo = (info?.offsetHeight || 62) + 86;
    const c0 = encuadre(base, pad);
    // si la tarjeta ya cabe encima o al lado del pin (pantallas anchas), no se aleja la cámara
    const lugar = infoSitio(c0);
    if (lugar && lugar.cls !== 'is-abajo') { S.C2 = c0; return; }
    let caja = base.slice(), c2 = c0;
    for (let i = 0; i < 4; i++) {
      const top = Math.min(base[1], 0 - (hInfo - pad) * c2.k);
      if (Math.abs(top - caja[1]) < 1) break;
      caja[1] = top;
      c2 = encuadre(caja, pad);
    }
    // sin alejar demasiado: si la tarjeta no cabe arriba con ≤ 1.5× de escala, va donde quepa (colocarInfo)
    if (c2.k > c0.k * 1.5) { caja = base.slice(); caja[1] = Math.min(base[1], base[3] - (base[3] - base[1]) * 1.5); c2 = encuadre(caja, pad); }
    S.C2 = c2;
  }
  function camaraEn(t) {
    const { C1, C2 } = S;
    if (t <= T.zoom[0]) {
      const a = eOut(clamp((t - T.asienta[0]) / (T.asienta[1] - T.asienta[0])));
      const d = sstep(T.deriva[0], T.deriva[1] + 0.6, t);
      return { k: C1.k * lerp(1.16, 1, a) * (1 - 0.035 * d), cx: C1.cx, cy: C1.cy };
    }
    const A = { k: C1.k * (1 - 0.035 * sstep(T.deriva[0], T.deriva[1] + 0.6, T.zoom[0])), cx: C1.cx, cy: C1.cy };
    const u = eInOut(clamp((t - T.zoom[0]) / (T.zoom[1] - T.zoom[0])));
    const k = Math.exp(lerp(Math.log(A.k), Math.log(C2.k), u));
    // el lugar (0,0) recorre la pantalla en línea recta mientras la escala cambia: la cámara "cae" sobre él
    const pa = aPantalla(0, 0, A), pb = aPantalla(0, 0, C2);
    const uu = eInOutS(clamp((t - T.zoom[0]) / (T.zoom[1] - T.zoom[0])));
    const px = lerp(pa[0], pb[0], uu), py = lerp(pa[1], pb[1], uu);
    const fin = sstep(T.zoom[1], T.fin + 0.4, t);
    const k2 = k * (1 + 0.025 * (1 - fin) * (t > T.zoom[1] ? 1 : 0));
    return { k: k2, cx: 0 - (px - S.W / 2) * k2, cy: 0 - (py - S.H / 2) * k2 };
  }

  function aplicarCamara(c) {
    const vw = S.W * c.k, vh = S.H * c.k;
    const vb = `${(c.cx - vw / 2).toFixed(2)} ${(c.cy - vh / 2).toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}`;
    // Solo cambia el viewBox. El grosor de los trazos (--k) NO se toca por cuadro (obligaría a recalcular todos los trazos:
    // ×8 más lento en móvil): cada etapa usa el de su propia escala (ver relayout) y durante el viaje los trazos del valle
    // engordan mientras se desvanecen y los del pueblo llegan finos, como al acercarse a un grabado.
    if (vb !== S.vb) {
      S.vb = vb;
      svg.setAttribute('viewBox', vb); svg2.setAttribute('viewBox', vb);
    }
    for (const [img, z] of [[relV, S.D.valle], [relP, S.D.pueblo]]) {
      if (img.__op === 0) continue;
      const iw = img.__w, ext = z.ext;
      const s = (ext[2] - ext[0]) / iw / c.k;
      const x = (ext[0] - (c.cx - vw / 2)) / c.k, y = (ext[1] - (c.cy - vh / 2)) / c.k;
      img.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${s.toFixed(5)})`;
    }
    S.cam = c;
  }

  // ---------------------------------------------------------------- construcción del SVG
  function construir() {
    const D = S.D;
    for (const sv of [svg, svg2]) { sv.setAttribute('width', S.W); sv.setAttribute('height', S.H); sv.innerHTML = ''; }
    S.vb = '';
    const dib = S.dibujos = [], fund = S.fundidos = [];
    S.chispas = [];
    const g = (cls, p = svg) => el('g', { class: cls }, p);
    const lin = (z, c) => z.lineas.filter(l => l.c === c);

    // ===== VALLE
    const gV = S.gV = g('g-valle');
    const vA = g('z-areas', gV), vF = g('z-finas', gV), vV = g('z-vias', gV), vRB = g('z-rio-b', gV), vRH = g('z-rio-h', gV),
      vR = g('z-rio', gV), vTH = g('z-tr-h', gV), vT = g('z-tr', gV), vC = g('z-chispas', gV);
    for (const a of D.valle.areas) camino(vA, 'a v-' + a.c, a.d, false);
    fund.push({ el: vA, a: 1.0, b: 2.0 });
    for (const c of ['quebrada', 'vecinal']) for (const l of lin(D.valle, c)) camino(vF, 'l is-full v-' + c, l.d);
    fund.push({ el: vF, a: 0.8, b: 2.3 });
    let i = 0;
    for (const c of ['terciaria', 'secundaria', 'primaria']) {
      for (const l of lin(D.valle, c)) {
        const p = camino(vV, 'l v-' + c, l.d);
        const s = c === 'terciaria' ? 1.05 + hash(i++) * 0.95 : 0.9 + Math.min(0.8, (i++ % 9) * 0.09);
        dib.push({ els: [p], s, d: clamp(l.l / 11000, 0.55, 1.4), e: eOut });
      }
    }
    const rios = lin(D.valle, 'rio').sort((a, b) => b.l - a.l);
    const main = rios.find(r => r.n === 'Río Pampas') || rios[0];
    rios.forEach((r, j) => {
      const esMain = r === main;
      const b = camino(vRB, 'l v-rio-b', r.d), h = camino(vRH, 'l v-rio-h', r.d), p = camino(vR, 'l v-rio' + (esMain ? ' is-main' : ''), r.d);
      const it = esMain ? { els: [b, h, p], s: 0.25, d: 2.1, e: eInOut } : { els: [b, h, p], s: 0.6 + j * 0.16, d: clamp(r.l / 9000, 0.8, 1.6), e: eOut };
      if (!esMain) b.classList.add('is-menor');
      if (esMain || r.l > 9000) it.chispa = chispa(vC, r.d);
      dib.push(it);
    });
    for (const l of lin(D.valle, 'troncal')) {
      const h = camino(vTH, 'l v-troncal-h', l.d), p = camino(vT, 'l v-troncal', l.d);
      const it = l.lado ? { els: [h, p], s: 0.72, d: 1.95, e: eInOut } : { els: [h, p], s: 1.25, d: 1.0, e: eOut };
      if (l.lado) it.chispa = chispa(vC, l.d);
      dib.push(it);
    }

    // ===== PUEBLO
    const gP = S.gP = g('g-pueblo');
    const pA = g('z-areas', gP), pF = g('z-finas', gP), pV = g('z-vias', gP), pE = g('z-edif', gP), pRB = g('z-rio-b', gP),
      pRH = g('z-rio-h', gP), pR = g('z-rio', gP), pTH = g('z-tr-h', gP), pT = g('z-tr', gP);
    for (const c of ['residencial', 'escuela', 'estadio']) for (const a of D.pueblo.areas.filter(a => a.c === c)) camino(pA, 'a p-' + c, a.d, false);
    fund.push({ el: pA, a: 4.55, b: 5.6 });
    for (const c of ['sendero', 'trocha']) for (const l of lin(D.pueblo, c)) camino(pF, 'l is-full p-' + c, l.d);
    fund.push({ el: pF, a: 4.75, b: 5.8 });
    const vias = [...lin(D.pueblo, 'calle'), ...lin(D.pueblo, 'via')].sort((a, b) => a.r - b.r);
    vias.forEach((l, j) => {
      const p = camino(pV, 'l p-' + l.c, l.d);
      dib.push({ els: [p], s: T.calles[0] + (j / Math.max(1, vias.length - 1)) * (T.calles[1] - T.calles[0] - 0.4), d: clamp(l.l / 1600, 0.45, 1.05), e: eOut });
    });
    const ed = D.pueblo.areas.filter(a => a.c === 'edificio');
    if (ed.length) { camino(pE, 'a p-edificio', ed.map(a => a.d).join(''), false); fund.push({ el: pE, a: 4.9, b: 5.9 }); }
    for (const r of lin(D.pueblo, 'rio')) {
      const m = r.n === 'Río Pampas' ? '' : ' is-menor';
      camino(pRB, 'l is-full p-rio-b' + m, r.d); camino(pRB, 'l is-full p-rio-b2' + m, r.d); camino(pRH, 'l is-full p-rio-h', r.d); camino(pR, 'l is-full p-rio', r.d);
    }
    for (const l of lin(D.pueblo, 'troncal')) { camino(pTH, 'l is-full p-troncal-h', l.d); camino(pT, 'l is-full p-troncal', l.d); }

    // ===== RUTA (de la PE-3S al lugar)
    const gR = S.gR = g('g-ruta');
    const rd = D.pueblo.ruta?.d;
    if (rd) {
      const h2 = camino(gR, 'l r-h2', rd), h = camino(gR, 'l r-h', rd), l = camino(gR, 'l r-l', rd);
      el('path', { class: 'r-ant', d: rd, pathLength: '100' }, svg2);      // en su propio SVG: en reposo solo se repinta él
      dib.push({ els: [h2, h, l], s: T.ruta[0], d: T.ruta[1] - T.ruta[0], e: eInOut, chispa: chispa(gR, rd) });
    }
    for (const it of dib) { it.last = -1; for (const e of it.els) e.style.visibility = 'hidden'; }
  }
  function chispa(parent, d) {
    const h = el('path', { class: 'chispa-h', d, pathLength: '1' }, parent);
    const p = el('path', { class: 'chispa', d, pathLength: '1' }, parent);
    S.chispas.push(h, p);
    return [h, p];
  }

  // ---------------------------------------------------------------- nombres (HTML) + colocación sin choques
  function crearNombres() {
    capaNom.innerHTML = '';
    const D = S.D, out = [];
    const mk = (z, o) => {
      const n = document.createElement('div');
      n.className = 'mapa__n mapa__n--' + o.cls;
      const sp = document.createElement('span');
      if (o.cls === 'rumbo') sp.innerHTML = '<i></i><b></b>';
      (sp.querySelector('b') || sp).textContent = o.t;
      n.appendChild(sp);
      capaNom.appendChild(n);
      out.push(Object.assign(o, { z, el: n, sp, on: false }));
    };
    const tipo = n => (n.k === 'city' ? 'ciudad' : n.k === 'town' ? 'pueblo' : n.k === 'village' ? 'villa' : 'caserio');
    // valle: pueblos con prioridad (Ahuayro con estilo propio: es el destino)
    for (const n of D.valle.nombres) {
      const cls = n.t === 'Ahuayro' ? 'meta' : tipo(n);
      if (cls === 'caserio') continue;
      mk('v', { t: n.t, x: n.x, y: n.y, cls, p: cls === 'meta' ? -10 : n.p });
    }
    for (const r of (D.valle.rotulos || []).slice(0, 3)) mk('v', { t: r.t, cands: r.c, cls: 'rio', p: r.t === 'Río Pampas' ? -5 : 2.5 });
    for (const r of D.valle.rumbos || []) mk('v', { t: r.t, lado: r.lado, cls: 'rumbo', p: -8 });
    if (D.valle.troncal) mk('v', { t: D.valle.troncal.ref, cls: 'ref', p: -3, tr: 'v' });
    // pueblo
    for (const n of D.pueblo.nombres) mk('p', { t: n.t, x: n.x, y: n.y, cls: n.t === 'Ahuayro' ? 'pueblo' : (n.k === 'village' ? 'villa' : 'caserio'), p: n.t === 'Ahuayro' ? -6 : n.p });
    for (const a of D.pueblo.areas.filter(a => a.c === 'estadio' && a.n)) mk('p', { t: a.n, x: a.cx, y: a.cy, cls: 'hito', p: 1.5, dy: 14 });
    for (const r of (D.pueblo.rotulos || []).slice(0, 2)) mk('p', { t: r.t, cands: r.c, cls: 'rio', p: r.t === 'Río Pampas' ? -4 : 0.5 });
    if (D.pueblo.troncal) mk('p', { t: D.pueblo.troncal.ref, cls: 'ref', p: -2, tr: 'p' });
    S.nombres = out;
  }

  function medir() { for (const n of S.nombres) { n.w = n.sp.offsetWidth; n.h = n.sp.offsetHeight; } }

  function colocar() {
    const W = S.W, H = S.H, M = 8;
    const choca = (b, arr) => arr.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const reservas = () => {
      const r = [{ x0: W - 52, y0: 0, x1: W, y1: 48 },                                   // brújula
        { x0: 0, y0: H - 30, x1: 150, y1: H },                                           // escala
        { x0: W - Math.min(W * 0.62, 300), y0: H - 28, x1: W, y1: H }];                   // atribución
      const co = $('.mapa__coords');
      if (co && co.offsetWidth) r.push({ x0: 0, y0: 0, x1: co.offsetLeft + co.offsetWidth + 6, y1: co.offsetTop + co.offsetHeight + 6 });   // coordenadas
      return r;
    };
    // tramo de la troncal: punto a cierta distancia del lugar, a lo largo de la cadena
    const trPunto = (pts, desde, dist) => {
      let best = 0, bd = 1e18;
      pts.forEach((p, i) => { const d = Math.hypot(p[0] - desde[0], p[1] - desde[1]); if (d < bd) { bd = d; best = i; } });
      const out = [];
      for (const dir of [-1, 1]) {
        let acc = 0;
        for (let i = best; i + dir >= 0 && i + dir < pts.length; i += dir) {
          const a = pts[i], b = pts[i + dir];
          const s = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (acc + s >= dist) { const u = (dist - acc) / s; out.push([lerp(a[0], b[0], u), lerp(a[1], b[1], u)]); break; }
          acc += s;
        }
      }
      return out;
    };
    for (const z of ['v', 'p']) {
      const cam = z === 'v' ? S.C1 : S.C2;
      const ocup = reservas();
      // el destino: objetivo (valle) o pin + tarjeta (pueblo)
      const [mx, my] = aPantalla(0, 0, cam);
      if (z === 'v') ocup.push({ x0: mx - 14, y0: my - 14, x1: mx + 14, y1: my + 14 });
      else {
        ocup.push({ x0: mx - 24, y0: my - 58, x1: mx + 24, y1: my + 12 });
        if (S.infoBox) ocup.push(S.infoBox);
      }
      const lista = S.nombres.filter(n => n.z === z).sort((a, b) => a.p - b.p);
      let cuenta = 0;
      const max = z === 'v' ? Math.round(clamp(W * H / 34000, 4, 10)) : Math.round(clamp(W * H / 34000, 3, 8));
      for (const n of lista) {
        n.on = false;
        let x, y, ang = 0;
        if (n.cls === 'rumbo') {
          const tr = S.D.valle.troncal?.p; if (!tr) continue;
          const [ix, iy] = [0, 0];
          let bi = 0, bd = 1e18;
          tr.forEach((p, i) => { const d = Math.hypot(p[0] - ix, p[1] - iy); if (d < bd) { bd = d; bi = i; } });
          const dir = n.lado === 'o' ? -1 : 1;
          const ins = 30;
          let pIn = null, pOut = null;
          for (let i = bi; i >= 0 && i < tr.length; i += dir) {
            const s = aPantalla(tr[i][0], tr[i][1], cam);
            if (s[0] < ins || s[0] > W - ins || s[1] < ins || s[1] > H - ins) { pOut = s; break; }
            pIn = s;
          }
          if (!pIn || !pOut) continue;
          // la píldora va dentro del mapa, junto al borde por donde sale la carretera; si ahí choca con algo
          // (atribución, escala…), se corre hacia dentro siguiendo la carretera
          const dx = pOut[0] - pIn[0], dy = pOut[1] - pIn[1];
          ang = Math.atan2(dy, dx) * 180 / Math.PI;
          const hw = n.w / 2 + 6, hh = n.h / 2 + 4;
          const pts = [];
          for (let i = bi; i >= 0 && i < tr.length; i += dir) pts.push(aPantalla(tr[i][0], tr[i][1], cam));
          const salida = pts.findIndex(s => s[0] < ins || s[0] > W - ins || s[1] < ins || s[1] > H - ins);
          let puesto = false;
          for (let j = salida - 1; j >= Math.max(0, salida * 0.45); j--) {
            let [qx, qy] = pts[j];
            qx = clamp(qx - Math.sign(dx) * (Math.abs(dx) > Math.abs(dy) ? hw - 8 : 0), hw + 8, W - hw - 8);
            qy = clamp(qy - Math.sign(dy) * (Math.abs(dy) >= Math.abs(dx) ? hh - 4 : 0), hh + 8, H - hh - 8);
            const b = { x0: qx - hw, y0: qy - hh, x1: qx + hw, y1: qy + hh };
            if (choca(b, ocup)) continue;
            x = qx; y = qy; puesto = true; break;
          }
          if (!puesto) continue;
          n.sp.style.setProperty('--a', ang.toFixed(1) + 'deg');
          n.wx = null; n.sx = x; n.sy = y;
        } else if (n.cls === 'rio') {
          // el nombre del río va a lo largo de un tramo recto que se vea entero (si no cabe en ninguno, no se pone)
          for (const a of n.cands || []) {
            if (n.w > (a.l / cam.k) * 1.1) continue;
            const s = aPantalla(a.x, a.y, cam);
            const r = a.ang * Math.PI / 180;
            const bw = Math.abs(n.w * Math.cos(r)) + Math.abs(n.h * Math.sin(r)), bh = Math.abs(n.w * Math.sin(r)) + Math.abs(n.h * Math.cos(r));
            const b = { x0: s[0] - bw / 2 - 3, y0: s[1] - bh / 2 - 3, x1: s[0] + bw / 2 + 3, y1: s[1] + bh / 2 + 3 };
            if (b.x0 < M || b.y0 < M || b.x1 > W - M || b.y1 > H - M || choca(b, ocup)) continue;
            n.ang = a.ang; n.wx = a.x; n.wy = a.y; ocup.push(b); n.on = true; break;
          }
          continue;
        } else if (n.cls === 'ref') {
          const z2 = n.tr === 'v' ? S.D.valle : S.D.pueblo;
          const dists = n.tr === 'v' ? [6500, 10500, 4200, 14000] : [700, 1100, 450, 1500];
          const desde = n.tr === 'v' ? [0, 0] : (S.D.pueblo.ruta?.cruce || [0, 0]);
          let hecho = false;
          for (const dd of dists) {
            for (const q of trPunto(z2.troncal.p, desde, dd)) {
              const s = aPantalla(q[0], q[1], cam);
              const b = { x0: s[0] - n.w / 2 - 3, y0: s[1] - n.h / 2 - 3, x1: s[0] + n.w / 2 + 3, y1: s[1] + n.h / 2 + 3 };
              if (b.x0 < M || b.y0 < M || b.x1 > W - M || b.y1 > H - M || choca(b, ocup)) continue;
              n.wx = q[0]; n.wy = q[1]; ocup.push(b); n.on = true; hecho = true; break;
            }
            if (hecho) break;
          }
          continue;
        } else {
          // nombre de lugar: centrado en su punto; si no cabe, un renglón arriba o abajo del punto
          if (cuenta >= max && n.cls !== 'meta') continue;
          const [px, py] = aPantalla(n.x, n.y, cam);
          for (const off of [0, -(n.h * 0.95), n.h * 0.95]) {
            const yy = py + (n.dy || 0) + off;
            const b = { x0: px - n.w / 2 - 4, y0: yy - n.h / 2 - 3, x1: px + n.w / 2 + 4, y1: yy + n.h / 2 + 3 };
            if (b.x0 < M || b.y0 < M || b.x1 > W - M || b.y1 > H - M || choca(b, ocup)) continue;
            n.wx = n.x; n.wy = n.y + ((n.dy || 0) + off) * cam.k;
            ocup.push(b); n.on = true;
            if (n.cls !== 'meta') cuenta++;
            break;
          }
          continue;
        }
        const b = { x0: x - n.w / 2 - 4, y0: y - n.h / 2 - 3, x1: x + n.w / 2 + 4, y1: y + n.h / 2 + 3 };
        if (b.x0 < M || b.y0 < M || b.x1 > W - M || b.y1 > H - M) continue;
        if (choca(b, ocup)) continue;
        ocup.push(b); n.on = true;
      }
    }
  }

  function moverNombres(c, soloVisibles = true) {
    for (const n of S.nombres) {
      if (!n.on || (soloVisibles && !n.vis)) continue;
      let x, y;
      if (n.wx == null) { x = n.sx; y = n.sy; } else [x, y] = aPantalla(n.wx, n.wy, c);
      n.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)${n.ang ? ` rotate(${n.ang}deg)` : ''}`;
    }
    const [mx, my] = aPantalla(0, 0, c);
    const tr = `translate3d(${mx.toFixed(1)}px,${my.toFixed(1)}px,0)`;
    meta.style.transform = tr; pin.style.transform = tr;
  }

  // tarjeta de lugar/fecha/hora: encima del pin; si no cabe, a su derecha o izquierda (pantallas anchas); si no, debajo
  function infoSitio(cam) {
    if (!info) return null;
    const W = S.W, H = S.H, M = 10;
    info.classList.remove('is-2l');
    let w = info.offsetWidth, h = info.offsetHeight;
    if (w > W - 2 * M) { info.classList.add('is-2l'); w = info.offsetWidth; h = info.offsetHeight; }
    const [px, py] = aPantalla(0, 0, cam);
    const alto = 58 * (parseFloat(getComputedStyle(root).getPropertyValue('--pin-s')) || 1);
    const yc = py - alto * 0.55 - h / 2;
    const cand = [
      { x: clamp(px - w / 2, M, W - w - M), y: py - alto - 12 - h, cls: '' },
      { x: px + 30, y: yc, cls: 'is-der' },
      { x: px - 30 - w, y: yc, cls: 'is-izq' },
      { x: clamp(px - w / 2, M, W - w - M), y: py + 22, cls: 'is-abajo' },
    ];
    const ok = c => c.x >= M && c.x + w <= W - M && c.y >= M && c.y + h <= H - 30;
    const c = cand.find(ok) || { ...cand[3], y: clamp(cand[3].y, M, H - h - M) };
    return { ...c, w, h, px, py, alto };
  }
  function colocarInfo() {
    if (!info) return;
    const c = infoSitio(S.C2);
    const { x, y, w, h, px, py, alto } = c;
    info.classList.remove('is-abajo', 'is-der', 'is-izq');
    if (c.cls) info.classList.add(c.cls);
    // el escenario está dentro del enlace; la tarjeta es hermana del enlace dentro de .mapa__frame (mismo origen)
    const ox = mapA.offsetLeft, oy = mapA.offsetTop;
    info.style.left = (ox + x).toFixed(1) + 'px';
    info.style.top = (oy + y).toFixed(1) + 'px';
    info.style.setProperty('--ax', clamp(px - (x + w / 2), -w / 2 + 16, w / 2 - 16).toFixed(1) + 'px');
    info.style.setProperty('--ay', clamp(py - alto * 0.55 - (y + h / 2), -h / 2 + 12, h / 2 - 12).toFixed(1) + 'px');
    S.infoBox = { x0: x - 4, y0: y - 4, x1: x + w + 4, y1: y + h + 4 };
    const co = $('.mapa__coords'), br = $('.mapa__brujula');
    const tapa = e => e && e.offsetWidth && x < e.offsetLeft + e.offsetWidth + 6 && x + w > e.offsetLeft - 6 && y < e.offsetTop + e.offsetHeight + 6 && y + h > e.offsetTop - 6;
    root.classList.toggle('is-tapa-coords', !!tapa(co));
    root.classList.toggle('is-tapa-brujula', !!tapa(br));
    // UNIR: la pista «Abrir en Google Maps» (al pasar el ratón) quedaba medio tapada por la tarjeta en 1440×900
    root.classList.toggle('is-tapa-pista', !!tapa($('.mapa__pista')));
  }

  // escala gráfica (valor redondo ≈ 70–110 px)
  function escala(k) {
    const m = k * 90;
    const pasos = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];
    const d = pasos.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
    return { px: d / k, txt: d >= 1000 ? `${d / 1000} km` : `${d} m` };
  }
  let escalaActual = '';
  function ponerEscala(e) {
    if (escalaActual === e.txt) return;
    escalaActual = e.txt;
    escalaI.style.setProperty('--w', e.px.toFixed(1) + 'px');
    escalaB.textContent = e.txt;
  }

  // ---------------------------------------------------------------- render de un instante
  function render(t) {
    S.t = t;
    const c = camaraEn(t);
    // relieves
    const oV = sstep(T.relieve[0], T.relieve[1], t) * (1 - sstep(T.relValleFuera[0], T.relValleFuera[1], t));
    const oP = sstep(T.relPueblo[0], T.relPueblo[1], t);
    for (const [img, o] of [[relV, oV], [relP, oP]]) {
      const v = +o.toFixed(3);
      if (img.__op !== v) { img.__op = v; img.style.opacity = v; img.style.visibility = v > 0 ? 'visible' : 'hidden'; }
    }
    aplicarCamara(c);
    // grupos
    const gv = 1 - sstep(T.valleFuera[0], T.valleFuera[1], t), gp = sstep(T.pueblo[0], T.pueblo[1], t), gr = t >= T.ruta[0] - 0.05 ? 1 : 0;
    setOp(S.gV, gv); setOp(S.gP, gp); setOp(S.gR, gr);
    for (const f of S.fundidos) setOp(f.el, sstep(f.a, f.b, t));
    // trazos
    for (const it of S.dibujos) {
      const p = it.e(clamp((t - it.s) / it.d));
      if (p === it.last) continue;
      it.last = p;
      for (const e of it.els) { e.style.visibility = p > 0 ? 'visible' : 'hidden'; e.style.strokeDashoffset = (1 - p).toFixed(4); }
      if (it.chispa) {
        const vis = p > 0.002 && p < 0.998;
        for (const e of it.chispa) { e.style.opacity = vis ? (e.classList.contains('chispa') ? 1 : 0.9) : 0; if (vis) e.style.strokeDashoffset = (-p).toFixed(4); }
      }
    }
    // nombres
    for (const n of S.nombres) {
      let vis = false;
      if (n.on) {
        if (n.z === 'v') {
          const i0 = n.cls === 'rumbo' ? 2.0 : n.cls === 'ref' ? 2.25 : n.cls === 'rio' ? 2.05 : n.cls === 'meta' ? 2.5 : T.nomValle + (n.rank || 0) * 0.09;
          vis = t >= i0 && t < T.nomValleFuera;
        } else vis = t >= T.nomPueblo + (n.rank || 0) * 0.1;
      }
      if (vis !== n.vis) { n.vis = vis; n.el.classList.toggle('is-v', vis); }
    }
    moverNombres(c);
    // objetivo, pin, tarjeta, escala
    root.classList.toggle('is-meta', t >= T.meta && t < T.metaFuera[1]);
    meta.style.opacity = (sstep(T.meta, T.meta + 0.35, t) * (1 - sstep(T.metaFuera[0], T.metaFuera[1], t))).toFixed(3);
    root.classList.toggle('is-rayo', t >= T.rayo);
    root.classList.toggle('is-pin', t >= T.pin);
    root.classList.toggle('is-info', t >= T.info);
    root.classList.toggle('is-idle', t >= T.idle);
    ponerEscala(escala(t < (T.zoom[0] + T.zoom[1]) / 2 ? S.C1.k : S.C2.k));
  }
  function setOp(g, o) {
    if (!g) return;
    const v = +o.toFixed(3);
    if (g.__op === v) return;
    g.__op = v;
    g.setAttribute('opacity', v);
    g.style.display = v <= 0 ? 'none' : '';
  }
  function rango() {
    // orden de aparición de los nombres por prioridad
    for (const z of ['v', 'p']) S.nombres.filter(n => n.z === z && n.on).sort((a, b) => a.p - b.p).forEach((n, i) => { n.rank = i; });
  }

  // ---------------------------------------------------------------- reloj
  function bucle(now) {
    S.raf = 0;
    if (S.manual) return;
    const dt = Math.min(0.1, Math.max(0, (now - (S.last || now)) / 1000));   // tope: al volver de otra pestaña no salta
    S.last = now;
    const t = Math.min(T.fin, S.t + dt);
    render(t);
    if (t >= T.fin) return terminar();
    S.raf = requestAnimationFrame(bucle);
  }
  function terminar() {
    S.fin = true;
    root.classList.remove('is-anim');
    relV.style.willChange = relP.style.willChange = 'auto';
    for (const e of S.chispas) e.style.opacity = 0;
    // trazos terminados: sin guiones (dibujo exacto, sin costuras)
    for (const it of S.dibujos) if (it.last >= 1) for (const e of it.els) e.classList.add('is-full');
  }
  function play() {
    if (!S.listo) return;
    S.manual = false;
    if (S.t >= T.fin) { render(T.fin); terminar(); return; }
    root.classList.add('is-anim', 'is-run');
    S.last = 0;
    if (!S.raf) S.raf = requestAnimationFrame(bucle);
  }
  function seek(t) {
    if (!S.listo) return;
    S.manual = true;
    if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; }
    root.classList.add('is-run');
    for (const it of S.dibujos) { it.last = -1; for (const e of it.els) e.classList.remove('is-full'); }
    render(clamp(t, 0, T.fin));
    if (t >= T.fin) terminar();
  }

  // ---------------------------------------------------------------- inclinación 3D (ratón / giroscopio)
  function tiltLoop() {
    const k = S.tilt;
    k.raf = 0;
    k.x += (k.tx - k.x) * 0.085; k.y += (k.ty - k.y) * 0.085;
    const quieto = Math.abs(k.tx - k.x) < 0.0015 && Math.abs(k.ty - k.y) < 0.0015;
    if (quieto) { k.x = k.tx; k.y = k.ty; }
    frame.style.transform = `perspective(1100px) rotateX(${(-k.y * 4.2).toFixed(3)}deg) rotateY(${(k.x * 6).toFixed(3)}deg)`;
    suelo.style.transform = `translate3d(${(-k.x * 6).toFixed(2)}px,${(-k.y * 5).toFixed(2)}px,0)`;
    flota.style.transform = `translate3d(${(k.x * 7).toFixed(2)}px,${(k.y * 6).toFixed(2)}px,0)`;
    brillo.style.transform = `translate3d(${(k.x * 18).toFixed(2)}%,${(k.y * 10).toFixed(2)}%,0)`;
    if (info) info.style.transform = `translate3d(${(k.x * 9).toFixed(2)}px,${(k.y * 8).toFixed(2)}px,0)`;
    const activo = Math.abs(k.x) + Math.abs(k.y) > 0.01;
    if (activo !== k.on) { k.on = activo; root.classList.toggle('is-tilt', activo); }
    if (!quieto && S.visible) k.raf = requestAnimationFrame(tiltLoop);
  }
  const tiltA = (x, y) => { const k = S.tilt; k.tx = clamp(x, -1, 1); k.ty = clamp(y, -1, 1); if (!k.raf && S.visible) k.raf = requestAnimationFrame(tiltLoop); };
  function initTilt() {
    if (rm()) return;
    if (FINE) {
      const onMove = e => {
        if (!S.visible) return;
        const r = frame.getBoundingClientRect();
        const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        const f = clamp(1.6 - Math.max(Math.abs(nx), Math.abs(ny)) * 0.6, 0, 1);      // se apaga lejos de la tarjeta
        tiltA(nx * f, ny * f);
      };
      const onLeave = () => tiltA(0, 0);
      addEventListener('pointermove', onMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
      S.dispose.push(() => { removeEventListener('pointermove', onMove); document.documentElement.removeEventListener('pointerleave', onLeave); });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      // Sin pedir permiso (iOS lo exige con un gesto, y el toque del mapa abre Google Maps): si el sitio ya lo concedió, se usa.
      const onOri = e => {
        if (!S.visible || e.beta == null || e.gamma == null) return;
        const k = S.tilt;
        if (!k.g0) k.g0 = { b: e.beta, g: e.gamma };
        k.g0.b += (e.beta - k.g0.b) * 0.004; k.g0.g += (e.gamma - k.g0.g) * 0.004;   // la referencia sigue despacio la postura
        tiltA((e.gamma - k.g0.g) / 22, (e.beta - k.g0.b) / 22);
      };
      addEventListener('deviceorientation', onOri, { passive: true });
      S.dispose.push(() => removeEventListener('deviceorientation', onOri));
    }
  }

  // ---------------------------------------------------------------- tamaño
  function medirEscenario() {
    const W = Math.round(mapA.clientWidth), H = Math.round(mapA.clientHeight);
    if (W < 40 || H < 40) return false;
    const cambio = W !== S.W || H !== S.H;
    S.W = W; S.H = H;
    return cambio;
  }
  function relayout() {
    if (!S.D) return;
    camaras();
    svg.setAttribute('width', S.W); svg.setAttribute('height', S.H);
    colocarInfo();
    camaras();                     // la tarjeta ya medida decide cuánto bajar el pin
    colocarInfo();
    medir(); colocar(); rango();
    // grosor de trazo de cada etapa (m por px de su cámara)
    S.gV?.style.setProperty('--k', S.C1.k.toFixed(4));
    for (const g of [S.gP, S.gR, svg2]) g?.style.setProperty('--k', S.C2.k.toFixed(4));
    if (S.raf || S.manual || S.empezado) render(S.t);
  }

  // ---------------------------------------------------------------- carga
  let cargaP = null;
  function cargar() {
    return (cargaP ||= (async () => {
      const D = await datos();
      S.D = D;
      medirEscenario();
      S.var = S.W < 560 ? 'm' : 'd';
      const pon = (img, z) => {
        img.__w = z.img[S.var + '_px'][0];
        img.style.width = z.img[S.var + '_px'][0] + 'px';
        img.style.height = z.img[S.var + '_px'][1] + 'px';
        img.src = new URL(z.img[S.var], BASE).href;
        img.__op = -1;
        return img.decode ? img.decode().catch(() => {}) : new Promise(r => { img.onload = img.onerror = r; });
      };
      await Promise.all([pon(relV, D.valle), pon(relP, D.pueblo)]);
      construir();
      crearNombres();
      if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
      S.listo = true;
      relayout();
      render(0);
      root.classList.add('is-ready');
    })().catch(e => {
      console.warn('[mapa] sin mapa (queda el enlace a Google Maps):', e?.message || e);
      root.classList.add('is-error');
      throw e;
    }));
  }

  // ---------------------------------------------------------------- visibilidad real (también la opacidad de los contenedores)
  const opacidadEfectiva = () => {
    let o = 1;
    for (let n = root; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity) || 0;
      if (o < 0.05) return 0;
    }
    return o;
  };
  const enVista = () => {
    const r = mapA.getBoundingClientRect();
    const vis = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / Math.max(1, r.height);
    return vis >= 0.42 && document.visibilityState !== 'hidden';
  };
  let sondeo = 0;
  function intentar() {
    if (S.empezado || !S.listo || opts.autoplay === false || QS.has('mapa-pausa')) return;
    if (!enVista() || opacidadEfectiva() < 0.7) return;
    S.empezado = true;
    clearInterval(sondeo); sondeo = 0;
    if (rm()) { root.classList.add('is-rm', 'is-run'); S.t = T.fin; render(T.fin); terminar(); return; }
    play();
  }
  const ioCerca = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { ioCerca.disconnect(); cargar().then(intentar, () => {}); }
  }, { rootMargin: '900px 0px' });
  ioCerca.observe(root);
  const ioVista = new IntersectionObserver(es => {
    const e = es[es.length - 1];
    S.visible = e.isIntersecting;
    root.classList.toggle('is-visible', e.isIntersecting);
    if (e.isIntersecting && !S.empezado) {
      intentar();
      if (!S.empezado && !sondeo) sondeo = setInterval(intentar, 160);
    } else if (!e.isIntersecting) { clearInterval(sondeo); sondeo = 0; }
    if (!e.isIntersecting && S.tilt.raf) { cancelAnimationFrame(S.tilt.raf); S.tilt.raf = 0; }
  }, { threshold: [0, 0.2, 0.45, 0.7] });
  ioVista.observe(mapA);

  let rsT = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    clearTimeout(rsT);
    rsT = setTimeout(() => { if (medirEscenario() && S.listo) relayout(); }, 60);
  }) : null;
  ro?.observe(mapA);
  initTilt();
  if (rm()) root.classList.add('is-rm');

  const api = {
    root,
    get listo() { return cargar().then(() => api); },
    get t() { return S.t; },
    duracion: T.fin,
    tiempos: T,
    seek, play, pausar() { S.manual = true; if (S.raf) cancelAnimationFrame(S.raf); S.raf = 0; },
    replay() { if (!S.listo) return; S.fin = false; S.t = 0; S.empezado = true; seek(0); S.manual = false; play(); },
    estado: () => ({ t: +S.t.toFixed(3), fin: S.fin, empezado: S.empezado, W: S.W, H: S.H, variante: S.var,
      C1: S.C1 && { k: +S.C1.k.toFixed(2) }, C2: S.C2 && { k: +S.C2.k.toFixed(2) },
      nombres: S.nombres.filter(n => n.on).map(n => `${n.z}:${n.t}`), visible: S.visible }),
    dispose() {
      ioCerca.disconnect(); ioVista.disconnect(); ro?.disconnect(); clearInterval(sondeo);
      if (S.raf) cancelAnimationFrame(S.raf);
      if (S.tilt.raf) cancelAnimationFrame(S.tilt.raf);
      S.dispose.forEach(f => f());
      stage.remove();
      root.classList.remove('is-on', 'is-ready', 'is-run', 'is-anim', 'is-meta', 'is-rayo', 'is-pin', 'is-info', 'is-idle', 'is-tilt', 'is-rm', 'is-visible', 'is-error', 'is-tapa-coords', 'is-tapa-brujula', 'is-tapa-pista');
      if (info) { info.removeAttribute('style'); info.classList.remove('is-abajo', 'is-der', 'is-izq', 'is-2l', 'is-compacta'); }
      frame.removeAttribute('style');
      delete root.__mapa;
      const i = instancias.indexOf(api); if (i >= 0) instancias.splice(i, 1);
    },
  };
  root.__mapa = api;
  instancias.push(api);
  return api;
}

/* ------------------------------------------------------------------ auto-montaje y ganchos de prueba */
function montarTodo() { document.querySelectorAll('[data-mapa]').forEach(n => { try { mountMapa(n); } catch (e) { console.warn('[mapa]', e); } }); }
const gancho = { instancias, montar: mountMapa };
window.__mapa = gancho;
try { if (window.__inv && typeof window.__inv === 'object') window.__inv.mapa = gancho; } catch { /* sin ganchos */ }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montarTodo, { once: true });
else montarTodo();
// main.js puede crear window.__inv después: se engancha al cargar la página
addEventListener('load', () => { try { if (window.__inv && typeof window.__inv === 'object') window.__inv.mapa = gancho; } catch {} }, { once: true });
