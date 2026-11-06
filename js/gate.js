// GATE · puerta de entrada CREMA con el lazo de satén renderizado en Blender (Cycles).
//
//   export async function mountGate(gateEl, { onOpen(withMusic), onOpened(), onReveal?(), progressSource?, reducedMotion?,
//                                             assets?, sfx?, maxWait?, timeScale?, masksAfter?() })
//     → { setProgress(p), open(withMusic?), skip(), dispose(), readonly ready, readonly opened, readonly opening,
//         readonly mode ('gl'|'img'|'svg'), readonly progress, fps, meta(), timing, debug }
//
// · Toma el control de #gate (reemplaza su contenido y su clase por .cgate) — css/gate.css se inyecta si falta.
// · El lazo es un video con alfa apilado (mitad superior = color sin premultiplicar, mitad inferior = alfa; ver
//   assets/video/lazo_meta.json) que se compone en UN canvas WebGL: color × alfa premultiplicado; en los bordes el color
//   sale de los vecinos opacos (sin el filo oscuro de la compresión 4:2:0), en el interior el texel central + enfoque
//   suave (nítido); resolución del canvas hasta la nativa del video en pantallas densas. Reposo en loop → al tocar,
//   fundido de ~3 frames al desatado. La cinta se prolonga con CSS hasta los bordes de la pantalla (tira de 1 px tomada
//   del propio video) y, cuando el nudo se abre, se deshace en polvo de oro desde el lazo hacia afuera.
// · Destellos dorados (canvas 2D) que nacen de los píxeles del lazo que se disuelve. PERF: con WebGL2 la máscara de cada
//   instante se lee en la GPU de forma asíncrona (pase 72×72 + PIXEL_PACK_BUFFER + fenceSync, sin bloquear el hilo) y no
//   se precalcula nada; con WebGL1 se precalculan en tiempo ocioso durante el reposo, pero solo cuando se resuelve
//   opts.masksAfter() (Promise; main.js: el montaje del pergamino 3D), para no competir con él en la puerta.
// · onOpen(withMusic) se llama SINCRÓNICAMENTE dentro del clic/tap (ahí se arranca la canción: song.start()).
//   onReveal() cuando las solapas van por la mitad (~0.8–0.9 s): la llegada de los anillos (rings.intro()) queda a la vista.
//   onOpened() cuando el envoltorio terminó de abrirse (la puerta ya no bloquea; sus últimos destellos se apagan solos).
// · Sin WebGL / sin video: póster PNG + desatado CSS; y si tampoco hay póster, un lazo SVG.
// · prefers-reduced-motion: póster estático y fundido simple.
import { COUPLE, EVENT } from './content.js';

const rel = p => new URL(p, import.meta.url).href;
import { device } from './device.js?v=20261105a';
import { createRibbonLite } from './ribbon-lite.js?v=20261105a';
import { botanicalSpines, floraCorner, floraFall, floraReady, splitFlora } from './botanical.js?v=20261105a';

