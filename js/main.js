// WEB-SHELL + INTEGRATE · orquestación de la invitación "Pergamino 3D" de Josué & Marjhory.
// Carga los módulos con import() dinámico (con alternativas): puerta crema con el lazo (gate.js), canción del usuario
// (song.js + SFX de music.js), tipografía cinética (kinetic.js), anillos 3D (rings3d.js) y pergamino 3D (scroll3d.js).
// Parámetros de prueba:
//   ?stubs=1   usa tests/stubs/*.js en lugar de los módulos reales
//   ?nogl=1    fuerza el modo sin WebGL (imágenes + pergamino HTML)
//   ?reduced=1 fuerza movimiento reducido
//   ?skipgate=1 entra directamente (sin música) — para capturas
//   ?pluma=0   quita la pluma visible de js/pluma.js (por defecto se engancha a scroll3d con attachQuill)
// ESCENA (decisión n.º 5): el pergamino se abre solo al quedar fija su sección, el scroll guía la secuencia (setScrollProgress,
// ritmo = max(tiempo, scroll) con tope) y la sección no se suelta hasta que todo está escrito y con los CTA (parchBrake).
import * as C from './content.js';
import { device } from './device.js?v=20261104b';
import { createSong } from './song.js?v=20261104b';
import { initGrain, initFiber, initDust, initGlow } from './shell-fx.js';
import { buildParchmentCard, fillA11yCopy, buildIcsHref, initGallery, initCountdown, initMusicButton } from './shell-ui.js';
import { splitLetters, layoutLetters, initReveals, revealGallery, revealCountdown } from './shell-reveal.js';

const { COUPLE, EVENT, PARCHMENT_TEXT, MOMENTS } = C;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const html = document.documentElement;

const qs = new URLSearchParams(location.search);
const STUBS = qs.has('stubs');
const MOD = STUBS ? '../tests/stubs/' : './';
// Honor the system motion preference; the botanical border stays fully visible without movement.
const SOFT = false;
const REDUCED = qs.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
if (SOFT) html.classList.add('soft-motion');
const gsap = window.gsap || null;
const ScrollTrigger = window.ScrollTrigger || null;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger); else html.classList.add('no-gsap');
if (REDUCED) html.classList.add('reduced');
// FIX: ya no se crea un contexto WebGL de prueba al cargar (costaba ~0.65 s antes de pintar la puerta). rings3d.js y
// scroll3d.js detectan solos la falta de WebGL o el render por software (SwiftShader, llvmpipe…) y fallan → imagen/tarjeta HTML.
const NO_GL = device.light;
// FIX ronda 1 · ?diag=1: tarjeta de diagnóstico (js/diag.js) para saber por qué un celular concreto no ve la animación completa.
// Se guardan desde ya los avisos de los módulos ([inv], [final], [historia], …) para mostrarlos con su motivo.
if (qs.has('diag')) {
  const L = window.__invLog = [];
  for (const k of ['warn', 'info']) {
    const o = console[k];
    console[k] = (...a) => { try { const t = a.map(x => (x?.message || String(x))).join(' '); if (/^\[(inv|final|historia|gate|scroll3d|rings|escritura|mapa|pluma|song|music)/.test(t)) { L.push(t.slice(0, 180)); if (L.length > 30) L.shift(); } } catch {} return o.apply(console, a); };
  }
  addEventListener('error', e => { L.push('error: ' + String(e.message || e.error).slice(0, 160)); });
  addEventListener('unhandledrejection', e => { L.push('promesa: ' + String(e.reason?.message || e.reason).slice(0, 160)); });
}
// FIX compatibilidad (iPhone con iOS < 16.4, Chrome < 89): sin import maps. three se pide por URL completa (ESM de jsDelivr con
// versión fija), la MISMA en rings3d, scroll3d, pluma, historia3d y final3d → una sola instancia de three en la página.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
const HAS_GL2 = typeof WebGL2RenderingContext !== 'undefined';

// FIX: lo que la puerta necesita para abrirse (videos del lazo y anillos del hero) empieza a bajar ya, con prioridad, en vez de
// competir con el pergamino y la canción. Se añade desde aquí (no en el HTML) para no precargar nada que este modo no use.
const PRELOADED = [];
(() => {
  if (STUBS) return;
  const pre = (href, mod) => { const l = document.createElement('link'); l.rel = mod ? 'modulepreload' : 'preload'; if (!mod) l.as = 'fetch'; l.crossOrigin = 'anonymous'; l.href = href; document.head.append(l); if (!mod) PRELOADED.push(href); };
  // FIX (datos móviles): los videos del lazo solo sirven si la puerta puede componerlos (WebGL); los anillos, si hay WebGL 2.
  // Antes se precargaban siempre (2.6 MB + 2.2 MB) justo en los teléfonos que acaban viendo imágenes.
  // COMPAT-FLUIDEZ: WebKit (iPhone/iPad con cualquier navegador, Safari de Mac) no reutiliza la precarga `as=fetch` para el
  // fetch() de gate.js ni el de GLTFLoader: medido en WebKit (shots/compat/wkpre.mjs), cada video y cada anillo bajaba DOS
  // veces (≈ 4.8 MB de más en datos móviles, y más espera en la puerta). Ahí se piden solo una vez, cuando se usan.
  const ua = navigator.userAgent || '';
  const dupPreload = /iP(hone|ad|od)/.test(ua) || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|Android/.test(ua)) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!device.ribbonLite && !REDUCED && !dupPreload && typeof WebGLRenderingContext !== 'undefined') { pre('assets/video/lazo_reposo_alpha.mp4'); pre('assets/video/lazo_abrir_alpha.mp4'); }
  if (!NO_GL && HAS_GL2) { pre(THREE_URL, true); if (!dupPreload) { pre('assets/models/anillos/ring-halo.glb'); pre('assets/models/anillos/ring-jonc.glb'); } }
})();

const els = {
  gate: $('#gate'),
  hero: $('#inicio'), ringsStage: $('#rings-stage'), heroContent: $('.hero__content'), heroInner: $('.hero__inner'),
  names: $('.hero__names'), parch: $('#pergamino'), scrollStage: $('#scroll-stage'), parchHead: $('.parch__head'),
  hint: $('#abrir-pergamino'), ctas: $('#parch-ctas'), fallback: $('#parch-fallback'), a11y: $('#invitacion-texto'),
  reader: $('#lectura'), readerCard: $('#reader-card'), musicBtn: $('#musica'), dust: $('.fx-dust'),
  cue: $('#parch-cue'),
};

const state = {
  music: null, rings: null, scroll: null, ready: false, entered: false, revealed: false,
  opening: false, opened: false, parchVisible: null, fallbackRings: false, fallbackScroll: false, fallbackCard: null,
  busyUntil: 0, scrollProg: 0,
  // PERF: scrollReadyAt = cuándo quedó listo el pergamino 3D (0 = montándose); namesDone = terminó el revelado de los nombres
  // PERF-RETOMA: scrollBeat = ratos ociosos que pidió el montaje del pergamino (latido para withStall)
  scrollReadyAt: 0, namesDone: false, scrollBeat: 0,
};
let resolveReady;
const inv = window.__inv = {
  music: null, song: null, rings: null, scroll: null, gate: null, kinetic: null, ready: false,
  whenReady: new Promise(r => (resolveReady = r)),
  shell: { state, enter: (m = false) => enter(m), open: () => openParchment('api'), reduced: REDUCED, soft: SOFT, noGL: NO_GL, stubs: STUBS },
};

/* ------------------------------------------------------------------------ */
/* Utilidades                                                                */
/* ------------------------------------------------------------------------ */
/** Vibración breve (Android; iOS la ignora) solo si el invitado entró con música y sin movimiento reducido. */
function haptic(pattern) {
  if (REDUCED || !state.music?.playing) return;
  try { navigator.vibrate?.(pattern); } catch {}
}
/** Objeto de música para scroll3d: el mismo, con un "clic" háptico al quebrarse el lacre. */
function withHaptics(m) {
  if (!m || typeof Proxy !== 'function') return m;
  const sfx = new Proxy(m.sfx || {}, { get: (t, k) => (k === 'sealCrack' ? (...a) => { haptic([14, 40, 22]); return t.sealCrack?.(...a); } : t[k]) });
  return new Proxy(m, { get: (t, k) => { if (k === 'sfx') return sfx; const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } });
}
const withTimeout = (p, ms, label) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${label}: tiempo de espera agotado`); })]);
/** PERF-RETOMA: como withTimeout, pero solo falla si `prog()` no cambia en `stallMs` (o pasan `maxMs` en total). Si la promesa
 *  original resuelve después de fallar, su resultado se libera con dispose(). */
function withStall(p, prog, stallMs, maxMs, label) {
  let failed = false;
  p.then(v => { if (failed) { try { v?.dispose?.(); } catch {} } }, () => {});
  return new Promise((res, rej) => {
    // (solo cuenta el tiempo con la pestaña visible: en segundo plano el navegador frena los ratos ociosos del montaje)
    let last = prog(), still = 0, total = 0, prev = performance.now();
    const iv = setInterval(() => {
      const now = performance.now(), dt = Math.min(now - prev, 2000), v = prog();
      prev = now;
      if (document.hidden) return;
      total += dt; still += dt;
      if (v !== last) { last = v; still = 0; }
      if (still > stallMs || total > maxMs) {
        clearInterval(iv); failed = true;
        rej(new Error(`${label}: sin avance (${Math.round(total / 1000)} s, progreso ${(+last || 0).toFixed(2)})`));
      }
    }, 1000);
    p.then(v => { clearInterval(iv); if (!failed) res(v); }, e => { clearInterval(iv); if (!failed) rej(e); });
  });
}
/** letter-spacing en px (GSAP convierte mal "em" en letter-spacing). Sin em → valor actual del CSS. */
const spacing = (el, em) => (em == null ? getComputedStyle(el).letterSpacing : (parseFloat(getComputedStyle(el).fontSize) * em).toFixed(2) + 'px');
const getPath = path => path.split('.').reduce((o, k) => (o == null ? o : o[k]), C);

/** Todos los textos visibles salen de content.js (el HTML lleva el mismo texto como respaldo). */
function hydrateText() {
  $$('[data-c]').forEach(el => {
    const v = getPath(el.dataset.c);
    if (typeof v === 'string' && el.textContent !== v) el.textContent = v;
  });
  $('#cta-mapa').href = EVENT.mapUrl;
}

/* ------------------------------------------------------------------------ */
/* Progreso de carga (lo dibuja la puerta: hilo dorado de gate.js)           */
/* ------------------------------------------------------------------------ */
// FIX: la puerta solo espera lo que necesita para abrirse bien (sus videos, los anillos y las fuentes). El pergamino
// (≈7 MB) se descarga después y hace su trabajo pesado en tiempo ocioso (ver idleSlot), nunca durante la apertura.
const prog = { rings: 0, music: 0, fonts: 0 };
const weight = { rings: .8, music: .06, fonts: .14 };
let forced = 0;
const targetProgress = () => Math.max(forced, Object.keys(prog).reduce((a, k) => a + clamp(prog[k]) * weight[k], 0));

/* ------------------------------------------------------------------------ */
/* Carga de módulos                                                          */
/* ------------------------------------------------------------------------ */
/** The song is ready independently of optional synthesized effects and musical analysis. */
async function loadMusic() {
  try {
    state.music = inv.music = inv.song = await createSong({ nativeAudio: device.mobile });
    // The song is available before importing or synthesizing optional effects.
    import(MOD + 'music.js').then(mm => {
      state.music?.attachMusic?.(sfxOnlyAfterStart(mm.createMusic({ background: false, idle: idleSlot })));
    }).catch(e => console.warn('[inv] SFX no disponibles:', e?.message || e));
  } catch (e) {
    console.warn('[inv] canción no disponible:', e?.message || e);
  }
  prog.music = 1;
  return state.music;
}

/** Los SFX (lacre, satén, papel…) solo suenan si el invitado eligió sonido: callan hasta que la canción arranca
 *  (lazo con música o botón #musica). Así "Entrar sin música" es de verdad silencioso y no crea audio sin necesidad. */
function sfxOnlyAfterStart(raw) {
  let on = false;
  const sfx = {};
  for (const k of Object.keys(raw.sfx)) sfx[k] = (...a) => { if (on) return raw.sfx[k](...a); };
  return {
    start(...a) { on = true; return raw.start(...a); },
    setMuted: m => raw.setMuted(m),
    toggle: () => raw.toggle(),
    duck: (a, s) => raw.duck(a, s),
    onBeat: cb => raw.onBeat(cb),
    sfx,
    get playing() { return raw.playing; },
    get muted() { return raw.muted; },
    get analyser() { return raw.analyser; },
    get context() { return raw.context; },
    dispose: () => raw.dispose(),
  };
}

/** Tipografía cinética sincronizada con la canción (opcional: si falla, la página sigue igual). */
async function loadKinetic(music) {
  if (device.light) return null;
  try {
    const { mountKinetic } = await import('./kinetic.js');
    kinetic = inv.kinetic = mountKinetic({ song: music || undefined, reducedMotion: REDUCED });
    // PERF: las letras de los nombres no respiran ni brillan con la canción mientras GSAP las revela (revealHero las suelta)
    if (!state.namesDone) kinetic.hold?.(els.names, true);
    kinetic.setStage(state.entered ? 'hero' : 'gate');
    if (state.kineticTrack) startKineticTrack();
  } catch (e) { console.warn('[inv] tipografía cinética no disponible:', e?.message || e); }
  return kinetic;
}
function startKineticTrack() {
  state.kineticTrack = true;
  kinetic?.track?.({ hero: '#inicio', pergamino: '#pergamino', historia: '#historia', momentos: '#momentos', final: '#final' });
}

async function loadRings() {
  if (NO_GL) { ringsFallback(); prog.rings = 1; return null; }
  try {
    const m = await import(MOD + 'rings3d.js?v=20261104b');
    const mounting = m.mountRings(els.ringsStage, {
      reducedMotion: REDUCED,
      onProgress: p => { prog.rings = clamp(p) * .98; },
      onClink: () => onClink(),
    });
    // FIX (red lenta): antes withTimeout(25 s) fijo → en 3G saltaba ANTES de que el lazo se pudiera tocar (foto fija en vez de
    // la llegada y el clink) y el montaje seguía: un renderer "zombi" fuera de la página dibujando sin parar (40–95 MB de GPU).
    // Ahora solo falla si la descarga/montaje no avanza en 20 s (o 3 min en total); bajo la puerta no se rinde (la puerta los
    // tapa). Si llegan tarde, withStall los libera.
    const r = await withStall(mounting, () => (state.entered ? prog.rings : performance.now()), 20000, 180000, 'anillos');
    if (state.fallbackRings) { try { r.dispose(); } catch {} return null; }
    state.rings = inv.rings = r;
    watchLost(els.ringsStage, () => { if (state.rings === r) ringsFallback(); }, 'anillos');
    // FIX: bajo la puerta (opaca) no se dibuja nada: se reanuda al tocar el lazo (enter)
    if (!state.entered) { try { r.pause(); } catch {} }
    prog.rings = 1;
    lastHeroP = -1; onScroll();
    return r;
  } catch (e) {
    console.warn('[inv] anillos 3D no disponibles, uso imagen:', e?.message || e);
    ringsFallback(); prog.rings = 1; return null;
  }
}

async function loadScroll() {
  if (NO_GL) { scrollFallback(); state.scrollProg = 1; return null; }
  try {
    await idleSlot();
    const m = await import(MOD + 'scroll3d.js?v=20261104b');
    const mounting = m.mountScroll(els.scrollStage, {
      music: withHaptics(state.music) || undefined,
      reducedMotion: REDUCED, softMotion: SOFT,
      // (cada rato ocioso que pide el montaje — lazo, pergamino, franjas, compilación — es un latido: está avanzando)
      idle: () => { state.scrollBeat++; return idleSlot(); },
      onProgress: p => { state.scrollProg = clamp(p); els.hint.style.setProperty('--prep', state.scrollProg.toFixed(3)); },
      onOpened: () => handleOpened(),
    });
    // PERF-RETOMA: en un móvil lento con red lenta el montaje puede pasar de 60 s sin estar colgado (medido: 26–60 s con
    // CPU ×4 y 1.1 MB/s). Se abandona solo si ni el progreso ni los latidos (ratos ociosos pedidos) cambian en 40 s, o a los
    // 4 min de pestaña visible; si el 3D llega después, se libera.
    const s = await withStall(mounting, () => state.scrollProg + state.scrollBeat, 40000, 240000, 'pergamino');
    // PERF-RETOMA: si mientras tanto ya se pasó a la tarjeta HTML (el invitado pidió abrir y esperó 20 s), el 3D que llega
    // tarde se libera (antes quedaba dibujando en un lienzo ya quitado de la página)
    if (state.fallbackScroll) { try { s.dispose(); } catch {} return null; }
    state.scroll = inv.scroll = s;
    watchLost(els.scrollStage, () => {
      if (state.scroll !== s) return;
      // la sección deja de ser fija (la página se acorta): si el invitado estaba en el pergamino, se le deja en la tarjeta;
      // si se estaba abriendo (su reloj ya no avanza sin dibujar), la tarjeta se abre
      const wasOpening = state.opening && !state.opened;
      scrollFallback(); // (compensa el scroll: quien estaba en el pergamino queda frente a la tarjeta)
      if (wasOpening) { state.opening = false; openParchment('auto'); }
    }, 'pergamino');
    state.scrollReadyAt = performance.now();
    els.scrollStage.classList.add('is-live');
    parchWait(false);
    measureParchSafe(); // ESCENA: zona de los CTA / botón de música para el encuadre de lectura y el final
    state.parchVisible = null; onScroll();
    loadQuill(s);
    return s;
  } catch (e) {
    console.warn('[inv] pergamino 3D no disponible, uso tarjeta HTML:', e?.message || e);
    scrollFallback(); return null;
  }
}

/** ESCENA · pluma visible (js/pluma.js de PLUMA-WEB) enganchada a scroll3d con attachQuill (precompila, coloca el tintero en
 *  su lugar reservado y la mueve con la escritura). UNIR: activa por defecto; ?pluma=0 la quita (pluma invisible).
 *  Si falla, la escritura sigue con la pluma invisible. */
const QUILL_ON = qs.get('pluma') !== '0';
async function loadQuill(s) {
  if (!QUILL_ON || !s?.attachQuill) return;
  try {
    const [{ createQuill }, THREE] = await Promise.all([import('./pluma.js'), import(THREE_URL)]);
    await idleSlot();
    const q = await createQuill({ THREE, parchment: s.parchment, reducedMotion: REDUCED, music: state.music || undefined, light: s.debug?.key });
    if (state.scroll !== s) { try { q.dispose?.(); } catch {} return; }
    await s.attachQuill(q);
  } catch (e) { console.warn('[inv] pluma no disponible:', e?.message || e); }
}

/** Trabajo pesado de fondo (montar el pergamino): espera a que no haya una animación protagonista en curso (desde el toque
 *  del lazo hasta que los nombres terminan de aparecer) y a un momento ocioso del navegador. Si el invitado ya está mirando
 *  la sección del pergamino, no espera más.
 *  PERF: (1) se vuelve a comprobar DENTRO del requestIdleCallback (si el invitado tocó el lazo mientras esperaba, el paso
 *  pesado ya no cae en pleno desatado); (2) resuelve con el IdleDeadline (o null) para que quien llama trocee su trabajo
 *  según deadline.timeRemaining(). */
function idleSlot() {
  return new Promise(res => {
    const blocked = () => state.busyUntil > performance.now() && !state.parchVisible;
    const go = () => {
      const busy = state.busyUntil - performance.now();
      if (busy > 0 && !state.parchVisible) { setTimeout(go, Math.min(busy + 40, 500)); return; }
      // PERF: si el invitado ya mira la sección (o pidió abrir), no se esperan ratos ociosos (con otros bucles activos
      // llegaban cada ~350 ms y el montaje tardaba 15 s): un tramo de ~8 ms justo después de pintar cada cuadro
      // FIX (móvil lento): también cuando el invitado ya baja hacia el pergamino (pasó un tercio del hero): antes el montaje
      // seguía en ratos ociosos y la sección quedaba fija mostrando solo el póster hasta ~50 s
      if (state.parchVisible || state.opening || (state.revealed && lastHeroP > .3)) { requestAnimationFrame(() => setTimeout(() => res(budget(8)), 0)); return; }
      if (typeof requestIdleCallback === 'function') requestIdleCallback(dl => (blocked() ? go() : res(dl)), { timeout: 350 });
      else setTimeout(() => (blocked() ? go() : res(budget(6))), 30);
    };
    go();
  });
}
/** Plazo sintético con la forma de IdleDeadline (ms de trabajo permitidos desde ahora). */
const budget = ms => { const end = performance.now() + ms; return { didTimeout: false, timeRemaining: () => Math.max(0, end - performance.now()) }; };

/* ------------------------------------------------------------------------ */
/* PERF · pergamino 3D en preparación: marcador visual + botón "preparando"  */
/* ------------------------------------------------------------------------ */
// Mientras scroll3d se monta (en ratos ociosos) su sección puede quedar a la vista: en vez de un fondo vacío se ve el render
// de Blender del pergamino cerrado (atenuado) y el botón muestra un anillo de progreso. Al quedar listo, el lienzo 3D aparece
// con un fundido encima y el marcador se desvanece. Estilos inyectados aquí (estado transitorio de main.js).
let waitEl = null;
function injectPerfCss() {
  if (document.getElementById('perf-css')) return;
  const s = document.createElement('style');
  s.id = 'perf-css';
  s.textContent = `