export const GATE_ASSETS = {
  reposo: rel('../assets/video/lazo_reposo_alpha.mp4'),
  abrir: rel('../assets/video/lazo_abrir_alpha.mp4'),
  poster: rel('../assets/video/lazo_poster.png'),
  meta: rel('../assets/video/lazo_meta.json'),
  css: rel('../css/gate.css'),
};
const META_DEFAULT = { fps: 30, width: 960, height: 960, frames: 84, layout: 'stacked-alpha-top-color', pullStart: .5, knotGone: 1.5, dissolveStart: 1.9, end: 2.8 };
const TEXT = {
  kicker: EVENT.title, a: COUPLE.a, b: COUPLE.b, date: EVENT.dateLong,
  hint: 'Toca el lazo para abrir', skip: 'Entrar sin música', bow: 'Desatar el lazo y abrir la invitación',
};

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const now = () => performance.now();
function rng(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Arte vectorial (ondas chocolate, papel recortado, hilos de oro, flores marfil, ramitas)
   ═══════════════════════════════════════════════════════════════════════════ */
// The botanical frame is shared with the lightweight mobile renderer.
const THREAD_D = 'M3 14C34 14 52 9 76 11C92 12.4 98 19 106 18.6C114 18.2 116 9 109 7.2C101 5.3 95 13 101 17C108 21 122 15 138 13C160 10.6 184 13.6 237 13';

function column(kind, T) {
  const ui = kind === 'ui';
  const top = `<div class="cg-top"${ui ? ' aria-hidden="true"' : ''}>
      <p class="cg-kicker">${esc(T.kicker)}</p>
      <p class="cg-names"><span>${esc(T.a)}</span> <span class="cg-amp">&amp;</span> <span>${esc(T.b)}</span></p>
      <p class="cg-date">${esc(T.date)}</p>
    </div>`;
  const thread = ui
    ? `<div class="cg-thread" role="progressbar" aria-label="Cargando la invitación" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <svg viewBox="0 0 240 26" aria-hidden="true" focusable="false">
          <defs><linearGradient id="cg-thread-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="240" y2="0">
            <stop offset="0" stop-color="#8a6430"/><stop offset=".3" stop-color="#d9b874"/><stop offset=".5" stop-color="#f3e0ad"/>
            <stop offset=".7" stop-color="#c39b55"/><stop offset="1" stop-color="#8a6430"/></linearGradient>
            <radialGradient id="cg-bead-g"><stop offset="0" stop-color="#fffaf0"/><stop offset=".4" stop-color="#f0d596" stop-opacity=".9"/><stop offset="1" stop-color="#c49a52" stop-opacity="0"/></radialGradient></defs>
          <path class="cg-thread__track" d="${THREAD_D}"/>
          <path class="cg-thread__prog" d="${THREAD_D}" pathLength="1"/>
          <g class="cg-thread__bead" transform="translate(3 14)"><circle r="6" fill="url(#cg-bead-g)"/><circle r="1.6" fill="#fffdf5"/></g>
        </svg></div>`
    : '<div class="cg-thread"></div>';
  const bow = ui
    ? `<button class="cg-bow" type="button" aria-label="${esc(T.bow)}" aria-disabled="true">
          <span class="cg-bow__lift"><span class="cg-bow__glow"></span><i class="cg-band cg-band--l"></i><i class="cg-band cg-band--r"></i><span class="cg-bow__pulse"></span><canvas class="cg-bow__canvas"></canvas></span>
        </button>`
    : '';
  const hint = `<p class="cg-hint"${ui ? '' : ' aria-hidden="true"'}><span class="cg-hint__in">${esc(T.hint)}</span></p>`;
  const skip = ui ? `<button class="cg-skip" type="button" aria-disabled="true">${esc(T.skip)}</button>` : `<span class="cg-skip">${esc(T.skip)}</span>`;
  return `<div class="cg-col"><div class="cg-spacer"></div>${top}${thread}<div class="cg-bow-slot">${bow}</div>${hint}${skip}<div class="cg-spacer cg-spacer--b"></div></div>`;
}

function face(side, T) {
  return `<div class="cg-face cg-paper">
      <div class="cg-roman-frame"><i></i><i></i><i></i><i></i></div>
      ${botanicalSpines()}
      ${floraCorner('tl')}${floraCorner('br')}${floraCorner('tr')}${floraCorner('bl')}
      ${column('face', T)}
    </div>`;
}

function template(T) {
  const flap = side => `<div class="cg-flap cg-flap--${side}">
      <div class="cg-flap__in">${face(side, T)}<i class="cg-flap__shade"></i><i class="cg-flap__sheen"></i><i class="cg-flap__gild"></i></div>
      <div class="cg-flap__back"></div><i class="cg-flap__drop"></i>
    </div>`;
  return `<h1 class="cg-sr" id="gate-title">${esc(T.a)} &amp; ${esc(T.b)} · ${esc(T.kicker)}</h1>
    <p class="cg-sr" id="gate-desc">${esc(T.date)}</p>
    <div class="cg-under" aria-hidden="true"><i class="cg-under__shade"></i><i class="cg-under__light"></i></div>
    <div class="cg-stage" aria-hidden="true">${flap('l')}${flap('r')}</div>
    ${floraFall(device.light ? 6 : innerWidth < 700 ? 9 : 13)}
    <div class="cg-ui">${column('ui', T)}</div>
    <canvas class="cg-sparks" aria-hidden="true"></canvas>`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Papel de algodón crema (textura generada, ligera)
   ═══════════════════════════════════════════════════════════════════════════ */
function canvasBlobURL(c) {
  return new Promise(res => {
    try { c.toBlob(b => res(b ? URL.createObjectURL(b) : c.toDataURL()), 'image/png'); } catch { res(''); }
  });
}
async function makePaper() {
  const rand = rng(1931);
  // 1) grano + fibras (tile 384, sin costuras)
  const S = 384, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d', { willReadFrequently: true });
  const img = x.createImageData(S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() + rand() + rand()) / 1.5 - 1;
    const light = n > 0, a = Math.min(255, Math.abs(n) * (light ? 20 : 15));
    d[i] = light ? 255 : 128; d[i + 1] = light ? 253 : 94; d[i + 2] = light ? 246 : 62; d[i + 3] = a;
  }
  x.putImageData(img, 0, 0);
  x.lineCap = 'round';
  const fiber = (x0, y0, len, ang, bend, w, col) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const ax = x0 + ox, ay = y0 + oy;
      if (ax < -len || ax > S + len || ay < -len || ay > S + len) continue;
      const ex = ax + Math.cos(ang) * len, ey = ay + Math.sin(ang) * len;
      const mx = (ax + ex) / 2 - Math.sin(ang) * bend, my = (ay + ey) / 2 + Math.cos(ang) * bend;
      x.beginPath(); x.moveTo(ax, ay); x.quadraticCurveTo(mx, my, ex, ey);
      x.strokeStyle = col; x.lineWidth = w; x.stroke();
    }
  };
  for (let i = 0; i < 150; i++) {
    const dark = rand() < .6;
    fiber(rand() * S, rand() * S, 5 + rand() * rand() * 40, rand() * Math.PI * 2, (rand() - .5) * 10, .3 + rand() * .55,
      dark ? `rgba(${132 + rand() * 30 | 0},${98 + rand() * 20 | 0},${64 + rand() * 14 | 0},${(.025 + rand() * .05).toFixed(3)})`
        : `rgba(255,253,246,${(.1 + rand() * .16).toFixed(3)})`);
  }
  for (let i = 0; i < 28; i++) { // inclusiones del algodón
    x.fillStyle = `rgba(${130 + rand() * 40 | 0},${96 + rand() * 30 | 0},${64 + rand() * 20 | 0},${(.04 + rand() * .07).toFixed(3)})`;
    x.beginPath(); x.arc(rand() * S, rand() * S, .4 + rand() * 1.1, 0, Math.PI * 2); x.fill();
  }
  // 2) nubes de tono (se estira al tamaño de la cara)
  const M = document.createElement('canvas');
  M.width = 192; M.height = 192;
  const m = M.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < 46; i++) {
    const px = rand() * 192, py = rand() * 192, r = 14 + rand() * 40, warm = rand() < .45;
    const g = m.createRadialGradient(px, py, 0, px, py, r);
    const rgb = warm ? '214,182,136' : '255,252,243';
    g.addColorStop(0, `rgba(${rgb},${(warm ? .018 + rand() * .03 : .07 + rand() * .1).toFixed(3)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);           // mismo color con alfa 0 (si no, el degradado pasa por gris)
    m.fillStyle = g; m.fillRect(0, 0, 192, 192);
  }
  const [fib, mot] = await Promise.all([canvasBlobURL(c), canvasBlobURL(M)]);
  return { fib, mot };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Reproductor del lazo (WebGL, un canvas, video con alfa apilado)
   ═══════════════════════════════════════════════════════════════════════════ */
const VS = `attribute vec2 p; varying vec2 v;
void main(){ v = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
// Composición del alfa apilado. Interior: color del texel central (nítido) + máscara de enfoque suave.
// Bordes (algún vecino transparente): color ponderado por alfa² de 5 muestras → sin filo oscuro (el negro del fondo
// que la compresión 4:2:0 mezcla en el borde no entra). Alfa: muestra central al ampliar; 5 muestras al reducir (AA).
// Máscara en los bordes del cuadro: 1 % a los lados (los renders traen píxeles sueltos en las esquinas) y un fundido
// largo arriba/abajo (fuera del lazo) para que la cinta que sale de cuadro en el tirón no se corte en seco.
const FS = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform sampler2D uA; uniform sampler2D uB;
uniform float uMix; uniform float uGlow; uniform float uFade;
uniform vec2 uStep; uniform float uEdge; uniform float uAA; uniform float uSharp;
float tA(sampler2D t, vec2 uv){ return clamp((texture2D(t, vec2(uv.x, clamp(.5 + uv.y * .5, .5 + uEdge, 1. - uEdge))).r - .018) * 1.035, 0., 1.); }
vec3 tC(sampler2D t, vec2 uv){ return texture2D(t, vec2(uv.x, clamp(uv.y * .5, uEdge, .5 - uEdge))).rgb; }
vec4 comp(sampler2D t){
  vec2 d1 = uStep, d2 = vec2(uStep.x, -uStep.y);
  float a0 = tA(t, v), a1 = tA(t, v + d1), a2 = tA(t, v - d1), a3 = tA(t, v + d2), a4 = tA(t, v - d2);
  vec3 c0 = tC(t, v), c1 = tC(t, v + d1), c2 = tC(t, v - d1), c3 = tC(t, v + d2), c4 = tC(t, v - d2);
  float w0 = a0 * a0 * 1.6 + .0006; vec4 w = vec4(a1 * a1, a2 * a2, a3 * a3, a4 * a4) + .0004;
  vec3 cw = (c0 * w0 + c1 * w.x + c2 * w.y + c3 * w.z + c4 * w.w) / (w0 + w.x + w.y + w.z + w.w);
  vec3 cs = clamp(c0 + (c0 - (c1 + c2 + c3 + c4) * .25) * uSharp, 0., 1.);
  vec3 c = mix(cw, cs, smoothstep(.97, 1., min(min(a1, a2), min(a3, a4))));
  float a = mix(a0, a0 * .44 + (a1 + a2 + a3 + a4) * .14, uAA);
  a *= smoothstep(0., .012, v.x) * smoothstep(0., .012, 1. - v.x) * smoothstep(0., .1, v.y) * smoothstep(0., .07, 1. - v.y);
  return vec4(c * a, a);
}
void main(){
  vec4 a = comp(uA);
  vec4 o = a;
  if (uMix > .001) { vec4 b = comp(uB); o = mix(a, b, uMix); }
  o.rgb = min(o.rgb * (1. + uGlow * .07) + vec3(.035, .022, .012) * uGlow * o.a, vec3(o.a));
  gl_FragColor = o * uFade;
}`;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // FIX: el contexto de prueba no queda vivo
    return true;
  } catch { return false; }
}

async function fetchBlob(url, onP, signal) {
  const r = await fetch(url, signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total || !r.body.getReader) { const b = await r.blob(); onP(1); return new Blob([b], { type: 'video/mp4' }); }
  const rd = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length; onP(clamp(got / total));
  }
  return new Blob(parts, { type: 'video/mp4' });
}

function makeVideo(src, loop) {
  const v = document.createElement('video');
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = !!loop; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
  v.crossOrigin = 'anonymous'; v.disablePictureInPicture = true;
  v.src = src;
  return v;
}
const once = (el, ev, ms) => new Promise((res, rej) => {
  let t = 0;
  const ok = () => { clearTimeout(t); el.removeEventListener('error', ko); res(); };
  const ko = () => { clearTimeout(t); el.removeEventListener(ev, ok); rej(new Error('error de medios')); };
  el.addEventListener(ev, ok, { once: true }); el.addEventListener('error', ko, { once: true });
  if (ms) t = setTimeout(() => { el.removeEventListener(ev, ok); el.removeEventListener('error', ko); rej(new Error('tiempo agotado: ' + ev)); }, ms);
});

function createBowPlayer({ button, canvas, assets, meta, dpr, reduced, onOwnProgress, ts = 1 }) {
  const lift = canvas.parentElement;
  const st = {
    mode: 'none', gl: null, prog: null, texA: null, texB: null, u: {}, A: null, B: null, urls: [],
    freshA: false, freshB: false, lastTA: -1, lastTB: -1, mix: 0, mixFrom: 0, mixT0: 0, mixing: false, bActive: false,
    glow: 0, glowT: 0, fade: 1, raf: 0, running: false, disposed: false, w: 0, h: 0, frames: 0, fpsT: now(), fps: 0,
    dl: { a: 0, b: 0 }, openStarted: false, abrirEnded: false, drawnOnce: false, lost: false,
  };
  const report = () => onOwnProgress?.(clamp(st.dl.a * .5 + st.dl.b * .5));

  function showImg(src) {
    return new Promise(res => {
      const img = new Image();
      img.className = 'cg-bow__img'; img.alt = ''; img.decoding = 'async'; img.draggable = false;
      img.onload = () => { canvas.replaceWith(img); st.img = img; st.mode = 'img'; button.classList.add('is-static'); res(true); };
      img.onerror = () => res(false);
      img.src = src;
    });
  }
  function showSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cg-bow__svg'); svg.setAttribute('viewBox', '0 0 400 400'); svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = `<defs><linearGradient id="cgb-s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a2236"/><stop offset=".45" stop-color="#5a0f1d"/><stop offset="1" stop-color="#3a0812"/></linearGradient>
      <linearGradient id="cgb-h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d99aa0" stop-opacity=".55"/><stop offset=".5" stop-color="#d99aa0" stop-opacity="0"/></linearGradient>
      <filter id="cgb-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#3a281d" flood-opacity=".3"/></filter></defs>
      <g filter="url(#cgb-sh)">
      <path d="M0 180H400V214H0Z" fill="url(#cgb-s)" opacity=".9"/>
      <path d="M196 206C176 250 150 300 112 352L140 340 150 372C176 320 196 270 206 214Z" fill="url(#cgb-s)"/>
      <path d="M206 206C228 250 258 298 296 346L268 338 262 370C232 320 212 270 198 214Z" fill="url(#cgb-s)"/>
      <path d="M200 196C168 150 96 116 70 150C48 180 74 236 132 230C160 227 184 214 200 204Z" fill="url(#cgb-s)"/>
      <path d="M200 196C232 150 304 116 330 150C352 180 326 236 268 230C240 227 216 214 200 204Z" fill="url(#cgb-s)"/>
      <path d="M200 196C168 150 96 116 70 150C60 164 62 182 72 196C86 166 140 160 190 196Z" fill="url(#cgb-h)"/>
      <path d="M200 196C232 150 304 116 330 150C340 164 338 182 328 196C314 166 260 160 210 196Z" fill="url(#cgb-h)"/>
      <ellipse cx="200" cy="200" rx="26" ry="30" fill="url(#cgb-s)"/><ellipse cx="196" cy="190" rx="12" ry="9" fill="#d99aa0" opacity=".35"/></g>`;
    canvas.replaceWith(svg); st.svg = svg; st.mode = 'svg'; button.classList.add('is-static');
  }
  async function fallbackStatic() {
    if (st.mode === 'img' || st.mode === 'svg') return st.mode;
    if (!(await showImg(assets.poster))) showSvg();
    return st.mode;
  }

  function initGL() {
    const attrs = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' };
    // PERF: WebGL2 si existe → las máscaras de los destellos se leen en la GPU de forma asíncrona (ver mask*)
    const gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('sin WebGL');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = unit => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      t.w = 0; t.h = 0;
      return t;
    };
    st.texA = tex(0); st.texB = tex(1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    for (const n of ['uA', 'uB', 'uMix', 'uGlow', 'uFade', 'uStep', 'uEdge', 'uAA', 'uSharp']) st.u[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(st.u.uA, 0); gl.uniform1i(st.u.uB, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    st.gl = gl; st.prog = prog;
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); st.lost = true; maskFail(); stop(); fallbackStatic(); }, { once: true });
    if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) initMask(gl, sh);
  }

  // ── PERF · máscara del desatado leída en la GPU, sin bloquear el hilo ──────────────────────────────────────────────
  // Antes: createImageBitmap + drawImage + getImageData por muestra (≈25 ms bloqueados esperando a la GPU, ×18 muestras
  // precalculadas con la puerta en reposo = 443 ms de tirones justo cuando el lazo se podía tocar, y otra vez en vivo en el
  // desatado si no estaban listas). Ahora: un pase de 72×72 lee la mitad alfa del cuadro que se está mostrando, readPixels
  // a un PIXEL_PACK_BUFFER + fenceSync, y el resultado se recoge 1–3 cuadros después cuando la GPU avisa. Sin precálculo.
  const MASK_N = 72;
  function initMask(gl, sh) {
    try {
      const fs = `precision mediump float; varying vec2 v; uniform sampler2D uB; uniform vec2 uPx;
float a(vec2 o){ return texture2D(uB, vec2(clamp(v.x + o.x, 0., 1.), clamp(.5 + (v.y + o.y) * .5, .5, 1.))).r; }
void main(){ gl_FragColor = vec4((a(-uPx) + a(uPx) + a(vec2(uPx.x, -uPx.y)) + a(vec2(-uPx.x, uPx.y))) * .25, 0., 0., 1.); }`;
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      const uB = gl.getUniformLocation(prog, 'uB'), uPx = gl.getUniformLocation(prog, 'uPx');
      gl.useProgram(prog); gl.uniform1i(uB, 1); gl.uniform2f(uPx, .25 / MASK_N, .25 / MASK_N); gl.useProgram(st.prog);
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, MASK_N, MASK_N, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) throw new Error('fbo');
      const pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, MASK_N * MASK_N * 4, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      st.mask = { prog, fb, tex, pbo, sync: null, buf: new Uint8Array(MASK_N * MASK_N * 4), waiters: [] };
    } catch (e) { st.mask = null; }
  }
  function maskFail() { const M = st.mask; if (!M) return; st.mask = null; M.waiters.splice(0).forEach(r => r(null)); }
  /** En cada cuadro del bucle: recoge una lectura terminada o lanza la siguiente si alguien la pidió. */
  function serviceMask() {
    const M = st.mask, gl = st.gl;
    if (!M || !gl || st.lost) return;
    if (M.sync) {
      const s = gl.clientWaitSync(M.sync, 0, 0);
      if (s === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(M.sync); M.sync = null;
      if (s === gl.WAIT_FAILED) { maskFail(); return; }
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, M.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, M.buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const N = MASK_N, d = M.buf, pts = [];
      // fila r del framebuffer (desde abajo) = fila N−1−r del cuadro (desde arriba), como sampleMask()
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) { const a = d[(r * N + c) * 4]; if (a > 110) pts.push({ u: (c + Math.random()) / N, v: (N - 1 - r + Math.random()) / N, a: a / 255 }); }
      M.waiters.splice(0).forEach(res => res(pts));
      return;
    }
    if (!M.waiters.length || !st.texB.w) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, M.fb); gl.viewport(0, 0, MASK_N, MASK_N);
    gl.useProgram(M.prog);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, M.pbo);
    // (almacén nuevo en cada lectura: sin esto Chrome avisa "READ-usage buffer was written, then fenced, but written again
    //  before being read back" y descarta su copia de lectura rápida — probado en shots/perf/pbo/)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, MASK_N * MASK_N * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, MASK_N, MASK_N, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(st.prog); gl.viewport(0, 0, st.w, st.h);
    M.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  // FIX: el tamaño del contenedor se lee solo cuando cambia (ResizeObserver / resize), nunca dentro del bucle: leer
  // offsetWidth en cada cuadro forzaba un layout síncrono (171–245 por cada 4 s en reposo).
  const box = { w: 0, h: 0, dirty: true };
  const measure = () => { box.w = lift.offsetWidth; box.h = lift.offsetHeight; box.dirty = false; };
  const markDirty = () => { box.dirty = true; st.dirty = true; };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(markDirty) : null;
  ro?.observe(lift);
  addEventListener('resize', markDirty, { passive: true });
  function resize() {
    // Un solo quad 2D: se puede subir la resolución del canvas hasta la nativa del video en pantallas densas
    // (móvil DPR 3: 960 px reales en vez de 1.5×) → lazo nítido sin coste apreciable.
    if (box.dirty) measure();
    const cw = Math.max(1, box.w), fw = (st.A && st.A.videoWidth) || meta.width || 960;
    const k = Math.min(devicePixelRatio || 1, Math.max(dpr, fw / cw));
    const w = Math.max(2, Math.round(cw * k)), h = Math.max(2, Math.round(box.h * k));
    if (w === st.w && h === st.h) return;
    st.w = w; st.h = h; canvas.width = w; canvas.height = h;
    st.dirty = true;
  }

  function upload(tex, unit, video) {
    const gl = st.gl;
    if (!video || video.readyState < 2) return false;
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      if (tex.w !== video.videoWidth || tex.h !== video.videoHeight) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        tex.w = video.videoWidth; tex.h = video.videoHeight;
      } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch (e) { console.warn('[gate] textura de video', e); return false; }
    return true;
  }

  function draw() {
    const gl = st.gl;
    if (!gl || st.lost) return;
    const vw = (st.A && st.A.videoWidth) || meta.width || 960;
    const vh = (st.A && st.A.videoHeight) || (meta.height || 960) * 2;
    const ratio = vw / Math.max(1, st.w);          // > 1: el video se reduce; < 1: se amplía
    const off = Math.max(.8, ratio * .45);
    gl.viewport(0, 0, st.w, st.h);
    gl.uniform2f(st.u.uStep, off / vw, off / (vh / 2));
    gl.uniform1f(st.u.uEdge, 1.5 / vh);
    gl.uniform1f(st.u.uAA, clamp((ratio - 1.05) / .6));
    gl.uniform1f(st.u.uSharp, ratio < 1.15 ? .32 : .16);
    gl.uniform1f(st.u.uMix, st.mix); gl.uniform1f(st.u.uGlow, st.glow); gl.uniform1f(st.u.uFade, st.fade);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!st.drawnOnce && (st.texA.w || st.texB.w)) { st.drawnOnce = true; st.onFirstFrame?.(); }
  }

  function loop() {
    st.raf = 0;
    if (st.disposed || st.lost) return;
    st.raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    resize();
    let changed = st.dirty; st.dirty = false;
    const A = st.A, B = st.B;
    // A (reposo)
    const needA = st.mix < .999;
    if (needA && A) {
      const fresh = A.requestVideoFrameCallback ? st.freshA : A.currentTime !== st.lastTA;
      if (fresh || !st.texA.w) { if (upload(st.texA, 0, A)) { st.freshA = false; st.lastTA = A.currentTime; changed = true; } }
    }
    if (st.bActive && B) {
      const fresh = B.requestVideoFrameCallback ? st.freshB : B.currentTime !== st.lastTB;
      if (fresh || !st.texB.w) { if (upload(st.texB, 1, B)) { st.freshB = false; st.lastTB = B.currentTime; changed = true; } }
    }
    if (st.mixing) {
      const k = clamp((now() - st.mixT0) * ts / 100);
      st.mix = st.mixFrom + (1 - st.mixFrom) * k;
      changed = true;
      if (k >= 1) { st.mixing = false; st.mix = 1; try { A?.pause(); } catch {} }
    }
    const g = st.glow + (st.glowT - st.glow) * .12;
    if (Math.abs(g - st.glow) > .002) { st.glow = g; changed = true; } else if (st.glow !== st.glowT) { st.glow = st.glowT; changed = true; }
    if (changed) {
      draw();
      st.frames++;
      const t = now();
      if (t - st.fpsT > 1000) { st.fps = Math.round(st.frames * 1000 / (t - st.fpsT)); st.frames = 0; st.fpsT = t; }
    }
    serviceMask();
  }
  const start = () => { if (!st.raf && !st.disposed) st.raf = requestAnimationFrame(loop); };
  /** En reposo (tiempo ocioso): recorre el video del desatado en un <video> aparte y guarda la máscara de cada
   *  instante de la disolución → durante la animación los destellos salen de ahí, sin leer la GPU (lecturas que,
   *  con la máquina cargada, cuestan 10–40 ms por frame). Se corta si el usuario toca antes. */
  async function precomputeMasks(times) {
    if (st.bank || !st.urls[1] || st.disposed) return;
    st.bank = [];
    const C = makeVideo(st.urls[1], false);
    try {
      await once(C, 'loadeddata', 8000);
      for (const t of times) {
        if (st.openStarted || st.disposed) break;
        await new Promise(r => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 300 }) : setTimeout(r, 50)));
        if (st.openStarted || st.disposed) break;
        const sk = once(C, 'seeked', 3000);
        C.currentTime = t;
        await sk;
        const pts = await sampleVideoMask(C);
        if (st.openStarted || st.disposed) break;
        st.bank.push({ t, pts });
      }
    } catch (e) {
      // con la máquina cargada el seek puede tardar: no es un fallo (los destellos se muestrean en vivo del video)
      if (!/tiempo agotado/.test(e?.message || '')) console.warn('[gate] máscaras previas:', e?.message || e);
    }
    try { C.removeAttribute('src'); C.load(); } catch {}
  }
  const stop = () => { cancelAnimationFrame(st.raf); st.raf = 0; };
  const watch = (v, key) => {
    if (!v.requestVideoFrameCallback) return;
    const cb = (_t, md) => { st[key] = true; if (key === 'freshB') st.mediaB = md?.mediaTime ?? v.currentTime; if (!st.disposed) v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
  };

  const ready = (async () => {
    if (reduced) { st.dl.a = st.dl.b = 1; report(); return fallbackStatic(); }
    if (!hasWebGL()) { st.dl.a = st.dl.b = 1; report(); return fallbackStatic(); }
    try {
      // COMPAT-FLUIDEZ (hallazgo 28, red lenta: en 3G el lazo se podía tocar recién a los ~59 s y nada respondía): si a los
      // 6 s (o después) la descarga de los dos videos (2.6 MB) proyecta más de 16 s, se corta y el lazo queda en su póster, tocable ya,
      // con el desatado del póster (animación completa en calidad baja antes que esperar un minuto).
      const ac = typeof AbortController === 'function' ? new AbortController() : null, tDl = performance.now();
      let slowIv = 0;
      const slow = new Promise((_, rej) => {
        slowIv = setInterval(() => {
          const el = performance.now() - tDl, p = (st.dl.a * .66 + st.dl.b * 1.94) / 2.6;
          if (st.disposed || p >= 1) { clearInterval(slowIv); return; }
          if (el > 6000 && el / Math.max(p, .02) > 16000) { clearInterval(slowIv); st.slowNet = true; try { ac?.abort(); } catch {} rej(new Error('red lenta: ' + Math.round(p * 100) + ' % en ' + Math.round(el / 1000) + ' s')); }
        }, 500);
      });
      const [ba, bb] = await Promise.race([Promise.all([
        fetchBlob(assets.reposo, p => { st.dl.a = p; report(); }, ac?.signal),
        fetchBlob(assets.abrir, p => { st.dl.b = p; report(); }, ac?.signal),
      ]), slow]).finally(() => clearInterval(slowIv));
      // iPhone/Safari (WebKit) no reproduce video desde blob: (MEDIA_ERR_SRC_NOT_SUPPORTED, código 4; verificado en WebKit):
      // los <video> usan las URL directas. La descarga de arriba solo da el progreso y deja los archivos en la caché HTTP.
      void ba; void bb;
      const ua = assets.reposo, ub = assets.abrir;
      initGL();
      const A = st.A = makeVideo(ua, true), B = st.B = makeVideo(ub, false);
      B.addEventListener('ended', () => { st.abrirEnded = true; });
      watch(A, 'freshA'); watch(B, 'freshB');
      await Promise.all([once(A, 'loadeddata', 12000), once(B, 'loadeddata', 12000)]);
      resize();
      st.mode = 'gl';
      try { await A.play(); }
      catch (e) {
        // ahorro de energía (iOS) puede bloquear el autoplay: póster ahora y el video al tocar (dentro del gesto)
        console.warn('[gate] el reposo no pudo reproducirse solo, uso póster:', e?.message || e);
        st.autoplayBlocked = true;
      }
      // decodifica el primer frame del desatado (en silencio) para que el cambio sea instantáneo
      try { await B.play(); B.pause(); B.currentTime = 0; } catch { /* se intentará en el gesto */ }
      if (st.autoplayBlocked) {
        const pending = st.mode;
        await fallbackStatic();
        st.glPending = pending === 'gl';
        return st.mode;
      }
      start();
      return 'gl';
    } catch (e) {
      if (st.disposed) return st.mode; // la puerta ya se quitó (skip/dispose) mientras cargaba: no es un fallo
      (st.slowNet ? console.info : console.warn)('[gate] lazo en video no disponible, uso póster:', e?.message || e);
      st.dl.a = st.dl.b = 1; report();
      stop();
      return fallbackStatic();
    }
  })();

  return {
    ready,
    get mode() { return st.mode; },
    get fps() { return st.fps; },
    get bankSize() { return (st.bank || []).length; },
    get canvasEl() { return st.mode === 'gl' ? canvas : (st.img || st.svg); },
    get abrir() { return st.B; },
    get bandSource() { return st.mode === 'gl' && st.A ? [st.A, 'video'] : st.img ? [st.img, 'img'] : null; },
    get abrirEnded() { return st.abrirEnded; },
    onFirstFrame(cb) { if (st.drawnOnce || st.mode !== 'gl') cb(); else st.onFirstFrame = cb; },
    openTime() { const B = st.B; if (!B) return 0; return Math.max(B.currentTime || 0, st.mediaB || 0); },
    duration() { return st.B?.duration || meta.end; },
    setGlow(v) { st.glowT = v; start(); },
    /** Puntos opacos (u,v 0..1) del frame actual del desatado. PERF: en WebGL2 se leen en la GPU sin bloquear
     *  (resuelve 1–3 cuadros después); si no, lectura directa del video (respaldo de las máscaras precalculadas). */
    sampleMask() {
      if (st.mask && st.mode === 'gl' && !st.lost) {
        return new Promise(res => { st.mask.waiters.push(res); start(); })
          .then(pts => pts || (st.B ? sampleVideoMask(st.B) : []));
      }
      return st.B ? sampleVideoMask(st.B) : Promise.resolve([]);
    },
    /** PERF: true si las máscaras se leen en la GPU (no hace falta precalcularlas). */
    get gpuMasks() { return !!st.mask; },
    /** Llamar dentro del gesto. Resuelve true cuando el desatado ya se está viendo. */
    precomputeMasks,
    /** Máscara precalculada más cercana a t (s) o null. */
    bankMask(t) {
      let best = null;
      for (const m of st.bank || []) if (!best || Math.abs(m.t - t) < Math.abs(best.t - t)) best = m;
      return best && Math.abs(best.t - t) < .07 ? best.pts : null;
    },
    playOpen() {
      st.openStarted = true;
      const B = st.B;
      if (!B || st.lost) return Promise.resolve(false);
      if (st.mode !== 'gl' && !st.glPending) return Promise.resolve(false);
      try { B.currentTime = 0; B.playbackRate = ts; } catch {}
      let p;
      try { p = B.play(); } catch (e) { p = Promise.reject(e); }
      return Promise.resolve(p).then(async () => {
        if (st.mode !== 'gl') { // venía de póster por autoplay bloqueado: vuelve el canvas
          const el = st.img || st.svg;
          if (el) { el.replaceWith(canvas); st.img = st.svg = null; button.classList.remove('is-static'); }
          st.mode = 'gl'; st.mix = 1; st.mixing = false;
        }
        st.bActive = true; st.freshB = true; start();
        // espera el primer frame nuevo del desatado y funde en ~3 frames
        const t0 = now();
        while (!st.texB.w || (B.currentTime < .001 && now() - t0 < 400)) { await new Promise(r => requestAnimationFrame(r)); if (now() - t0 > 900) break; }
        if (st.mix < 1) { st.mixFrom = st.mix; st.mixT0 = now(); st.mixing = true; }
        return true;
      }).catch(e => { console.warn('[gate] no se pudo reproducir el desatado:', e?.message || e); return false; });
    },
    fadeOut(ms = 400) {
      return new Promise(res => {
        const t0 = now(), f0 = st.fade;
        const step = () => { st.fade = f0 * (1 - clamp((now() - t0) / ms)); st.dirty = true; if (st.fade > 0) requestAnimationFrame(step); else res(); };
        step();
      });
    },
    pauseIdle(p) { if (st.mode !== 'gl' || st.bActive) return; try { p ? st.A?.pause() : st.A?.play()?.catch(() => {}); } catch {} },
    /** Detiene el bucle de dibujo (el lazo ya no se ve) sin liberar todavía el video ni el contexto. */
    halt() { stop(); try { st.A?.pause(); st.B?.pause(); } catch {} const M = st.mask; if (M) M.waiters.splice(0).forEach(r => r(null)); },
    dispose() {
      st.disposed = true; stop();
      { const M = st.mask, gl = st.gl; maskFail(); if (M && gl) { try { if (M.sync) gl.deleteSync(M.sync); gl.deleteFramebuffer(M.fb); gl.deleteTexture(M.tex); gl.deleteBuffer(M.pbo); gl.deleteProgram(M.prog); } catch {} } }
      ro?.disconnect(); removeEventListener('resize', markDirty);
      for (const v of [st.A, st.B]) if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch {} }
      st.urls.forEach(u => URL.revokeObjectURL(u)); st.urls = [];
      // FIX: sin loseContext() ni cambiar el tamaño del lienzo (cada uno bloqueaba ~140–150 ms el hilo esperando a la GPU):
      // se borran los recursos, se quita el lienzo del documento y el navegador libera el contexto cuando quiera
      const gl = st.gl;
      if (gl) { try { gl.deleteTexture(st.texA); gl.deleteTexture(st.texB); gl.deleteProgram(st.prog); } catch {} }
      try { canvas.remove(); } catch {}
      st.gl = null;
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Destellos dorados (canvas 2D)
   ═══════════════════════════════════════════════════════════════════════════ */
function createSparks(canvas, dprMax, mobile, ts = 1) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1, raf = 0, last = 0;
  const parts = [];
  const MAX = mobile ? 320 : 640;
  let box = null;                                   // rectángulo sucio del frame anterior (px de dispositivo)
  const sprite = (size, fn) => { const c = document.createElement('canvas'); c.width = c.height = size; fn(c.getContext('2d'), size); return c; };
  const dot = (core, mid) => sprite(64, (x, s) => {
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,253,244,1)'); g.addColorStop(.16, core); g.addColorStop(.42, mid); g.addColorStop(1, 'rgba(214,170,100,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
  });
  const SPR = [
    dot('rgba(246,222,160,1)', 'rgba(184,140,70,.42)'),
    dot('rgba(232,196,120,1)', 'rgba(150,108,48,.40)'),
    dot('rgba(255,240,200,1)', 'rgba(214,176,110,.34)'),
  ];
  const STAR = sprite(96, (x, s) => {
    const c = s / 2;
    const g = x.createRadialGradient(c, c, 0, c, c, c * .55);
    g.addColorStop(0, 'rgba(255,244,210,.85)'); g.addColorStop(.5, 'rgba(206,160,82,.28)'); g.addColorStop(1, 'rgba(206,160,82,0)');
    x.fillStyle = g; x.fillRect(0, 0, s, s);
    x.translate(c, c);
    for (const [len, w, a] of [[c * .98, c * .07, 0], [c * .6, c * .05, Math.PI / 4]]) {
      x.save(); x.rotate(a);
      for (let k = 0; k < 2; k++) {
        x.rotate(Math.PI / 2 * k);
        const lg = x.createLinearGradient(-len, 0, len, 0);
        lg.addColorStop(0, 'rgba(201,154,78,0)'); lg.addColorStop(.5, 'rgba(255,252,240,1)'); lg.addColorStop(1, 'rgba(201,154,78,0)');
        x.fillStyle = lg;
        x.beginPath(); x.moveTo(-len, 0); x.quadraticCurveTo(0, -w, len, 0); x.quadraticCurveTo(0, w, -len, 0); x.fill();
      }
      x.restore();
    }
  });

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, dprMax);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    box = null;
  }
  resize();
  addEventListener('resize', resize, { passive: true });

  function frame(t) {
    raf = 0;
    const dt = Math.min(.05, (t - (last || t)) / 1000) * ts; last = t;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (box) ctx.clearRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const drag = Math.exp(-p.drag * dt);
      p.vx = p.vx * drag + Math.sin(p.age * 2.3 + p.ph) * p.swirl * dt;
      p.vy = p.vy * drag + p.lift * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const k = p.age / p.life;
      let a = Math.min(1, p.age / .07) * (k < .45 ? 1 : 1 - (k - .45) / .55);
      a *= .72 + .28 * Math.sin(p.age * p.tw + p.ph);
      if (a <= .01) continue;
      const s = p.size * (p.star ? (.6 + .4 * Math.sin(p.age * 5 + p.ph)) : (1 - k * .35));
      ctx.globalAlpha = a;
      if (p.x - s < x0) x0 = p.x - s; if (p.y - s < y0) y0 = p.y - s; if (p.x + s > x1) x1 = p.x + s; if (p.y + s > y1) y1 = p.y + s;
      if (p.star) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.drawImage(STAR, -s, -s, s * 2, s * 2); ctx.restore();
      } else ctx.drawImage(SPR[p.spr], p.x - s, p.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    box = x1 > x0 ? [Math.max(0, Math.floor((x0 - 2) * dpr)), Math.max(0, Math.floor((y0 - 2) * dpr)), Math.min(canvas.width, Math.ceil((x1 + 2) * dpr)), Math.min(canvas.height, Math.ceil((y1 + 2) * dpr))] : null;
    if (parts.length) raf = requestAnimationFrame(frame);
    else { last = 0; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  }
  const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } };

  return {
    get count() { return parts.length; },
    /** pts: [{x,y}] en px CSS; o: { cx, cy, speed, up, n, star } */
    emit(pts, o = {}) {
      if (!pts.length) return;
      const n = Math.min(o.n ?? pts.length, MAX - parts.length);
      for (let i = 0; i < n; i++) {
        const q = pts[(Math.random() * pts.length) | 0];
        const dx = q.x - (o.cx ?? q.x), dy = q.y - (o.cy ?? q.y), d = Math.hypot(dx, dy) || 1;
        const sp = (o.speed ?? 60) * (.35 + Math.random() * .9);
        const star = Math.random() < (o.star ?? .1);
        parts.push({
          x: q.x + (Math.random() - .5) * (o.jitter ?? 3), y: q.y + (Math.random() - .5) * (o.jitter ?? 3),
          vx: dx / d * sp + (Math.random() - .5) * (o.spread ?? 40) + (o.vx ?? 0),
          vy: dy / d * sp * .7 - (o.up ?? 26) * Math.random() + (Math.random() - .5) * (o.spread ?? 40) * .6,
          lift: -(o.buoy ?? 22) * (.4 + Math.random()), drag: .9 + Math.random() * .9, swirl: 30 + Math.random() * 50,
          life: (o.life ?? 1.7) * (.55 + Math.random() * .75), age: 0,
          size: star ? (o.starSize ?? 9) * (.6 + Math.random() * .8) : (o.size ?? 3.2) * (.45 + Math.random() * .9),
          spr: (Math.random() * 3) | 0, star, rot: Math.random() * 3, vr: (Math.random() - .5) * 3,
          tw: 9 + Math.random() * 14, ph: Math.random() * 7,
        });
      }
      kick();
    },
    clear() { parts.length = 0; },
    dispose() { cancelAnimationFrame(raf); raf = 0; parts.length = 0; removeEventListener('resize', resize); },
  };
}

/** Puntos opacos del frame actual de un video apilado (o de una imagen RGBA), en coordenadas 0..1 del cuadro. */
function sampleMask(src, kind) {
  try {
    const N = 72;
    const c = sampleMask.c || (sampleMask.c = document.createElement('canvas'));
    c.width = N; c.height = kind === 'video' ? N * 2 : N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(src, 0, 0, c.width, c.height);
    const d = x.getImageData(0, kind === 'video' ? N : 0, N, N).data;
    const pts = [];
    for (let i = 0; i < N * N; i++) {
      const a = kind === 'video' ? d[i * 4] : d[i * 4 + 3];
      if (a > 110) pts.push({ u: (i % N + Math.random()) / N, v: ((i / N | 0) + Math.random()) / N, a: a / 255 });
    }
    return pts;
  } catch { return []; }
}

/** Igual que sampleMask para el video del desatado, pero reduciendo el frame de forma asíncrona (sin bloquear el hilo). */
async function sampleVideoMask(video) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(video, { resizeWidth: 72, resizeHeight: 144, resizeQuality: 'low' });
      const pts = sampleMask(bmp, 'video');
      bmp.close?.();
      return pts;
    } catch { /* sigue con el método directo */ }
  }
  return sampleMask(video, 'video');
}

/** Detecta la cinta horizontal que llega a los bordes del cuadro y devuelve dos tiras de 1 px (izq./der.) con su perfil
 *  exacto (color + alfa + sombra) para prolongarla con CSS hasta los bordes de la pantalla.
 *  FIX: UNA sola lectura del cuadro (192 columnas × altura completa) y todo lo demás sale de ese búfer. Antes eran 6 lecturas
 *  de la GPU (drawImage del video + getImageData) que bloqueaban ~280 ms el hilo mientras el lazo respiraba. */
function analyzeBand(src, kind) {
  try {
    const isV = kind === 'video';
    const Wf = isV ? src.videoWidth : src.naturalWidth, Ht = isV ? src.videoHeight : src.naturalHeight;
    if (!Wf || !Ht) return null;
    const Hf = isV ? Ht / 2 : Ht;
    const Hs = Math.min(1024, Hf);                          // filas por mitad (color | alfa)
    const CW = 192, CH = isV ? Hs * 2 : Hs;
    const c = document.createElement('canvas'); c.width = CW; c.height = CH;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, CW, CH);
    const D = x.getImageData(0, 0, CW, CH).data;
    c.width = c.height = 1;
    const ci = u => Math.max(0, Math.min(CW - 1, Math.round(u * (CW - 1))));
    const at = (col, r) => (r * CW + col) * 4;
    const rawA = (col, r) => (isV ? D[at(col, r + Hs)] : D[at(col, r) + 3]);
    // perfil vertical de una columna (equivale al análisis de 96 filas de antes, con la resolución completa)
    const run = u => {
      const col = ci(u);
      let best = null, cur = null;
      for (let r = 0; r < Hs; r++) {
        if (rawA(col, r) > 150) { if (!cur) cur = [r, r]; else cur[1] = r; } else if (cur) { if (!best || cur[1] - cur[0] > best[1] - best[0]) best = cur; cur = null; }
      }
      if (cur && (!best || cur[1] - cur[0] > best[1] - best[0])) best = cur;
      return best && [best[0] / Hs, (best[1] + 1) / Hs];
    };
    const L = run(.1), Rr = run(.9);
    if (!L || !Rr) return null;
    const hL = L[1] - L[0], hR = Rr[1] - Rr[0];
    if (hL < .025 || hL > .2 || hR < .025 || hR > .2 || Math.abs((L[0] + L[1]) - (Rr[0] + Rr[1])) / 2 > .05) return null;
    // ¿Dónde se vuelve opaca la cinta del video? (sus extremos se desvanecen): la prolongación pasa por debajo de esa zona
    const row = Math.max(0, Math.min(Hs - 1, Math.round(((L[0] + L[1]) / 2) * Hs)));
    const M = CW, alphaAt = i => rawA(i, row) / 255;
    let iL = 0, iR = M - 1;
    while (iL < M / 2 && alphaAt(iL) < .97) iL++;
    while (iR > M / 2 && alphaAt(iR) < .97) iR--;
    const uInL = clamp(iL / M + .03, .04, .32), uInR = clamp(1 - iR / M + .03, .04, .32);
    // la tira solo cubre la cinta y su sombra (elemento CSS bajo → disolverlo con máscara cuesta poco)
    const B0 = Math.min(L[0], Rr[0]), B1 = Math.max(L[1], Rr[1]), BH = B1 - B0;
    const r0 = Math.max(0, Math.floor((B0 - BH * .2 - .01) * Hs)), r1 = Math.min(Hs, Math.ceil((B1 + BH * .95 + .01) * Hs));
    const alphaOf = (col, r) => (isV ? Math.max(0, Math.min(255, (D[at(col, r + Hs)] - 4) * 1.035)) : D[at(col, r) + 3]);
    const strip = u => {
      // fuera de la cinta, la sombra se toma de una columna más afuera (junto al lazo caen sombras de las orejas
      // y de las colas que no deben prolongarse hasta el borde de la pantalla), normalizada por el alfa de su cinta
      const uo = u < .5 ? Math.max(.07, u - .07) : Math.min(.93, u + .07);
      const cO = ci(uo), cU = ci(u);
      let coreO = 1;
      for (let r = Math.floor(B0 * Hs); r < Math.ceil(B1 * Hs); r++) coreO = Math.max(coreO, alphaOf(cO, r));
      const o = document.createElement('canvas'); o.width = 1; o.height = r1 - r0;
      const ox = o.getContext('2d', { willReadFrequently: true }), im = ox.createImageData(1, r1 - r0);
      const b0 = B0, b1 = B1, bh = BH, edge = 1.5 / Hs;
      for (let r = r0; r < r1; r++) {
        const p = at(cU, r), v = (r + .5) / Hs, oi = (r - r0) * 4;
        im.data[oi] = D[p]; im.data[oi + 1] = D[p + 1]; im.data[oi + 2] = D[p + 2];
        let a = alphaOf(cU, r);
        // fuera de la cinta solo queda su sombra de contacto (corta arriba, algo más larga abajo)
        if (v < b0 - edge || v > b1 + edge) { a = Math.min(a, alphaOf(cO, r) * 255 / coreO); im.data[oi] = im.data[oi + 1] = im.data[oi + 2] = 0; }
        if (v < b0) a *= clamp(1 - (b0 - v) / (bh * .18));
        else if (v > b1) a *= clamp(1 - (v - b1) / (bh * .9));
        im.data[oi + 3] = a;
      }
      ox.putImageData(im, 0, 0);
      return o.toDataURL('image/png');
    };
    return { v0: B0, v1: B1, vc: (L[0] + L[1] + Rr[0] + Rr[1]) / 4, s0: r0 / Hs, s1: r1 / Hs,
      uInL, uInR, left: strip(uInL), right: strip(1 - uInR) };
  } catch (e) { console.warn('[gate] análisis de la cinta', e); return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CSS
   ═══════════════════════════════════════════════════════════════════════════ */
function ensureCss(href) {
  const has = [...document.querySelectorAll('link[rel="stylesheet"]')].find(l => /(^|\/)gate\.css(\?|$)/.test(l.getAttribute('href') || ''));
  if (has) {
    if (has.sheet) return Promise.resolve();
    return Promise.race([new Promise(r => { has.addEventListener('load', r, { once: true }); has.addEventListener('error', r, { once: true }); }), sleep(2500)]);
  }
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href;
  const p = new Promise(r => { l.onload = r; l.onerror = r; });
  document.head.append(l);
  return Promise.race([p, sleep(2500)]);
}

/* ═══════════════════════════════════════════════════════════════════════════
   mountGate
   ═══════════════════════════════════════════════════════════════════════════ */
export async function mountGate(gateEl, opts = {}) {
  if (!gateEl) throw new Error('mountGate: falta el elemento #gate');
  const reduced = opts.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  const assets = { ...GATE_ASSETS, ...(opts.assets || {}) };
  const T = { ...TEXT, ...(opts.text || {}) };
  const mobile = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
  const dprMax = mobile ? 1.5 : 1.75;
  const dpr = Math.min(devicePixelRatio || 1, dprMax);
  const html = document.documentElement;

  const timing = { t0: Math.round(now()) };
  // estilos y DOM
  gateEl.classList.add('cgate', 'is-booting');
  await ensureCss(assets.css);
  timing.css = Math.round(now());
  const flat = device.mobile || device.light;
  gateEl.className = 'cgate is-booting' + (reduced ? ' cg-reduced' : '') + (flat ? ' cg-flat' : '');
  gateEl.removeAttribute('style');
  gateEl.hidden = false;
  gateEl.removeAttribute('aria-hidden');
  gateEl.setAttribute('role', 'dialog'); gateEl.setAttribute('aria-modal', 'true');
  gateEl.setAttribute('aria-labelledby', 'gate-title'); gateEl.setAttribute('aria-describedby', 'gate-desc');
  gateEl.innerHTML = template(T);
  gateEl.tabIndex = -1;
  try { if (!document.activeElement || document.activeElement === document.body) gateEl.focus({ preventScroll: true }); } catch {}
  const $ = s => gateEl.querySelector(s);
  const els = {
    stage: $('.cg-stage'), flapL: $('.cg-flap--l'), flapR: $('.cg-flap--r'), under: $('.cg-under'),
    light: $('.cg-under__light'), shades: [...gateEl.querySelectorAll('.cg-flap__shade')],
    ui: $('.cg-ui'), bow: $('.cg-ui .cg-bow'), lift: $('.cg-ui .cg-bow__lift'), canvas: $('.cg-ui .cg-bow__canvas'),
    hint: $('.cg-ui .cg-hint'), skip: $('.cg-ui .cg-skip'), thread: $('.cg-ui .cg-thread'),
    prog: $('.cg-ui .cg-thread__prog'), bead: $('.cg-ui .cg-thread__bead'), sparks: $('.cg-sparks'),
    slot: $('.cg-ui .cg-bow-slot'), bandL: $('.cg-ui .cg-band--l'), bandR: $('.cg-ui .cg-band--r'),
  };

  // papel
  const styleEl = document.createElement('style');
  document.head.append(styleEl);
  const paperP = (device.mobile ? Promise.resolve({fib:'', mot:''}) : makePaper()).then(({ fib, mot }) => {
    if (fib) styleEl.textContent = `.cgate{--cg-fiber:url("${fib}");--cg-mottle:url("${mot}")}`;
    return [fib, mot];
  }).catch(() => []);
  await Promise.race([paperP, sleep(300)]);
  timing.paper = Math.round(now());
  gateEl.classList.remove('is-booting');
  // las letras entran cuando sus fuentes están listas (máx. 1.6 s de espera)
  const fontsP = document.fonts?.load
    ? Promise.all(['1em "Great Vibes"', 'italic 500 1em "Cormorant Garamond"', '500 1em Montserrat'].map(f => document.fonts.load(f).catch(() => {})))
    : Promise.resolve();
  // (y el jardín: sus rosas, ≈ 55 KB, ya descargadas para que la floración no empiece con huecos)
  try { splitFlora(gateEl); } catch {}
  Promise.race([Promise.all([fontsP, floraReady]), sleep(1600)]).then(() => requestAnimationFrame(() => {
    timing.fonts = Math.round(now()); gateEl.classList.add('is-in');
    // PERF: terminada la floración (~6.5 s) el jardín queda como dibujo fijo; siguen solo la brisa, una rosa que respira,
    // las chispas y los pétalos que caen (menos animaciones vivas → menos trabajo por cuadro en teléfonos modestos)
    setTimeout(() => { if (!S.opening && !S.disposed) gateEl.classList.add('fl-settled'); }, 6800);
  }));

  // color del navegador (barra superior en móvil) a juego con el papel
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeOld = themeMeta?.getAttribute('content');
  themeMeta?.setAttribute('content', '#efe4cf');

  // metadatos del video
  let meta = { ...META_DEFAULT };
  const metaP = reduced ? Promise.resolve() : fetch(assets.meta).then(r => (r.ok ? r.json() : null)).then(j => { if (j) meta = { ...META_DEFAULT, ...j }; }).catch(() => {});

  // estado
  const S = {
    ext: 0, own: 0, ownReady: false, shown: 0, ready: false, opening: false, opened: false, gone: false, disposed: false,
    setCalled: false, t0: now(), raf: 0, timers: [], withMusic: false,
  };
  const later = (fn, ms) => { const id = setTimeout(() => { if (!S.disposed) fn(); }, ms); S.timers.push(id); return id; };
  const TS = clamp(+opts.timeScale || 1, .05, 4);        // < 1 = cámara lenta (solo para pruebas/capturas)
  const sparks = createSparks(els.sparks, dprMax, mobile, TS);
  const threadLen = (() => { try { return els.prog.getTotalLength(); } catch { return 0; } })();

  await metaP;
  timing.meta = Math.round(now());
  const player = (device.ribbonLite ? createRibbonLite : createBowPlayer)({
    button: els.bow, canvas: els.canvas, assets, meta, dpr, reduced, ts: TS,
    onOwnProgress: p => { S.own = p; },
  });
  // 05/11: con el lazo ligero (móvil) no se habilita el toque hasta tener la animación real del desatado (máx. 7 s)
  S.atlasOk = !player.atlasReady;
  player.atlasReady?.then(() => { S.atlasOk = true; });
  player.ready.then(mode => {
    S.ownReady = true; S.own = 1;
    player.onFirstFrame(() => { gateEl.classList.add('is-bow'); setupBand(); });
    if (mode !== 'gl') { gateEl.classList.add('is-bow'); setupBand(); }
    else if (!player.gpuMasks) {
      // máscaras de los destellos precalculadas (solo sin WebGL2), en tiempo ocioso mientras el lazo respira.
      // PERF: después de que el pergamino 3D termine de montarse (opts.masksAfter), no compitiendo con él en la puerta
      const after = (() => { try { return opts.masksAfter?.(); } catch { return null; } })();
      Promise.race([Promise.resolve(after), new Promise(r => setTimeout(r, after ? 30000 : 0))]).then(() => later(() => {
        const t1 = Math.min(meta.end, (meta.events?.ribbonGone ?? meta.end) + .15), ts = [];
        for (let t = meta.dissolveStart; t <= t1 && ts.length < 18; t += .085) ts.push(+t.toFixed(3));
        player.precomputeMasks(ts);
      }, 1400));
    }
  });

  // cinta prolongada hasta los bordes de la pantalla (pantallas anchas)
  let band = null;
  function setupBand() {
    if (band !== null) return;
    const srcB = player.bandSource;
    band = (srcB && analyzeBand(srcB[0], srcB[1])) || false;
    if (!band) return;
    els.bandL.style.backgroundImage = `url("${band.left}")`;
    els.bandR.style.backgroundImage = `url("${band.right}")`;
    gateEl.style.setProperty('--cg-knot-y', (band.vc * 100).toFixed(2) + '%');
    layoutBand();
    gateEl.classList.add('has-band');
    try { band.masks = raggedMasks(); } catch { band.masks = null; }
  }
  /** Máscaras de "disolución" (mitad opaca · borde deshilachado con motas · mitad transparente) para deshacer la cinta CSS. */
  function raggedMasks() {
    const W = 640, H = 64, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }), im = x.createImageData(W, H), d = im.data, rand = rng(77);
    const oct = [...Array(4)].map(() => [rand() * 6.28, 1 + rand() * 2.5]);
    for (let y = 0; y < H; y++) {
      const yy = y / H;
      let n = 0; for (const [ph, f] of oct) n += Math.sin(yy * f * 6.28 + ph) / f;
      const edge = W / 2 + n * 9 + (rand() - .5) * 6;
      for (let i = 0; i < W; i++) {
        let a = clamp((edge - i) / 7 + .5);                    // borde suave de ~7 px
        if (i < edge && i > edge - 46 && rand() < .16 * (1 - (edge - i) / 46)) a *= rand() * .4;   // motas que se desprenden
        if (i > edge && i < edge + 26 && rand() < .05 * (1 - (i - edge) / 26)) a = .5 + rand() * .5; // polvo suelto
        d[(y * W + i) * 4 + 3] = a * 255;
      }
    }
    x.putImageData(im, 0, 0);
    const L = c.toDataURL('image/png');
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.translate(W, 0); x2.scale(-1, 1); x2.drawImage(c, 0, 0);
    return { l: L, r: c2.toDataURL('image/png') };
  }
  function layoutBand() {
    if (!band) return;
    const r = els.slot.getBoundingClientRect(), w = els.slot.offsetWidth, h = els.slot.offsetHeight;
    for (const [el, side, u] of [[els.bandL, 'l', band.uInL], [els.bandR, 'r', band.uInR]]) {
      const ext = r.left + 2 + u * w;      // del borde de la pantalla hasta donde la cinta del video ya es opaca
      el.style.width = ext > 4 ? ext.toFixed(1) + 'px' : '0px';
      el.style[side === 'l' ? 'left' : 'right'] = (u * w - ext).toFixed(1) + 'px';
      el.style.setProperty('--fade', (w * .03).toFixed(1) + 'px');
      el.style.top = (band.s0 * h).toFixed(1) + 'px'; el.style.height = ((band.s1 - band.s0) * h).toFixed(1) + 'px';
    }
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layoutBand()) : null;
  ro?.observe(els.slot);
  let splitT = 0;
  const onResize = () => { layoutBand(); clearTimeout(splitT); splitT = setTimeout(() => { try { if (!S.opening) splitFlora(gateEl); } catch {} }, 150); };
  addEventListener('resize', onResize, { passive: true });

  // progreso → hilo dorado
  const src = opts.progressSource;
  if (src && typeof src.then === 'function') src.then(() => { S.ext = 1; }, () => { S.ext = 1; });
  const maxWait = opts.maxWait ?? 15000;
  function readExt() {
    let v = S.ext;
    if (typeof src === 'function') { try { v = Math.max(v, clamp(+src() || 0)); } catch {} }
    else if (src && typeof src === 'object' && typeof src.progress === 'number') v = Math.max(v, clamp(src.progress));
    if (now() - S.t0 > maxWait) v = 1;           // nunca se queda atascada
    return (S.ext = v);
  }
  let tickT = now();
  function progressTick() {
    S.raf = 0;
    if (S.disposed) return;
    // COMPAT: suavizado por tiempo real (≈ .07 por cuadro a 60 fps). Antes era por cuadro y en celulares lentos el hilo tardaba
    // muchos segundos en llenarse y el lazo no se podía tocar aunque todo ya estuviera cargado.
    const t = now(), dt = Math.min(.25, Math.max(0, (t - tickT) / 1000)); tickT = t;
    const ext = readExt();
    const target = clamp(ext * .78 + S.own * .22) * (S.ownReady && S.atlasOk ? 1 : .985);
    S.shown += (target - S.shown) * (reduced ? 1 : 1 - Math.exp(-dt * 4.4));
    if (Math.abs(target - S.shown) < .0015) S.shown = target;
    const p = S.shown;
    els.prog.style.strokeDashoffset = String(1 - p);
    if (threadLen) {
      const pt = els.prog.getPointAtLength(p * threadLen);
      els.bead.setAttribute('transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
    }
    els.thread.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    if (!S.ready && ext >= 1 && S.ownReady && S.atlasOk && p > .995) becomeReady();
    if (!S.ready) S.raf = requestAnimationFrame(progressTick);
  }
  S.raf = requestAnimationFrame(progressTick);

  function becomeReady() {
    if (S.ready) return;
    S.ready = true;
    els.prog.style.strokeDashoffset = '0';
    gateEl.classList.add('is-ready', 'is-bow');
    els.bow.removeAttribute('aria-disabled'); els.skip.removeAttribute('aria-disabled');
  }

  // interacción
  const hoverable = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const on = (el, ev, fn, o) => { el.addEventListener(ev, fn, o); offs.push(() => el.removeEventListener(ev, fn, o)); };
  const offs = [];
  if (hoverable) {
    on(els.bow, 'pointerenter', () => { if (S.ready && !S.opening) player.setGlow(1); });
    on(els.bow, 'pointerleave', () => { if (!S.opening) player.setGlow(0); });
  }
  on(els.bow, 'pointerdown', e => {
    if (S.ready && !S.opening) { els.bow.classList.add('is-press'); player.setGlow(1); try { opts.onPress?.(e); } catch {} }
  });
  const unpress = () => { els.bow.classList.remove('is-press'); if (!hoverable && !S.opening) player.setGlow(0); };
  on(els.bow, 'pointerup', unpress); on(els.bow, 'pointercancel', unpress); on(els.bow, 'pointerleave', unpress);
  on(els.bow, 'click', e => { e.preventDefault(); trigger(true); });
  on(els.hint, 'click', () => trigger(true));
  // FIX (red lenta: el lazo tardaba hasta ~1 min en poder tocarse y nada respondía): «Entrar sin música» funciona siempre
  // pasados 8 s, aunque la puerta siga cargando (la página ya sabe esperar a los anillos: foto provisional → 3D)
  on(els.skip, 'click', e => { e.preventDefault(); trigger(false, now() - S.t0 > 8000); });
  later(() => { if (!S.ready && !S.opening) els.skip.removeAttribute('aria-disabled'); }, 8000);
  on(els.bow, 'focus', () => { if (S.ready && !S.opening && els.bow.matches(':focus-visible')) player.setGlow(.8); });
  on(els.bow, 'blur', () => { if (!S.opening) player.setGlow(0); });
  // la puerta es modal: sin scroll por debajo
  const block = e => { if (!S.gone) e.preventDefault(); };
  on(gateEl, 'wheel', block, { passive: false });
  on(gateEl, 'touchmove', block, { passive: false });
  on(document, 'visibilitychange', () => player.pauseIdle(document.hidden));

  function nudge() {
    els.bow.classList.remove('is-nudge'); void els.bow.offsetWidth; els.bow.classList.add('is-nudge');
    later(() => els.bow.classList.remove('is-nudge'), 700);
  }

  function sfx(name) {
    if (!S.withMusic) return;
    try { const fx = opts.sfx || window.__inv?.music?.sfx; fx?.[name]?.(); } catch (e) { console.warn('[gate] sfx', name, e); }
  }

  function trigger(withMusic, force = false) {
    if (S.opening || S.opened || S.disposed) return;
    if (!S.ready && !force) { nudge(); return; }
    S.opening = true; S.withMusic = !!withMusic;
    // 1) dentro del gesto: la canción (INTEGRATE → song.start())
    try { opts.onOpen?.(!!withMusic); } catch (e) { console.warn('[gate] onOpen', e); }
    // 2) también dentro del gesto: el video del desatado
    const playing = player.playOpen();
    sequence(playing).catch(e => { console.warn('[gate] apertura simplificada:', e?.message || e); reveal(); finish(); });
  }

  async function sequence(playing) {
    cancelAnimationFrame(S.raf);
    gateEl.classList.add('is-untie');
    els.bow.classList.remove('is-press');
    els.bow.setAttribute('aria-disabled', 'true'); els.skip.setAttribute('aria-disabled', 'true');
    themeMeta?.setAttribute('content', themeOld || '#120c09');
    if (reduced) {
      const a = gateEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700 / TS, easing: 'ease', fill: 'forwards' });
      reveal();
      await a.finished.catch(() => {});
      return finish();
    }
    player.setGlow(.6);
    await untie(playing);
    await openWrap();
    finish();
  }

  function bowRect() {
    const el = player.canvasEl || els.lift;
    return el.getBoundingClientRect();
  }
  function burstFrom(pts01, o) {
    const r = bowRect();
    const pts = pts01.map(p => ({ x: r.left + p.u * r.width, y: r.top + p.v * r.height }));
    sparks.emit(pts, { cx: r.left + r.width / 2, cy: r.top + r.height * .47, ...o });
  }

  const bandGone = { l: false, r: false };
  function retractBand(side) {
    if (!band || bandGone[side]) return;
    bandGone[side] = true;
    const el = side === 'l' ? els.bandL : els.bandR;
    const r0 = el.getBoundingClientRect();
    if (r0.width < 2) return;
    const sv = v => r0.top + (v - band.s0) / Math.max(1e-3, band.s1 - band.s0) * r0.height;   // fila del cuadro → px
    const y0 = sv(band.v0), y1 = sv(band.v1);
    const L = side === 'l';
    // La cinta se deshace en polvo de oro desde el lazo hacia el borde de la pantalla: un frente deshilachado
    // (máscara con motas) recorre la cinta y suelta destellos. Sin máscaras (navegador viejo): se encoge.
    // (el extremo interior queda bajo la cinta opaca del video: cambiar su fundido por la máscara no se nota)
    const D = (r0.width > 500 ? 1100 : 820) / TS;
    const mk = band.masks?.[side];
    let useMask = false;
    if (mk) {
      el.style.webkitMaskImage = el.style.maskImage = `url("${mk}")`;
      el.style.webkitMaskSize = el.style.maskSize = '200% 100%';
      el.style.webkitMaskRepeat = el.style.maskRepeat = 'no-repeat';
      el.style.webkitMaskPosition = el.style.maskPosition = `${L ? 0 : 100}% 0`;
      const cs = getComputedStyle(el);
      useMask = /url\(/.test(cs.maskImage || '') || /url\(/.test(cs.webkitMaskImage || '');
    }
    if (!useMask) el.animate([{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(0)', opacity: .5 }], { duration: D, easing: 'cubic-bezier(.55,0,.8,.3)', fill: 'forwards' });
    const t0 = now(), big = innerWidth > 900;
    const ease = k => 1 - Math.pow(1 - k, 1.7);              // arranca ya y frena al llegar al borde
    let xPrev = null;
    const tick = () => {
      if (S.disposed) return;
      const k = clamp((now() - t0) / D), e = useMask ? ease(k) : k * k;
      if (useMask) el.style.webkitMaskPosition = el.style.maskPosition = `${((L ? e : 1 - e) * 100).toFixed(2)}% 0`;
      const xEnd = L ? r0.left + r0.width * (1 - e) : r0.right - r0.width * (1 - e);
      // destellos en el frente, en proporción a lo que avanzó (sin acumularse donde arranca)
      const dx = xPrev == null ? 12 : Math.abs(xEnd - xPrev);
      xPrev = xEnd;
      if (xEnd > -20 && xEnd < innerWidth + 20 && dx > .3) {
        const pts = [];
        for (let i = 0; i < 16; i++) pts.push({ x: xEnd + (L ? -1 : 1) * Math.random() * Math.max(10, dx), y: y0 + Math.random() * (y1 - y0) });
        sparks.emit(pts, { n: Math.round(clamp(dx * (big ? .55 : .45), 1, big ? 16 : 10)), vx: L ? -30 : 30, speed: 16, spread: 50, up: 24, buoy: 26, life: 1.4, size: big ? 3 : 2.5, starSize: big ? 11 : 8, star: .1 });
      }
      if (k < 1) requestAnimationFrame(tick);
      else el.style.visibility = 'hidden';
    };
    requestAnimationFrame(tick);
  }

  async function untie(playing) {
    const ok = await playing;
    const big = innerWidth > 900;
    if (ok && (player.mode === 'gl' || player.mode === 'canvas')) {
      const fired = {};
      await new Promise(res => {
        const t0 = now();
        let lastT = -1, lastChange = t0, nextWave = 0, waves = 0, sampling = false;
        const wave = (pts, w) => {
          if (S.disposed) return;
          if (band && relT == null) {   // (sin eventos en el meta) los extremos de la cinta del video se van -> la prolongación CSS también
            const inL = pts.filter(p => p.u < .16 && p.v > band.v0 - .02 && p.v < band.v1 + .02).length;
            const inR = pts.filter(p => p.u > .84 && p.v > band.v0 - .02 && p.v < band.v1 + .02).length;
            if (w === 0) { S.bandL0 = Math.max(1, inL); S.bandR0 = Math.max(1, inR); }
            if (inL < S.bandL0 * .55) retractBand('l');
            if (inR < S.bandR0 * .55) retractBand('r');
          }
          if (pts.length) burstFrom(pts, { n: Math.min(pts.length, (big ? 60 : 34) * (w === 0 ? 1.8 : 1)), speed: big ? 90 : 60, size: big ? 3.6 : 2.8, starSize: big ? 12 : 9, up: 30, life: 1.9 });
        };
        const end = Math.min(meta.end, (player.duration() || meta.end + 1) - .02);
        // el envoltorio empieza a abrirse mientras los últimos destellos del video aún flotan (sin pausa muerta)
        const rg = meta.events?.ribbonGone;
        const openAt = +meta.openAt || (rg ? clamp(rg - .05, end - .8, end - .3) : end - .42);
        // la cinta larga (CSS) se suelta cuando el nudo se abre, antes de que la del video se mueva cerca de la unión
        const relT = meta.bandRelease ?? (meta.events?.knotOpen != null ? meta.events.knotOpen + .06 : null);
        const step = () => {
          if (S.disposed) return res();
          const t = player.openTime(), n = now();
          if (t !== lastT) { lastT = t; lastChange = n; }
          const stalled = n - lastChange > 1200 / TS;
          const tt = stalled ? Math.max(t, (n - t0) * TS / 1000) : t;
          if (!fired.pull && tt >= meta.pullStart) { fired.pull = 1; sfx('ribbonSwish'); }
          if (!fired.knot && tt >= meta.knotGone) { fired.knot = 1; }
          if (relT != null && tt >= relT) { retractBand('l'); retractBand('r'); }
          if (tt >= meta.dissolveStart) {
            if (!fired.dis) { fired.dis = 1; sfx('sparkle'); if (stalled) player.fadeOut(500); }
            if (n >= nextWave && waves < 14 && !sampling && player.abrir) {
              sampling = true; nextWave = n + 85 / TS;
              const w = waves++;
              const pre = player.bankMask(tt);
              (pre ? Promise.resolve(pre) : player.sampleMask()).then(pts => { sampling = false; wave(pts, w); });
            }
          }
          if (tt >= openAt - .1) { retractBand('l'); retractBand('r'); }
          if (tt >= openAt - .45) prepOpen();          // el trabajo de estilos de la apertura, repartido en otro frame
          if (tt >= openAt || player.abrirEnded || n - t0 > (meta.end + 4) * 1000 / TS) { fired.end = 1; return res(); }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      player.fadeOut(560 / TS);
    } else {
      // respaldo: póster/SVG que se suelta con CSS y estalla en destellos
      els.bow.classList.add('is-css-untie');
      later(() => { retractBand('l'); retractBand('r'); }, 500 / TS);
      await sleep(300 / TS); sfx('ribbonSwish');
      await sleep(500 / TS); sfx('sparkle');
      const el = player.canvasEl;
      let pts = el && el.tagName === 'IMG' ? sampleMask(el, 'img') : [];
      if (!pts.length) for (let i = 0; i < 300; i++) { const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * .32; pts.push({ u: .5 + Math.cos(a) * r * 1.3, v: .48 + Math.sin(a) * r * .6 }); }
      for (let w = 0; w < 6; w++) { burstFrom(pts, { n: big ? 90 : 50, speed: big ? 90 : 60, size: big ? 3.6 : 2.8, up: 30, life: 1.9 }); await sleep(110 / TS); }
      await sleep(700 / TS);
    }
  }

  /** Congela las animaciones de las caras (papel estático → las solapas giran sin re-rasterizar) y fija la perspectiva. */
  function prepOpen() {
    if (S.prepped) return;
    S.prepped = true;
    els.stage.style.perspective = Math.round(Math.max(innerWidth * 1.5, innerHeight * 1.1) + 300) + 'px';
    gateEl.classList.add('is-prep');
  }

  async function openWrap() {
    const W = innerWidth, H = innerHeight;
    // Las solapas giran HACIA quien mira (como las puertas de una invitación gatefold). Solo se ven entre 0° y ~80°
    // (después salen de cuadro), así que todo el recorrido ocurre ahí: despegue lento, giro, salida.
    prepOpen();
    gateEl.classList.add('is-opening');
    const uiFade = els.ui.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520 / TS, easing: 'ease-in', fill: 'forwards' });
    uiFade.finished.then(() => { els.ui.style.visibility = 'hidden'; }, () => {});
    sfx('whoosh');
    const D = (W < 700 ? 1800 : 2000) / TS;
    // onReveal (rings.intro / transiciones del hero) cuando las solapas van por la mitad (~0.8–0.9 s): así la llegada de los
    // anillos girando ocurre a la vista y no detrás del papel (antes empezaba a los 0.2 s y casi todo el vuelo quedaba oculto).
    // Las solapas son animaciones de transform en el compositor: un frame largo del hilo principal no las frena.
    later(reveal, D * .45);
    const kf = s => flat ? [
      { transform: 'translate3d(0,0,0)', easing: 'cubic-bezier(.3,0,.25,1)' },
      { transform: `translate3d(${s * -6}%,0,0)`, offset: .18, easing: 'cubic-bezier(.3,0,.25,1)' },
      { transform: `translate3d(${s * -108}%,0,0)` },
    ] : [
      { transform: 'translate3d(0,0,0) rotateY(0deg)', easing: 'cubic-bezier(.3,0,.3,1)' },
      { transform: `translate3d(${s * -.5}%,0,0) rotateY(${s * -5}deg)`, offset: .16, easing: 'cubic-bezier(.45,.02,.3,1)' },
      { transform: `translate3d(0,0,0) rotateY(${s * -88}deg)` },
    ];
    const fade = [{ opacity: 1 }, { opacity: 1, offset: .72 }, { opacity: 0 }];
    const o = { duration: D, fill: 'forwards' };
    const a1 = els.flapL.animate(kf(1), o), a2 = els.flapR.animate(kf(-1), o);
    gateEl.querySelectorAll('.cg-flap__in, .cg-flap__back').forEach(el => el.animate(fade, o)); // (no en .cg-flap: aplanaría el 3D)
    els.shades.forEach(s => s.animate([{ opacity: 0 }, { opacity: .15, offset: .16 }, { opacity: 1, offset: .6 }, { opacity: 1 }], o));
    // sombra que cada solapa proyecta sobre el hero (en su propio plano) y un brillo de luz que cruza el papel al girar
    gateEl.querySelectorAll('.cg-flap__drop').forEach(el => el.animate([{ opacity: 0 }, { opacity: 0, offset: .1 }, { opacity: .9, offset: .38 }, { opacity: .5 }], o));
    gateEl.querySelectorAll('.cg-flap--l .cg-flap__sheen, .cg-flap--r .cg-flap__sheen').forEach((el, i) => el.animate([
      { transform: `translate3d(${i ? 260 : -160}%,0,0)`, opacity: 0 }, { opacity: 0, offset: .14 },
      { opacity: 1, offset: .4 }, { transform: `translate3d(${i ? -160 : 260}%,0,0)`, opacity: 0 },
    ], { ...o, easing: 'cubic-bezier(.4,0,.4,1)' }));
    els.under.animate([{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: .85, offset: .5 }, { opacity: 0 }], o);
    els.light.animate([
      { transform: 'scaleX(.04)', opacity: 0 }, { transform: 'scaleX(.3)', opacity: 1, offset: .16 },
      { transform: 'scaleX(2.2)', opacity: .75, offset: .55 }, { transform: 'scaleX(4.5)', opacity: 0 },
    ], { ...o, easing: 'cubic-bezier(.4,0,.3,1)' });
    // polvo de oro que se escapa por la costura
    const seam = [];
    for (let i = 0; i < 160; i++) seam.push({ x: W / 2 + (Math.random() - .5) * 6, y: Math.random() * H });
    later(() => sparks.emit(seam, { n: W > 900 ? 140 : 80, cx: W / 2, cy: H / 2, speed: 40, spread: 120, up: 20, buoy: 18, life: 1.6, size: W > 900 ? 3.2 : 2.6, star: .14 }), D * .12);
    await Promise.all([a1.finished, a2.finished]).catch(() => {});
  }

  function reveal() {
    if (S.revealed) return;
    S.revealed = true;
    try { opts.onReveal?.(); } catch (e) { console.warn('[gate] onReveal', e); }
  }

  function finish() {
    if (S.opened) return;
    S.opened = true; S.opening = false;
    gateEl.style.pointerEvents = 'none';
    gateEl.setAttribute('aria-hidden', 'true');
    themeMeta?.setAttribute('content', themeOld || '#120c09');
    // FIX: liberar el video y su contexto WebGL bloquea ~150 ms el hilo (loseContext + cierre del decodificador); justo
    // ahora los anillos están llegando: se hace más tarde, cuando la intro y los nombres ya terminaron (o al dispose()).
    player.halt();
    later(() => player.dispose(), 9000 / TS);
    try { opts.onOpened?.(); } catch (e) { console.warn('[gate] onOpened', e); }
    // deja terminar los destellos y luego la puerta desaparece del todo
    const wait = () => {
      if (S.disposed) return;
      if (sparks.count > 0 && now() - S.finishT < 2600) return later(wait, 120);
      S.gone = true;
      gateEl.classList.add('is-gone');
      sparks.dispose();
    };
    S.finishT = now();
    wait();
  }

  const api = {
    setProgress(p) { S.setCalled = true; S.ext = Math.max(S.ext, clamp(+p || 0)); },
    /** Abre por código (sin gesto no habrá audio). */
    open(withMusic = false) { trigger(withMusic, true); },
    /** Quita la puerta al instante (para ?skipgate=1 / capturas). */
    skip() {
      if (S.opened) return;
      S.opening = true;
      try { opts.onOpen?.(false); } catch {}
      reveal();
      gateEl.classList.add('is-gone');
      S.gone = true;
      finish();
    },
    dispose() {
      if (S.disposed) return;
      S.disposed = true;
      cancelAnimationFrame(S.raf);
      S.timers.forEach(clearTimeout);
      offs.forEach(f => f());
      ro?.disconnect(); removeEventListener('resize', onResize);
      player.dispose(); sparks.dispose();
      themeMeta?.setAttribute('content', themeOld || '#120c09');
      paperP.then(urls => urls.forEach(u => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); }));
      styleEl.remove();
      gateEl.innerHTML = '';
      gateEl.className = 'cgate is-gone';
    },
    get ready() { return S.ready; },
    get opened() { return S.opened; },
    get opening() { return S.opening; },
    get mode() { return player.mode; },
    get fps() { return player.fps; },
    get progress() { return S.shown; },
    meta: () => meta,
    timing,
    debug: { player, sparks, els, get band() { return band; } },
  };
  if (window.__inv && typeof window.__inv === 'object') window.__inv.gate = api;
  void html;
  return api;
}

export default mountGate;