.parch-wait{position:absolute;inset:0;z-index:0;overflow:hidden;opacity:0;transition:opacity .9s ease;cursor:pointer;-webkit-tap-highlight-color:transparent}
.parch-wait.is-on{opacity:1}
.parch-wait.is-off{opacity:0;pointer-events:none}
.parch-wait img{position:absolute;left:-2%;top:-2%;width:104%;height:104%;object-fit:cover;filter:saturate(.95) blur(2.5px)}
.parch-wait::after{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 55% 45% at 50% 58%,rgba(255,176,96,.16),rgba(255,176,96,0) 70%);animation:pw-breathe 3.4s ease-in-out infinite}
@keyframes pw-breathe{50%{opacity:.35}}
.hint.is-preparing .hint__seal::after{content:'';position:absolute;inset:-7px;border-radius:50%;pointer-events:none;
  background:conic-gradient(from -90deg,var(--gold-hi,#f6e3b4) calc(var(--prep,0) * 1turn),rgba(214,186,132,.18) 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1.5px));
  mask:radial-gradient(farthest-side,transparent calc(100% - 2px),#000 calc(100% - 1.5px))}
.hint.is-waiting{pointer-events:none}
.hint.is-waiting .hint__seal{animation:pw-wait 1.25s ease-in-out infinite}
.hint.is-waiting .hint__seal i{opacity:0}
@keyframes pw-wait{50%{transform:scale(.9);filter:brightness(1.3)}}
html.reduced .parch-wait::after,html.reduced .hint.is-waiting .hint__seal{animation:none}`;
  document.head.append(s);
}
/** on = true: muestra el marcador (si el 3D aún no está); false: lo desvanece y lo quita. */
function parchWait(on) {
  if (on) {
    if (waitEl || state.scroll || state.fallbackScroll) return;
    injectPerfCss();
    waitEl = document.createElement('div');
    waitEl.className = 'parch-wait'; waitEl.setAttribute('aria-hidden', 'true');
    const img = new Image();
    img.alt = ''; img.decoding = 'async';
    img.src = innerWidth / Math.max(1, innerHeight) < .8 ? 'assets/render/poster_movil.jpg' : 'assets/render/poster.jpg';
    waitEl.append(img);
    waitEl.addEventListener('click', () => openParchment('seal'));
    els.scrollStage.prepend(waitEl);
    const show = () => requestAnimationFrame(() => waitEl?.classList.add('is-on'));
    (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(show);
    return;
  }
  setHintPreparing(false);
  if (!waitEl) return;
  const el = waitEl; waitEl = null;
  el.classList.add('is-off');
  setTimeout(() => el.remove(), 1100);
}
function setHintPreparing(on) {
  if (on) { injectPerfCss(); els.hint.classList.add('is-preparing'); els.hint.setAttribute('aria-busy', 'true'); return; }
  els.hint.classList.remove('is-preparing', 'is-waiting');
  els.hint.removeAttribute('aria-busy');
}

/* ------------------------------------------------------------------------ */
/* Alternativas sin WebGL                                                    */
/* ------------------------------------------------------------------------ */
/** UNIR (compatibilidad móvil): iOS y Android pueden quitarle a la página un contexto WebGL por memoria (varias escenas 3D,
 *  pestaña en segundo plano). historia3d, final3d y la puerta ya pasan a su imagen; los anillos y el pergamino quedaban en
 *  negro. Ahora pasan a la imagen / tarjeta HTML (si el pergamino ya estaba abierto, la tarjeta queda abierta). */
function watchLost(stage, fallback, label) {
  for (const c of stage.querySelectorAll('canvas')) {
    c.addEventListener('webglcontextlost', () => {
      console.warn('[inv] ' + label + ': contexto WebGL perdido, uso la alternativa');
      setTimeout(() => { try { fallback(); } catch (e) { console.warn('[inv] alternativa:', e?.message || e); } }, 0);
    }, { once: true });
  }
}

function ringsFallback() {
  if (state.fallbackRings) return;
  state.fallbackRings = true;
  // PERF: si los anillos 3D ya se veían, la imagen aparece debajo y el lienzo se desvanece en 0.8 s (antes: corte en seco)
  const old = state.rings;
  state.rings = inv.rings = null;
  // (si los anillos no llegaron a pedir sus modelos precargados, se consumen para que el navegador no avise de una precarga sin usar)
  for (const u of PRELOADED) if (/anillos/.test(u)) fetch(u).then(r => r.arrayBuffer()).catch(() => {});
  const st = els.ringsStage;
  st.classList.add('is-fallback');
  const canvases = [...st.querySelectorAll('canvas')];
  const live = !!old && canvases.length > 0 && !REDUCED;
  const retire = () => { try { old?.dispose(); } catch {} canvases.forEach(c => c.remove()); };
  if (!live) retire();
  const svg = () => {
    st.insertAdjacentHTML('beforeend', `<svg class="stage__svg" viewBox="0 0 400 260" aria-hidden="true">
      <defs><linearGradient id="fr-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbeccb"/><stop offset=".4" stop-color="#d6ba84"/><stop offset=".7" stop-color="#9c733f"/><stop offset="1" stop-color="#f2dca8"/></linearGradient>
      <radialGradient id="fr-s"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="165" cy="140" rx="82" ry="84" fill="none" stroke="url(#fr-g)" stroke-width="9"/>
      <ellipse cx="238" cy="140" rx="82" ry="84" fill="none" stroke="url(#fr-g)" stroke-width="7"/>
      <path d="M165 40l12 14-12 14-12-14z" fill="#fffaf0" stroke="#d6ba84" stroke-width="1.5"/>
      <circle cx="171" cy="48" r="16" fill="url(#fr-s)" opacity=".8"/></svg>`);
  };
  const img = new Image();
  img.className = 'stage__img'; img.alt = ''; img.decoding = 'async';
  let faded = false;
  const fadeIn = () => {
    if (faded) return; faded = true;
    requestAnimationFrame(() => {
      img.classList.add('is-in');
      if (live) { canvases.forEach(c => { c.style.transition = 'opacity .8s ease'; c.style.opacity = '0'; }); setTimeout(retire, 850); }
    });
  };
  img.onload = fadeIn;
  img.onerror = () => {
    if (!img.dataset.alt) { img.dataset.alt = '1'; img.src = 'assets/render/poster.jpg'; }
    else { img.remove(); svg(); if (live) retire(); }
  };
  img.src = 'assets/render/anillos/pareja.jpg';
  st.prepend(img); // debajo del lienzo (los dos son absolutos: manda el orden)
}

function scrollFallback() {
  if (state.fallbackScroll) return;
  state.fallbackScroll = true;
  parchWait(false);
  // FIX: la sección pasa de 520vh (+ freno) a alto automático. Sin compensar, quien estaba dentro aparecía de golpe en
  // #momentos o #final (se saltaba la tarjeta y la historia) y quien estaba más abajo dependía del anclaje de scroll de Chrome
  // (Safari no lo tiene). Se desactiva el anclaje del navegador durante el cambio y se compensa a mano.
  const r0 = els.parch.getBoundingClientRect(), y0 = scrollY;
  const anchor = document.scrollingElement || html, prevAnchor = anchor.style.overflowAnchor;
  anchor.style.overflowAnchor = 'none';
  const wasOpen = state.opened;
  if (state.scroll) { try { state.scroll.dispose(); } catch {} state.scroll = inv.scroll = null; }
  els.parch.classList.add('is-fallback');
  els.scrollStage.classList.remove('is-live');
  els.scrollStage.querySelectorAll('canvas').forEach(c => c.remove());
  const card = buildParchmentCard(PARCHMENT_TEXT, { closed: true, escritura: !wasOpen });
  card.setAttribute('aria-hidden', 'true');
  els.fallback.append(card);
  els.fallback.hidden = false;
  state.fallbackCard = card;
  const seal = card.querySelector('.pcard__seal');
  seal?.setAttribute('tabindex', '-1'); // el control accesible es #abrir-pergamino
  seal?.addEventListener('click', () => openParchment('seal'));
  if (wasOpen) { card.classList.remove('is-closed'); card.removeAttribute('aria-hidden'); }
  void els.parch.offsetHeight;
  const r1 = els.parch.getBoundingClientRect();
  if (r0.bottom <= 0) {
    // estaba más abajo: lo que mira no se mueve
    const want = y0 + (r1.height - r0.height);
    if (Math.abs(scrollY - want) > 1) scrollTo(0, Math.max(0, want));
  } else if (r0.top <= 0 && r0.bottom > 0) {
    // estaba dentro de la sección fija: queda frente a la tarjeta (abierta si el 3D ya se abría)
    try { card.scrollIntoView({ block: 'start' }); } catch {}
  }
  requestAnimationFrame(() => { anchor.style.overflowAnchor = prevAnchor; });
  ScrollTrigger?.refresh();
}

/** Red de seguridad (GPU muy débil o render por software no detectado): anillos → imagen, pergamino → tarjeta HTML.
 *  PERF (falso positivo de la ronda 1): el fps de rAF baja también cuando el HILO PRINCIPAL se atasca con trabajo nuestro
 *  (montaje del pergamino, revelados); eso no es una GPU débil. Ahora un segundo solo cuenta como "bajo" si:
 *   · la página está lista (inv.ready), el pergamino ya no se está montando y pasaron 2 s desde que quedó listo;
 *   · en ese segundo no hubo un long-animation-frame > 100 ms de OTRO código (los del propio módulo sí cuentan: si su
 *     dibujo es lo lento, es la GPU) ni el temporizador llegó tarde (hilo bloqueado);
 *   · y el fps del módulo está por debajo de 12.
 *  Hacen falta 5 segundos SEGUIDOS y, antes de cambiar, se confirma midiendo el coste real de GPU del módulo
 *  (gpuCost: cuadros con sincronización forzada): solo si pasa de 55 ms por cuadro se usa la alternativa (con fundido). */
function watchFps() {
  // own: módulo cuyo script dominó el frame; 'gpu' = frame largo SIN trabajo de JS que bloquee (esperando a la GPU o al
  // compositor: eso sí es lo que esta red de seguridad busca); null = trabajo de otro código (o longtask sin atribución)
  const longs = [];
  try {
    const po = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        if (e.duration < 100) continue;
        let own = null, best = 0, js = 0;
        for (const s of e.scripts || []) {
          const u = s.sourceURL || '', d = s.duration || 0;
          js += d;
          if (d > best) { best = d; own = /rings3d\.js/.test(u) ? 'rings' : /scroll3d\.js|parchment\.js|ribbon\.js/.test(u) ? 'scroll' : null; }
        }
        if (e.entryType === 'long-animation-frame' && (js < 50 || (e.blockingDuration ?? 0) < 50)) own = 'gpu';
        longs.push({ end: e.startTime + e.duration, own });
      }
    });
    try { po.observe({ type: 'long-animation-frame', buffered: false }); } catch { po.observe({ type: 'longtask', buffered: false }); }
  } catch {}
  const foreignLong = (t0, t1, who) => longs.some(l => l.end >= t0 && l.end <= t1 + 60 && l.own !== who && l.own !== 'gpu');
  const low = { rings: 0, scroll: 0 };
  let last = performance.now();
  const check = (who, mod, cond, fallback) => {
    if (!cond) { low[who] = 0; return; }
    low[who] = mod.fps > 0 && mod.fps < 12 ? low[who] + 1 : 0;
    if (low[who] < 5) return;
    low[who] = 0;
    let ms = null;
    try { ms = typeof mod.gpuCost === 'function' ? mod.gpuCost(3) : null; } catch {}
    const name = who === 'rings' ? 'anillos' : 'pergamino';
    if (ms != null && ms < 55) { console.info(`[inv] ${name}: fps bajo pero la GPU dibuja en ${ms} ms: se mantiene el 3D`); return; }
    console.info(`[inv] ${name} a ${mod.fps} fps (GPU ${ms ?? '?'} ms/cuadro): uso la alternativa`);
    fallback();
  };
  setInterval(() => {
    const now = performance.now(), t0 = last; last = now;
    while (longs.length && longs[0].end < now - 8000) longs.shift();
    if (document.hidden || now - t0 > 1600) { low.rings = low.scroll = 0; return; } // pestaña oculta / hilo bloqueado
    const settled = inv.ready && !!(state.scroll || state.fallbackScroll) && (state.fallbackScroll || now - state.scrollReadyAt > 2000);
    const r = state.rings;
    if (r) check('rings', r, settled && state.revealed && lastHeroP < .9 && r.isIntroDone && !foreignLong(t0, now, 'rings'), ringsFallback);
    const sc = state.scroll;
    // FIX: ya no se cambia a la tarjeta con la secuencia en curso NI terminada (state.opened): el pergamino abierto es casi
    // estático y el cambio solo le hacía perder al invitado lo que ya veía. Queda para el pergamino cerrado que no se puede dibujar.
    if (sc) check('scroll', sc, settled && state.parchVisible && sc.quality >= 4 && !sc.opening && !state.opening && !state.opened && !foreignLong(t0, now, 'scroll'), scrollFallback);
  }, 1000);
}

/* ------------------------------------------------------------------------ */
/* Puerta → hero                                                             */
/* ------------------------------------------------------------------------ */
function enableEnter() {
  if (state.ready) return;
  state.ready = true;
  forced = 1;
  gate?.setProgress(1); // la puerta se habilita sola cuando también cargó su video
}

function startMusic() {
  const m = state.music;
  const go = mm => { try { const p = mm?.start?.(); p?.catch?.(e => console.warn('[inv] música:', e)); musicUI?.markStarted(); } catch (e) { console.warn('[inv] música:', e); } };
  if (m) go(m); else musicP.then(go);
}

/** onOpen de la puerta: SÍNCRONO dentro del clic/tap en el lazo (ahí arranca la canción). */
function enter(withMusic) {
  if (state.entered) return;
  state.entered = true;
  // desde el toque hasta que los nombres terminan de aparecer no se hace trabajo pesado de fondo (revealHero lo acorta)
  state.busyUntil = performance.now() + 14000;
  if (withMusic) startMusic(); // dentro del gesto del usuario → song.start()
  if (withMusic && !REDUCED) { try { navigator.vibrate?.(8); } catch {} } // el tirón del lazo
  // FIX (latencia del toque en móvil medio: 0.4–0.8 s): solo la música exige el gesto. Quitar is-gated / inert recalcula
  // estilos y maquetación de toda la página: va después del primer cuadro del desatado (la puerta sigue tapando la página).
  requestAnimationFrame(() => setTimeout(() => {
    try { state.rings?.resume(); } catch {}
    html.classList.remove('is-gated');
    $('#main').inert = false;
    scrollTo(0, 0);
    kinetic?.setStage('hero');
  }, 0));
}

/** onOpened de la puerta: el envoltorio terminó de abrirse. */
function gateOpened() {
  musicUI?.show();
  refreshTriggers(); // PERF-RETOMA: al terminar la llegada de los anillos y los nombres (no en medio)
}

/** Cuántos segundos faltan para que el clink caiga en un pulso de la canción (de preferencia un tiempo fuerte), o null.
 *  rings3d acelera o frena la intro un 15–20 % como máximo para lograrlo. */
function clinkOnBeat(base) {
  const s = state.music, a = s?.analysis;
  if (!base || REDUCED || !s?.playing || !Array.isArray(a?.beats) || !a.beats.length) return null;
  const now = s.currentTime, target = now + base, beats = a.beats, ph = Number.isFinite(a.downbeatPhase) ? a.downbeatPhase : 0;
  let best = null;
  for (let i = 0; i < beats.length; i++) {
    const d = beats[i] - now;
    if (d < base / 1.2 || d > base / 0.84) continue;               // fuera del margen de velocidad permitido
    const score = Math.abs(beats[i] - target) - (((i - ph) % 4 + 4) % 4 === 0 ? 0.6 : 0); // tiempo fuerte: preferido
    if (!best || score < best.score) best = { score, d };
  }
  return best ? best.d : null;
}

async function runIntro() {
  const r = state.rings;
  if (r) {
    try { await Promise.race([r.intro({ clinkIn: clinkOnBeat(r.clinkTime) }), sleep(9000)]); } catch (e) { console.warn('[inv] intro:', e); }
    revealHero();
  } else {
    revealHero();
    // FIX (red lenta): si los anillos 3D aún se montan al abrir la puerta, se ve la foto de los anillos encima del lienzo; al
    // llegar el 3D la foto se desvanece y empieza la llegada con el clink (antes: terciopelo vacío hasta que llegaran)
    if (!state.fallbackRings && !NO_GL) ringsPlaceholder(true);
    ringsP.then(rr => { ringsPlaceholder(false, !!rr); if (rr) rr.intro().catch(() => {}); });
  }
}
let ringsPh = null;
function ringsPlaceholder(on, live = false) {
  if (on) {
    if (ringsPh || state.rings || state.fallbackRings) return;
    const img = ringsPh = new Image();
    img.className = 'stage__img'; img.alt = ''; img.decoding = 'async'; img.style.zIndex = '1';
    img.onload = () => requestAnimationFrame(() => img.classList.add('is-in'));
    img.onerror = () => { img.remove(); if (ringsPh === img) ringsPh = null; };
    img.src = 'assets/render/anillos/pareja.jpg';
    els.ringsStage.append(img);
    return;
  }
  const img = ringsPh; ringsPh = null;
  if (!img) return;
  if (!live) { img.remove(); return; } // (ringsFallback ya puso su propia imagen)
  img.classList.remove('is-in');
  setTimeout(() => img.remove(), 900);
}

function onClink() {
  state.music?.sfx?.chime?.();
  haptic(10);
  if (state.rings || !gsap || REDUCED) return; // rings3d ya dibuja el destello, la onda y las chispas en WebGL
  let f = $('.hero__flash');
  if (!f) {
    f = document.createElement('div'); f.className = 'hero__flash'; f.setAttribute('aria-hidden', 'true');
    els.ringsStage.after(f);
  }
  gsap.fromTo(f, { opacity: 0, scale: .6 }, { opacity: .85, scale: 1, duration: .18, ease: 'power2.out', yoyo: true, repeat: 1, repeatDelay: .05 });
}

/** PERF: los nombres ya terminaron de aparecer → la tipografía cinética puede hacerlos respirar y brillar.
 *  PERF-RETOMA: y recién ahora se suelta el trabajo de fondo (antes se soltaba 2.6 s después del revelado, fijo: con CPU ×4
 *  el revelado dura ~4 s y un tramo del montaje del pergamino caía en plena entrada de las letras). */
function namesDone() {
  if (state.namesDone) return;
  state.namesDone = true;
  state.busyUntil = Math.min(state.busyUntil, performance.now() + 250);
  kinetic?.hold?.(els.names, false);
  heroCalmResolve();
}
/** PERF-RETOMA: el hero ya terminó su entrada (o el invitado llegó al pergamino). Lo espera la galería para pedir y
 *  recortar sus fotos (el recorte de referencia-4 con toBlob costaba ~120 ms justo cuando el lazo se podía tocar). */
let heroCalmResolve;
const heroCalm = new Promise(r => (heroCalmResolve = r));

/** PERF-RETOMA: ScrollTrigger.refresh() (≈ 15 ms en escritorio, 65 ms con CPU ×4) no cae en plena animación protagonista
 *  (desatado del lazo, llegada de los anillos, nombres): espera a que termine, salvo que el invitado ya esté en el pergamino. */
let stRefreshT = 0;
function refreshTriggers(delay = 0) {
  clearTimeout(stRefreshT);
  stRefreshT = setTimeout(function run() {
    const wait = state.busyUntil - performance.now();
    if (wait > 0 && !state.parchVisible) { stRefreshT = setTimeout(run, Math.min(wait + 80, 1500)); return; }
    stRefreshT = 0;
    ScrollTrigger?.refresh();
  }, delay);
}

function revealHero() {
  if (state.revealed) return;
  state.revealed = true;
  // los nombres aún entran: el trabajo de fondo espera a namesDone() (tope de 6.5 s por si su línea de tiempo no termina)
  state.busyUntil = Math.min(state.busyUntil, performance.now() + (REDUCED ? 600 : 6500));
  els.hero.classList.add('is-revealed');
  // PERF: el revelado de los nombres es carga de DOM/composición (desenfoque por letra), no de la GPU de los anillos:
  // rings3d no adapta su calidad durante ese rato (y si bajó antes, la recupera sola)
  try { state.rings?.hold?.(REDUCED ? 1500 : 4800); } catch {}
  // la banda de frases sigue a la sección visible (se aparta del texto del hero con data-kinetic-avoid)
  setTimeout(startKineticTrack, REDUCED ? 300 : 900);
  const chars = $$('.hero__names .ch');
  if (!gsap || REDUCED) { namesDone(); return; }
  layoutLetters(els.names);
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, onComplete: namesDone });
  setTimeout(namesDone, 6000); // por si la línea de tiempo no llega a completarse (pestaña oculta, etc.)
  const eb = $('[data-hero="eyebrow"]');
  // PERF: desenfoque inicial de cada letra 14 → 8 px (el filtro por letra era lo más caro del revelado: ~45 fps en escritorio)
  tl.fromTo(eb, { opacity: 0, y: 14, letterSpacing: spacing(eb, .7) }, { opacity: 1, y: 0, letterSpacing: spacing(eb), duration: 1.8, clearProps: 'letterSpacing' }, 0)
    .set('[data-hero="names"]', { opacity: 1 }, 0)
    .fromTo(chars, { opacity: 0, yPercent: 60, rotateX: -85, filter: 'blur(8px)', transformPerspective: 600 },
      { opacity: 1, yPercent: 0, rotateX: 0, filter: 'blur(0px)', duration: 1.6, stagger: .055, clearProps: 'filter' }, .15)
    .fromTo(els.names, { '--s': '-30%' }, { '--s': '135%', duration: 2.2, ease: 'power2.inOut' }, .9)
    .fromTo('[data-hero="subtitle"]', { opacity: 0, y: 18, filter: 'blur(6px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.6, clearProps: 'filter' }, 1.0)
    .fromTo('[data-hero="date"]', { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 1.4 }, 1.25)
    .fromTo('.hero__date .rule', { scaleX: 0 }, { scaleX: (i) => (i ? -1 : 1), duration: 1.6, ease: 'expo.inOut' }, 1.25)
    .fromTo('[data-hero="cue"]', { opacity: 0 }, { opacity: 1, duration: 1.2 }, 1.9);
  // destello periódico sobre los nombres
  gsap.timeline({ repeat: -1, repeatDelay: 5.5, delay: 6 })
    .fromTo(els.names, { '--s': '-30%' }, { '--s': '135%', duration: 2.4, ease: 'power2.inOut' });
  // parallax con el mouse
  if (matchMedia('(hover: hover) and (pointer: fine)').matches && !SOFT) {
    const qx = gsap.quickTo(els.heroInner, 'x', { duration: 1.2, ease: 'power3.out' });
    const qy = gsap.quickTo(els.heroInner, 'y', { duration: 1.2, ease: 'power3.out' });
    addEventListener('pointermove', e => {
      if (lastHeroP > .6) return;
      qx((e.clientX / innerWidth - .5) * -14); qy((e.clientY / innerHeight - .5) * -8);
    }, { passive: true });
  }
}

/* ------------------------------------------------------------------------ */
/* Pergamino                                                                 */
/* ------------------------------------------------------------------------ */
function onOpenStart() {
  measureParchSafe();
  if (gsap) { gsap.killTweensOf(els.hint); gsap.set(els.hint, { clearProps: 'opacity,transform' }); }
  els.hint.classList.add('is-hidden');
  els.hint.setAttribute('aria-expanded', 'true');
  if (gsap && !REDUCED) gsap.to(els.parchHead, { opacity: 0, y: -20, duration: 1, ease: 'power2.inOut' });
  else els.parchHead.style.opacity = '0';
}

async function openParchment(source) {
  if (state.opening || state.opened) return;
  state.opening = true;
  onScroll(); // ESCENA: degradados y html.parch-reading al estado de lectura aunque el invitado no vuelva a desplazarse
  // si el pergamino 3D aún se está montando (conexión lenta), se espera a que esté listo o se usa la tarjeta HTML.
  // PERF: mientras tanto el botón NO desaparece: queda "preparando" (sello que late + anillo de progreso) y el montaje
  // deja de ceder el paso (busyUntil = 0); en cuanto está listo, la apertura sigue sola.
  if (!state.scroll && !state.fallbackScroll && scrollP) {
    state.busyUntil = 0;
    setHintPreparing(true);
    els.hint.classList.add('is-waiting');
    await Promise.race([scrollP, sleep(20000)]);
    els.hint.classList.remove('is-waiting');
  }
  onOpenStart();
  if (!state.scroll && !state.fallbackScroll) scrollFallback();
  if (state.scroll) {
    try { await state.scroll.open(); } catch (e) { console.warn('[inv] open:', e); }
    handleOpened();
  } else {
    const card = state.fallbackCard;
    if (card) {
      state.music?.sfx?.sealCrack?.();
      haptic([14, 40, 22]);
      setTimeout(() => state.music?.sfx?.paperUnroll?.(2.4), 350);
      // FIX (móvil sin WebGL): la tarjeta estaba centrada y al abrirse crecía hacia arriba y abajo (la varilla y el antetítulo
      // salían de la pantalla). Se fija su borde superior donde está y crece solo hacia abajo; luego se lleva a la vista,
      // por debajo del botón de música (scroll-margin-top en .pcard).
      try {
        const host = els.fallback, top = card.getBoundingClientRect().top - host.getBoundingClientRect().top;
        host.style.alignItems = 'start'; host.style.paddingTop = Math.max(0, Math.round(top)) + 'px';
      } catch {}
      card.classList.remove('is-closed');
      card.removeAttribute('aria-hidden');
      writeCardNames(card, REDUCED ? 0 : 950);
      // UNIR: la apertura automática no mueve el scroll del invitado (solo el toque lleva la tarjeta a la vista)
      if (source !== 'auto') { try { card.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); } catch {} }
      await sleep(REDUCED ? 600 : 2500);
    }
    handleOpened();
  }
  void source;
}

/** FIX ronda 1 (idea): la tarjeta de respaldo también tiene escritura a mano: los nombres en oro, uno tras otro, mientras
 *  el papel se despliega (js/escritura.js no necesita WebGL). Sin el módulo o sin los trazos, queda el texto dorado. */
function writeCardNames(card, delay = 0) {
  const pieces = [...card.querySelectorAll('[data-escritura]')];
  if (!pieces.length) return;
  setTimeout(async () => {
    const api = window.__escritura || inv.escritura;
    if (!api?.play) { pieces.forEach(el => { el.dataset.escrituraModo = 'vista'; }); return; }
    const dur = { 'tarjeta-nombre-1': 1.9, 'tarjeta-nombre-y': 0.7, 'tarjeta-nombre-2': 2.5 };
    for (const el of pieces) { try { await api.play(el, { duracion: dur[el.dataset.escritura] || 0 }); } catch {} }
  }, delay);
}

function handleOpened() {
  if (state.opened) return;
  state.opened = true; state.opening = false;
  onScroll();
  onOpenStart();
  els.ctas.hidden = false;
  queueFitCtas();
  // FIX: el botón "Abrir el pergamino" ya no sirve: sale del orden de tabulación y el foco pasa a "Cómo llegar"
  if (document.activeElement === els.hint) { try { $('#cta-mapa').focus({ preventScroll: true }); } catch {} }
  setTimeout(() => { els.hint.hidden = true; }, 700);
  // (scroll3d ya hace sonar sus destellos con la lluvia de pétalos; aquí solo en la tarjeta HTML)
  if (!state.scroll) state.music?.sfx?.sparkle?.();
  if (gsap && !REDUCED) {
    gsap.fromTo($$('.cta', els.ctas), { opacity: 0, y: 22, filter: 'blur(6px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, ease: 'expo.out', stagger: .12, clearProps: 'filter' });
  }
}

/* ------------------------------------------------------------------------ */
/* Scroll (lógica principal, independiente de GSAP)                          */
/* ------------------------------------------------------------------------ */
let lastHeroP = -1, ticking = false, autoOpenArmed = true;
const PARCH_OUT = .18; // PERF-RETOMA: fracción de pantalla bajo la cual el pergamino que sale por arriba se pausa
const fadeTop = $('.parch__fade--top'), fadeBot = $('.parch__fade--bottom');

/* ESCENA · freno: mientras la secuencia del pergamino no termina (todo escrito, alejado y con los CTA), la sección fija no se
 * suelta: si al bajar quedan menos de 0.9 pantallas de recorrido fijo, la sección se alarga (--parch-extra) y la escena
 * acelera con tope hasta alcanzar al scroll. No mueve el scroll (sin secuestro): solo alarga la página por debajo de lo que
 * se ve. Un salto que ya dejó atrás la sección (tecla Fin, barra de desplazamiento) no la alarga. El alargue se conserva. */
let parchExtra = 0;
/** Alarga la sección fija (sin mover el scroll) si al bajar quedan menos de `k` pantallas de recorrido fijo (0.9; 0.4 con
 *  todo escrito: solo falta el alejamiento, que acelera con el scroll). Si ya se acortó (parchTrim), alarga ese alto. */
function extendParch(pr, vh, k = .9) {
  const left = pr.bottom - vh, margin = vh * k;
  if (left >= margin) return;
  const step = vh * .25, add = Math.ceil((margin - left) / step) * step;
  if (parchH) { parchH = Math.round(parchH + add); els.parch.style.setProperty('--parch-h', parchH + 'px'); }
  else { parchExtra = Math.round(parchExtra + add); els.parch.style.setProperty('--parch-extra', parchExtra + 'px'); }
  refreshTriggers(500);
}
/* COMPAT-FLUIDEZ (decisión n.º 9.2, pedido del usuario desde su iPhone: «tengo que hacer mucho scroll para que salga la
 * siguiente escena»). Quien miraba escribir a la pluma sin bajar tenía por delante ~4 pantallas de recorrido fijo sin
 * cambios. Ahora, al terminar la escritura, la sección se ACORTA por debajo de lo que se ve (el escenario sigue fijo, no se
 * mueve el scroll ni lo que está a la vista): quedan TRIM_W pantallas fijas, cuyo recorrido guía el alejamiento de la cámara
 * (acelera con el scroll), y con los CTA a la vista, TRIM_DONE; después la sección se suelta y la historia entra seguida.
 * La garantía de lectura no cambia: el freno sigue alargando mientras falte texto por escribir. */
const TRIM_W = .5, TRIM_DONE = .25;
let parchH = 0, trimMap = null;
function parchStickyH() { return els.parch.firstElementChild?.offsetHeight || innerHeight; }
function trimParch(pr, keep) {
  // no se acorta si la sección ya se soltó por arriba (salto con Fin / barra): movería lo que el invitado mira
  const sh = parchStickyH();
  if (pr.bottom < sh - 1) return;
  const want = Math.round(Math.max(0, -pr.top) + sh + keep * innerHeight);
  if (want >= pr.height - 2) return;
  parchH = want;
  els.parch.style.setProperty('--parch-h', parchH + 'px');
  refreshTriggers(300);
}
/** Progreso del recorrido fijo que recibe scroll3d (0..1). Tras acortar, el tramo que queda (≈0.45 pantallas) lleva el
 *  alejamiento final de sWrite a sBack (antes ese tramo eran ~0.6 pantallas de un recorrido de 4.2). */
function parchProgress(pr, vh) {
  if (trimMap) return clamp(trimMap.p0 + (trimMap.p1 - trimMap.p0) * (Math.max(0, -pr.top) - trimMap.y) / trimMap.len);
  return clamp(-pr.top / Math.max(1, pr.height - vh - parchExtra));
}
/** Al girar el teléfono (el escenario fijo cambia de alto) la sección acortada vuelve a dejar TRIM_DONE por delante si el
 *  invitado estaba en el tramo fijo (si no, el escenario se soltaría a medias). */
let parchPinned = false;
function fitTrim() {
  if (!parchH || !parchPinned || state.fallbackScroll) return;
  const pr = els.parch.getBoundingClientRect(), need = Math.round(Math.max(0, -pr.top) + parchStickyH() + TRIM_DONE * innerHeight);
  if (need > parchH) { parchH = need; els.parch.style.setProperty('--parch-h', parchH + 'px'); }
}
function parchFlow(pr, vh) {
  const sc = state.scroll;
  parchPinned = pr.top <= 0 && pr.bottom >= parchStickyH() - 1;
  if (!sc || state.fallbackScroll) return;
  let sq = null; try { sq = sc.sequence; } catch {}
  if (!sq) return;
  if (!trimMap && sq.wt >= .999 && (state.opening || state.opened)) {
    const p = parchProgress(pr, vh), sW = sq.sWrite ?? .78, sB = sq.sBack ?? .86;
    trimMap = { y: Math.max(0, -pr.top), p0: Math.max(p, sW), p1: Math.max(p, sB + .02), len: vh * .35 };
    trimParch(pr, TRIM_W);
  }
  if (trimMap && !trimMap.done && state.opened) { trimMap.done = true; trimParch(els.parch.getBoundingClientRect(), TRIM_DONE); }
}
/* AJUSTES (decisión n.º 9.2, «ahí pienso que ya terminó la animación»): con el pergamino escrito y los CTA a la vista, si la
 * sección sigue fija y el invitado se detiene 1.5 s, aparece «Desliza para continuar» (content.js: UI.seguir) con una flecha;
 * el siguiente gesto lo retira y, si vuelve a detenerse, reaparece. Solo con el 3D (la tarjeta HTML no queda fija). */
const CUE_IDLE = 1500;
let cueT = 0, cueY = NaN;
const cueOk = () => state.opened && !state.fallbackScroll && !!state.scroll && parchPinned && !document.hidden && !els.reader?.open;
function cueArm() {
  clearTimeout(cueT); els.cue.classList.remove('is-on');
  cueT = setTimeout(() => { cueT = 0; if (cueOk()) els.cue.classList.add('is-on'); }, CUE_IDLE);
}
function cueTick() {
  if (!els.cue) return;
  if (!cueOk()) { clearTimeout(cueT); cueT = 0; cueY = NaN; els.cue.classList.remove('is-on'); return; }
  if (scrollY !== cueY) { cueY = scrollY; cueArm(); } // (las llamadas a update() sin desplazamiento no lo reinician)
}
function cueKick() { if (els.cue && (cueT || els.cue.classList.contains('is-on')) && cueOk()) cueArm(); }
/* FIX (móvil lento / red lenta): la sección queda fija y el 3D todavía se monta (se ve el póster con el anillo de progreso).
 * Antes el invitado podía recorrer toda la sección viendo solo el póster. Ahora la sección se alarga (igual que el freno, sin
 * mover el scroll) mientras el montaje avanza, hasta 12 s (20 s si ya va por el 85 %); después se abre la tarjeta HTML para que
 * el texto se vea siempre. Un salto que ya dejó atrás la sección no la alarga. */
let mountWaitT0 = 0, mountWaitTimer = 0;
function mountBrake(pr, vh) {
  if (state.scroll || state.fallbackScroll || NO_GL || !state.entered) { clearTimeout(mountWaitTimer); mountWaitTimer = 0; return; }
  if (pr.top > 0 || pr.bottom < vh) return; // aún no fija, o ya soltada (salto)
  if (!mountWaitT0) {
    mountWaitT0 = performance.now();
    const check = () => {
      mountWaitTimer = 0;
      if (state.scroll || state.fallbackScroll) return;
      const lim = state.scrollProg >= .85 ? 20000 : 12000, waited = performance.now() - mountWaitT0;
      if (waited < lim) { mountWaitTimer = setTimeout(check, lim - waited + 50); return; }
      const r = els.parch.getBoundingClientRect();
      if (r.top > 0 || r.bottom < innerHeight * .5) { mountWaitT0 = 0; return; } // ya no está en la sección: se rearma al volver
      console.info('[inv] pergamino 3D aún montándose tras ' + Math.round(waited / 1000) + ' s con la sección fija: abro la tarjeta HTML');
      scrollFallback();
      if (!state.opened && !state.opening) { autoOpenArmed = false; openParchment('auto'); }
    };
    mountWaitTimer = setTimeout(check, 12050);
  }
  extendParch(pr, vh);
}
/* FIX (memoria de GPU en teléfonos): con el pergamino abierto y el hero a más de 1.5 pantallas por encima durante 3 s, los
 * anillos sueltan sus destinos de render (sleep); se recrean (wake) apenas el hero vuelve a estar a menos de una pantalla. */
/* COMPAT-FLUIDEZ (hallazgos 15/32/45, memoria de GPU en teléfonos): lo mismo para el pergamino abierto cuando su sección
 * queda a más de 1.5 pantallas (historia, momentos, final): scroll3d.sleep() suelta posproceso, sombras y búfer del lienzo;
 * se recrean al acercarse a menos de una pantalla (y siempre antes de dibujar: setActive(true)). Solo en táctiles. */
const COARSE = matchMedia('(pointer: coarse)').matches;
let parchSleepT = 0;
function parchSleep(pr, vh) {
  const s = state.scroll;
  if (!s?.sleep || !COARSE || state.fallbackScroll) return;
  const far = r => r.bottom < -1.5 * innerHeight || r.top > 2.5 * innerHeight;
  if (!far(pr)) {
    clearTimeout(parchSleepT); parchSleepT = 0;
    if (s.asleep && pr.bottom > -vh && pr.top < 2 * vh) { try { s.wake(); } catch {} }
    return;
  }
  if (s.asleep || parchSleepT || !state.opened) return;
  parchSleepT = setTimeout(() => {
    parchSleepT = 0;
    if (state.scroll === s && far(els.parch.getBoundingClientRect())) { try { s.sleep(); } catch {} }
  }, 3000);
}
let ringsSleepT = 0;
function ringsSleep(hr, vh) {
  const r = state.rings;
  if (!r?.sleep) return;
  if (hr.bottom > -vh) { clearTimeout(ringsSleepT); ringsSleepT = 0; if (r.asleep) { try { r.wake(); } catch {} } return; }
  if (r.asleep || ringsSleepT || !state.opened || hr.bottom > -1.5 * vh) return;
  ringsSleepT = setTimeout(() => {
    ringsSleepT = 0;
    const h = els.hero.getBoundingClientRect();
    if (state.rings === r && h.bottom < -1.5 * innerHeight) { try { r.sleep(); } catch {} }
  }, 3000);
}
function parchBrake(pr, vh) {
  const sc = state.scroll;
  if (!sc || state.fallbackScroll || !state.opening || state.opened) return;
  let sq = null; try { sq = sc.sequence; } catch {}
  if (!sq || sq.done) return;
  if (pr.top > 0 || pr.bottom < vh) return; // aún no fija, o ya soltada (salto): no se alarga
  extendParch(pr, vh, sq.wt >= .999 ? .45 : .9);
}

/* ESCENA · zona segura del encuadre final: lo que tapan los CTA (abajo en móvil y tableta, columna a la derecha en escritorio
 * ancho y en apaisado bajo). Los CTA están maquetados aunque ocultos (visibility), así que se miden siempre; scroll3d encuadra
 * el pergamino en el resto (nunca debajo de los botones). */
function measureParchSafe() {
  const sc = state.scroll;
  if (!sc?.setSafeArea) return;
  const st = els.scrollStage.getBoundingClientRect();
  if (!st.width || !st.height) return;
  const out = { top: 0, bottom: 0, left: 0, right: 0 };
  const r0 = els.ctas.getBoundingClientRect();
  // (sin el desplazamiento de fitCtas: el encuadre se calcula con la posición de maquetación)
  const r = { left: r0.left - ctaShift.x, right: r0.right - ctaShift.x, top: r0.top - ctaShift.y, width: r0.width, height: r0.height };
  if (r.width && r.height) {
    const cx = (r.left + r.right) / 2 - st.left;
    if (r.height < st.height * .6 && r.width < st.width * .45 && cx > st.width * .6) out.right = Math.max(0, st.right - r.left + 16);
    else out.bottom = Math.max(0, st.bottom - r.top + 12);
  }
  // FIX (barra dinámica de Safari/Chrome móvil): el escenario mide 100lvh; con la barra desplegada su franja inferior queda
  // debajo de ella: el encuadre de lectura y el final no la usan
  out.bottom = Math.max(out.bottom, barPx());
  // (el botón de música, arriba a la derecha en móvil, solo roza la varilla superior: no reserva zona)
  try { sc.setSafeArea(out); } catch {}
}
/* COMPAT-FLUIDEZ (CTA «Cómo llegar / Agendar / Leer texto» cortados a la derecha en dos capturas de escritorio del usuario,
 * 1377×867 y ≈1511×882, con el rodillo inferior también cortado abajo). Causa: zoom de PELLIZCO (panel táctil o pantalla
 * táctil; también al acercar con dos dedos en el teléfono): la ventana visible (visualViewport) es una parte de la página y
 * los CTA, anclados al borde derecho de la página, quedan fuera. Con barra de desplazamiento real y zoom del navegador
 * 67–150 % en 17 tamaños nunca se cortan (shots/compat/cta.mjs); con pellizco ×1.1 a 1337×706 se reproduce la captura
 * (shots/compat/pinch.mjs). Ahora la columna se desplaza para quedar siempre dentro de lo visible. */
const ctaShift = { x: 0, y: 0 };
let ctaFitRaf = 0;
function fitCtas() {
  ctaFitRaf = 0;
  const nav = els.ctas, vv = window.visualViewport;
  if (!nav || nav.hidden) return;
  if (state.fallbackScroll) { if (ctaShift.x || ctaShift.y) { ctaShift.x = ctaShift.y = 0; nav.style.removeProperty('translate'); } return; }
  // solo con el escenario fijo a la vista (si no, los CTA están donde deben: dentro de la sección que pasa)
  const pr = els.parch.getBoundingClientRect();
  if (pr.top > 1 || pr.bottom < innerHeight - 1) return;
  const pinched = !!vv && vv.scale > 1.01;
  const r = nav.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // lo visible, en coordenadas de la página (sin la barra de desplazamiento)
  const L = vv ? vv.offsetLeft : 0, T = vv ? vv.offsetTop : 0;
  const R = Math.min(L + (vv ? vv.width : innerWidth), html.clientWidth || innerWidth), B = Math.min(T + (vv ? vv.height : innerHeight), html.clientHeight || innerHeight);
  const m = 8, bx = r.left - ctaShift.x, by = r.top - ctaShift.y; // posición sin desplazar
  let x = 0, y = 0;
  if (bx + r.width > R - m) x = R - m - (bx + r.width);
  if (bx + x < L + m) x = L + m - bx;
  if (pinched) {
    if (by + r.height > B - m) y = B - m - (by + r.height);
    if (by + y < T + m) y = T + m - by;
  }
  x = Math.round(x); y = Math.round(y);
  if (x === ctaShift.x && y === ctaShift.y) return;
  ctaShift.x = x; ctaShift.y = y;
  if (x || y) nav.style.setProperty('translate', `${x}px ${y}px`); else nav.style.removeProperty('translate');
}
function queueFitCtas() { if (!ctaFitRaf) ctaFitRaf = requestAnimationFrame(fitCtas); }
/** FIX: alto de la barra del navegador desplegada (100lvh − 100svh) en px; 0 en escritorio o sin esas unidades. */
let barProbe = null;
function barPx() {
  try {
    if (!CSS.supports?.('height', '1lvh')) return 0;
    if (!barProbe) {
      barProbe = document.createElement('div');
      barProbe.setAttribute('aria-hidden', 'true');
      barProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:calc(100lvh - 100svh);visibility:hidden;pointer-events:none';
      document.body.append(barProbe);
    }
    return Math.max(0, Math.round(barProbe.getBoundingClientRect().height));
  } catch { return 0; }
}
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; update(); });
}
function update() {
  const vh = innerHeight;
  // Hero: p = 0 arriba … 1 cuando el hero salió por completo
  const hr = els.hero.getBoundingClientRect();
  const hp = clamp(-hr.top / hr.height);
  ringsSleep(hr, vh);
  parchSleep(els.parch.getBoundingClientRect(), vh);
  if (Math.abs(hp - lastHeroP) > .0005) {
    lastHeroP = hp;
    try { state.rings?.setScroll(hp); } catch {}
    const k = clamp(hp / .38);
    els.heroContent.style.transform = `translate3d(0, ${(-k * 90).toFixed(1)}px, 0)`;
    els.heroContent.style.opacity = (1 - clamp((k - .1) / .7)).toFixed(3);
  }
  // Pergamino
  const pr = els.parch.getBoundingClientRect();
  // PERF-RETOMA (sugerencia de HISTORIA): cuando el pergamino sale por arriba (queda menos del 18 % de su escenario fijo a la
  // vista) deja de dibujarse: no compite con el ensamblado de partículas de #historia. Al volver sigue donde estaba (también
  // una apertura en curso: su reloj solo avanza mientras se dibuja). historia3d.js lee este mismo estado (parchVisible).
  const visible = pr.bottom > vh * PARCH_OUT && pr.top < vh;
  // PERF: la sección se acerca y el 3D aún se monta → marcador (render del pergamino cerrado, atenuado)
  if (!waitEl && !state.scroll && !state.fallbackScroll && pr.top < vh * 1.25 && pr.bottom > 0) parchWait(true);
  if (visible !== state.parchVisible) {
    state.parchVisible = visible;
    if (visible) heroCalmResolve?.();
    try { state.scroll?.setActive(visible); } catch {}
  }
  // FIX: el degradado superior tapa el borde del lienzo 3D mientras ese borde está en pantalla (pr.top > 0); solo se
  // aclara cuando la sección ya quedó fija arriba (antes se aclaraba antes y se veía una línea dura sobre la vela).
  // ESCENA: con el pergamino abierto (lectura) los degradados se retiran del todo mientras la sección está fija: el de arriba
  // tapaba el antetítulo y el de abajo los últimos renglones; el de abajo vuelve justo cuando la sección se suelta.
  const reading = !state.fallbackScroll && !!state.scroll && (state.opening || state.opened);
  if (!state.fallbackScroll) {
    fadeTop.style.opacity = (pr.top > 0 ? 1 : reading ? 0 : .42 + .58 * clamp(1 + pr.top / (vh * .35))).toFixed(3);
    fadeBot.style.opacity = (reading ? clamp((vh - pr.bottom) / (vh * .06)) : 1).toFixed(3);
  }
  html.classList.toggle('parch-reading', reading && pr.top <= 0 && pr.bottom > vh * .35);
  // ESCENA: recorrido fijo SIN el alargue del freno (el mapeo scroll → secuencia no cambia al alargar la sección)
  // COMPAT-FLUIDEZ: tras acortar la sección (escritura terminada) el tramo final guía el alejamiento (parchProgress)
  const pp = parchProgress(pr, vh);
  // ritmo de la secuencia = max(tiempo, scroll): scroll3d acelera (con tope) si el scroll va por delante
  if (state.scroll && pr.top <= 0) { try { state.scroll.setScrollProgress(pp); } catch {} }
  // ESCENA: apertura automática apenas la sección queda fija (antes a mitad del recorrido: el pergamino salía de pantalla
  // antes de escribirse). También abren el sello y el botón.
  if (state.entered && autoOpenArmed && !state.fallbackScroll && pr.top <= 2 && pr.bottom > vh * .5 && !state.opened && !state.opening && state.scroll) {
    autoOpenArmed = false;
    openParchment('auto');
  }
  // UNIR (teléfonos sin WebGL 2 o con la tarjeta de respaldo): la tarjeta HTML también se abre sola cuando queda bien a la
  // vista, como el pergamino 3D al quedar fijo. Antes solo se abría tocando el sello y quien seguía bajando nunca veía el texto.
  if (state.entered && autoOpenArmed && state.fallbackScroll && state.fallbackCard && !state.opened && !state.opening) {
    const cr = state.fallbackCard.getBoundingClientRect();
    if (cr.top < vh * .6 && cr.bottom > vh * .3) { autoOpenArmed = false; openParchment('auto'); }
  }
  parchBrake(pr, vh);
  mountBrake(pr, vh);
  parchFlow(pr, vh);
  cueTick();
  if (!els.ctas.hidden && (ctaShift.x || ctaShift.y || (window.visualViewport?.scale ?? 1) > 1.01)) queueFitCtas();
  // Polvo de oro: solo en secciones sin 3D
  const story = $('#historia').getBoundingClientRect();
  dust?.setEnabled(story.top < vh * .9 || state.fallbackScroll && pr.top < vh * .5);
}

/* ------------------------------------------------------------------------ */
/* Arranque                                                                  */
/* ------------------------------------------------------------------------ */
let dust = null, musicUI = null, kinetic = null, gate = null, musicP, ringsP, scrollP, gateP, safeT = 0;
// referencia-4.jpg es una captura de pantalla con flechas, puntos de carrusel y bordes: se recorta al mostrarla.
const PHOTO_CROPS = { 'assets/photos/referencia-4.jpg': [50 / 703, 0, 598 / 703, 782 / 827] };

function boot() {
  if (html.classList.contains('legacy-entry')) return;
  try { history.scrollRestoration = 'manual'; } catch {}
  $('#main').inert = true; // la puerta es modal
  scrollTo(0, 0);
  hydrateText();
  splitLetters($('.hn--a')); splitLetters($('.hn--amp')); splitLetters($('.hn--b'));
  // sombra de los nombres en una copia estática detrás (ver .hero__shadow en style.css)
  {
    const sh = document.createElement('span');
    sh.className = 'hero__shadow'; sh.setAttribute('aria-hidden', 'true');
    for (const [cls, txt] of [['hn hn--a', COUPLE.a], ['hn hn--amp', '&'], ['hn hn--b', COUPLE.b]]) {
      const s = document.createElement('span'); s.className = cls;
      for (const c of txt) { const k = document.createElement('span'); k.className = 'chs'; k.textContent = c; s.append(k); } // mismo espaciado que .ch
      sh.append(s);
    }
    els.names.prepend(sh);
  }
  fillA11yCopy(els.a11y, PARCHMENT_TEXT);
  $('#cta-agendar').href = buildIcsHref(EVENT, COUPLE);
  if (!NO_GL) setHintPreparing(true); // PERF: anillo de progreso en el botón hasta que el pergamino 3D esté listo

  // FIX: las texturas decorativas (grano, fibras) se generan después del primer cuadro: el primer lienzo de la página puede
  // costar cientos de ms (canal de GPU) y no debe retrasar la puerta
  requestAnimationFrame(() => setTimeout(() => {
    initGrain(); initFiber();
    dust = initDust(els.dust, { reduced: REDUCED }); update();
  }, 60));
  initGlow($('.fx-glow'));

  // Puerta crema (gate.js): el hilo dorado muestra la carga; al tocar el lazo → onOpen (síncrono, arranca la canción)
  // → desatado → onReveal (el envoltorio empieza a abrirse: anillos) → onOpened.
  gateP = import('./gate.js?v=20261104b').then(m => m.mountGate(els.gate, {
    reducedMotion: REDUCED,
    progressSource: () => targetProgress(),
    maxWait: 3500,
    // PERF: si la puerta no puede leer las máscaras de los destellos en la GPU (WebGL1), las precalcula solo cuando el
    // pergamino 3D ya terminó de montarse (antes ambas tareas competían justo cuando el lazo se podía tocar)
    masksAfter: () => scrollP,
    onOpen: withMusic => enter(withMusic),
    // con ratón, el audio se prepara al presionar (la activación del usuario ya existe): el clic queda libre para la animación
    onPress: e => { if (e?.pointerType === 'mouse') requestAnimationFrame(() => setTimeout(() => { try { state.music?.warm?.(); } catch {} }, 0)); },
    onReveal: () => runIntro(),
    onOpened: () => gateOpened(),
  })).then(g => { gate = inv.gate = g; if (state.ready) g.setProgress(1); return g; }).catch(e => {
    console.warn('[inv] puerta no disponible:', e?.message || e);
    els.gate.remove(); enter(false); runIntro(); gateOpened();
    return null;
  });

  musicP = loadMusic();
  musicP.then(m => loadKinetic(m));
  ringsP = loadRings();
  const fontsP = (document.fonts?.ready || Promise.resolve()).then(() => { prog.fonts = 1; });
  // cada módulo resuelve aunque falle (devuelven null)
  const critical = Promise.all([musicP, ringsP, fontsP]);
  Promise.race([Promise.all([musicP, fontsP]), sleep(2500)]).then(enableEnter);
  // el pergamino no compite con lo crítico: se descarga cuando ya están los anillos (o a los 10 s) y se monta en tiempo ocioso.
  // FIX (red lenta): y además espera a que el lazo se pueda tocar (o a que el invitado entre), hasta 45 s: sus ≈ 8 MB le
  // robaban el ancho de banda a los videos de la puerta (en 3G el lazo tardaba ~59 s; sin esa competencia, ~30 s)
  const gateUsable = new Promise(res => {
    const iv = setInterval(() => { if (state.entered || inv.gate?.ready || gate === null && !els.gate.isConnected) { clearInterval(iv); res(); } }, 250);
  });
  scrollP = Promise.race([critical, sleep(10000)]).then(() => Promise.race([gateUsable, sleep(45000)])).then(() => loadScroll());
  const all = Promise.all([critical, scrollP]);
  all.then(() => { inv.ready = true; resolveReady(inv); });
  watchFps();
  musicP.then(m => {
    if (!m) { els.musicBtn.remove(); musicUI = null; return; }
    musicUI?.attachBeat(m);
    m.onBeat?.((i) => { if (i % 2 === 0) { try { state.rings?.sparkle(); } catch {} } });
  });

  musicUI = initMusicButton(els.musicBtn, () => state.music, { onStart: () => {} });

  els.hint.addEventListener('click', () => openParchment('button'));
  // Si el usuario toca el sello en 3D, scroll3d abre por su cuenta: lo detectamos por isOpen
  els.scrollStage.addEventListener('pointerup', () => {
    setTimeout(() => { if (state.scroll?.isOpen && !state.opening && !state.opened) { state.opening = true; onOpenStart(); onScroll(); } }, 200);
  });

  // Tarjeta legible
  const readerCard = buildParchmentCard(PARCHMENT_TEXT, { reader: true, titleId: 'reader-title' });
  els.readerCard.append(readerCard);
  // FIX compatibilidad (Safari < 15.4 sin showModal: lanzaba TypeError y dejaba la página bloqueada con is-locked)
  const closeReader = () => { if (typeof els.reader.close === 'function') els.reader.close(); else { els.reader.removeAttribute('open'); els.reader.dispatchEvent(new Event('close')); } };
  $('#cta-leer').addEventListener('click', () => {
    if (typeof els.reader.showModal === 'function') els.reader.showModal(); else els.reader.setAttribute('open', '');
    html.classList.add('is-locked');
  });
  $('.reader__close').addEventListener('click', closeReader);
  els.reader.addEventListener('close', () => html.classList.remove('is-locked'));
  $('.reader__scroll').addEventListener('click', e => { if (e.target.classList.contains('reader__scroll')) closeReader(); });

  // Galería y cuenta regresiva
  const gal = initGallery($('#gallery'), MOMENTS.photos, {
    gsap, reduced: REDUCED, coupleLabel: `${COUPLE.a} y ${COUPLE.b}`, crops: PHOTO_CROPS,
    // FIX: las fotos (proporciones y recorte) se piden cuando ya cargó lo de la puerta. PERF-RETOMA: y cuando el hero
    // terminó de entrar (nombres) o el invitado llegó al pergamino, en un rato ocioso: no en la puerta ni en el desatado
    after: Promise.all([critical, heroCalm]).then(() => idleSlot()),
    onLayout: () => refreshTriggers(200), // PERF-RETOMA: cada foto que llega ya no recalcula en pleno desatado
  });
  initCountdown($('#countdown'), EVENT.isoStart, { reduced: REDUCED });
  $('#volver').addEventListener('click', () => {
    scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  });

  addEventListener('scroll', onScroll, { passive: true });
  // AJUSTES: «Desliza para continuar» se retira con el siguiente gesto (antes de que llegue el scroll)
  for (const ev of ['wheel', 'touchstart', 'keydown']) addEventListener(ev, cueKick, { passive: true });
  addEventListener('resize', () => {
    fitTrim();
    onScroll();
    if (state.revealed) layoutLetters(els.names);
    clearTimeout(safeT); safeT = setTimeout(() => { measureParchSafe(); queueFitCtas(); }, 120);
  }, { passive: true });
  // COMPAT-FLUIDEZ: zoom de pellizco → los CTA siguen dentro de lo visible (fitCtas)
  try { visualViewport?.addEventListener('resize', queueFitCtas, { passive: true }); visualViewport?.addEventListener('scroll', queueFitCtas, { passive: true }); } catch {}
  update();

  const afterFonts = () => {
    initReveals({ gsap, ScrollTrigger, reduced: REDUCED });
    if (gsap && ScrollTrigger && !REDUCED) {
      const tl = gsap.timeline({ scrollTrigger: { trigger: els.parch, start: 'top 55%', once: true } });
      const peb = $('.parch__head .eyebrow');
      tl.fromTo(peb, { opacity: 0, letterSpacing: spacing(peb, .7) }, { opacity: 1, letterSpacing: spacing(peb), duration: 1.8, ease: 'expo.out', clearProps: 'letterSpacing' }, 0)
        .fromTo('.parch__title', { opacity: 0, y: 34, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.6, ease: 'expo.out', clearProps: 'filter' }, .15)
        .fromTo(els.hint, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1.4, ease: 'expo.out', clearProps: 'opacity,transform' }, .7);
    }
    if (gsap) revealGallery({ gsap, ScrollTrigger, reduced: REDUCED, items: gal.items });
    revealCountdown({ gsap, reduced: REDUCED });
    layoutLetters(els.names);
    ScrollTrigger?.refresh();
  };
  Promise.race([fontsP, sleep(3000)]).then(afterFonts);

  if (qs.has('diag')) import('./diag.js').then(m => m.mountDiag(inv)).catch(e => console.warn('[inv] diagnóstico:', e?.message || e));
  if (qs.has('skipgate')) Promise.race([critical, sleep(6000)]).then(() => { enableEnter(); gateP.then(g => (g ? g.skip() : enter(false))); });
}

boot();
