// WEB-SHELL + INTEGRATE · orquestación de la invitación "Pergamino 3D" de Josué & Marjhory.
// Carga los módulos con import() dinámico (con alternativas): puerta crema con el lazo (gate.js), canción del usuario
// (song.js + SFX de music.js), tipografía cinética (kinetic.js), anillos 3D (rings3d.js) y pergamino 3D (scroll3d.js).
// Parámetros de prueba:
//   ?stubs=1   usa tests/stubs/*.js en lugar de los módulos reales
//   ?nogl=1    fuerza el modo sin WebGL (imágenes + pergamino HTML)
//   ?reduced=1 fuerza movimiento reducido
//   ?skipgate=1 entra directamente (sin música) — para capturas
import * as C from './content.js';
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
const REDUCED = qs.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const gsap = window.gsap || null;
const ScrollTrigger = window.ScrollTrigger || null;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger); else html.classList.add('no-gsap');
if (REDUCED) html.classList.add('reduced');
// FIX: ya no se crea un contexto WebGL de prueba al cargar (costaba ~0.65 s antes de pintar la puerta). rings3d.js y
// scroll3d.js detectan solos la falta de WebGL o el render por software (SwiftShader, llvmpipe…) y fallan → imagen/tarjeta HTML.
const NO_GL = qs.has('nogl');

// FIX: lo que la puerta necesita para abrirse (videos del lazo y anillos del hero) empieza a bajar ya, con prioridad, en vez de
// competir con el pergamino y la canción. Se añade desde aquí (no en el HTML) para no precargar nada que este modo no use.
const PRELOADED = [];
(() => {
  if (STUBS) return;
  const pre = href => { const l = document.createElement('link'); l.rel = 'preload'; l.as = 'fetch'; l.crossOrigin = 'anonymous'; l.href = href; document.head.append(l); PRELOADED.push(href); };
  if (!REDUCED) { pre('assets/video/lazo_reposo_alpha.mp4'); pre('assets/video/lazo_abrir_alpha.mp4'); }
  if (!NO_GL) { pre('assets/models/anillos/ring-halo.glb'); pre('assets/models/anillos/ring-jonc.glb'); }
})();

const els = {
  gate: $('#gate'),
  hero: $('#inicio'), ringsStage: $('#rings-stage'), heroContent: $('.hero__content'), heroInner: $('.hero__inner'),
  names: $('.hero__names'), parch: $('#pergamino'), scrollStage: $('#scroll-stage'), parchHead: $('.parch__head'),
  hint: $('#abrir-pergamino'), ctas: $('#parch-ctas'), fallback: $('#parch-fallback'), a11y: $('#invitacion-texto'),
  reader: $('#lectura'), readerCard: $('#reader-card'), musicBtn: $('#musica'), dust: $('.fx-dust'),
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
  shell: { state, enter: (m = false) => enter(m), open: () => openParchment('api'), reduced: REDUCED, noGL: NO_GL, stubs: STUBS },
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
/** Música = la canción del usuario (song.js) con los SFX de music.js sin el Canon; respaldo: el Canon de music.js. */
async function loadMusic() {
  let mm = null;
  try { mm = await import(MOD + 'music.js'); } catch (e) { console.warn('[inv] SFX no disponibles:', e?.message || e); }
  try {
    const { createSong } = await import('./song.js');
    state.music = inv.music = inv.song = await createSong({ music: mm ? sfxOnlyAfterStart(mm.createMusic({ background: false, idle: idleSlot })) : undefined });
  } catch (e) {
    console.warn('[inv] canción no disponible, uso la música sintetizada:', e?.message || e);
    try { if (mm) state.music = inv.music = mm.createMusic(); } catch {}
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
    const m = await import(MOD + 'rings3d.js');
    const mounting = m.mountRings(els.ringsStage, {
      reducedMotion: REDUCED,
      onProgress: p => { prog.rings = clamp(p) * .98; },
      onClink: () => onClink(),
    });
    const r = await withTimeout(mounting, 25000, 'anillos');
    state.rings = inv.rings = r;
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
    const m = await import(MOD + 'scroll3d.js');
    const mounting = m.mountScroll(els.scrollStage, {
      music: withHaptics(state.music) || undefined,
      reducedMotion: REDUCED,
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
 *  su lugar reservado y la mueve con la escritura). UNIR: activarla por defecto cambiando QUILL_ON a `qs.get('pluma') !== '0'`.
 *  Hoy solo con ?pluma=1 (mientras PLUMA-WEB termina). Si falla, la escritura sigue con la pluma invisible. */
const QUILL_ON = qs.get('pluma') === '1';
async function loadQuill(s) {
  if (!QUILL_ON || !s?.attachQuill) return;
  try {
    const [{ createQuill }, THREE] = await Promise.all([import('./pluma.js'), import('three')]);
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
      if (state.parchVisible || state.opening) { requestAnimationFrame(() => setTimeout(() => res(budget(8)), 0)); return; }
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
.parch-wait img{position:absolute;left:-2%;top:-2%;width:104%;height:104%;object-fit:cover;filter:brightness(.58) saturate(.9) blur(2.5px)}
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
  const wasOpen = state.opened;
  if (state.scroll) { try { state.scroll.dispose(); } catch {} state.scroll = inv.scroll = null; }
  els.parch.classList.add('is-fallback');
  els.scrollStage.classList.remove('is-live');
  els.scrollStage.querySelectorAll('canvas').forEach(c => c.remove());
  const card = buildParchmentCard(PARCHMENT_TEXT, { closed: true });
  card.setAttribute('aria-hidden', 'true');
  els.fallback.append(card);
  els.fallback.hidden = false;
  state.fallbackCard = card;
  const seal = card.querySelector('.pcard__seal');
  seal?.setAttribute('tabindex', '-1'); // el control accesible es #abrir-pergamino
  seal?.addEventListener('click', () => openParchment('seal'));
  if (wasOpen) { card.classList.remove('is-closed'); card.removeAttribute('aria-hidden'); }
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
    if (sc) check('scroll', sc, settled && state.parchVisible && sc.quality >= 4 && !sc.opening && !foreignLong(t0, now, 'scroll'), scrollFallback);
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
  try { state.rings?.resume(); } catch {}
  html.classList.remove('is-gated');
  $('#main').inert = false;
  scrollTo(0, 0);
  kinetic?.setStage('hero');
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
    ringsP.then(rr => { if (rr) rr.intro().catch(() => {}); });
  }
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
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
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
      try { card.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); } catch {}
      await sleep(REDUCED ? 600 : 2500);
    }
    handleOpened();
  }
  void source;
}

function handleOpened() {
  if (state.opened) return;
  state.opened = true; state.opening = false;
  onScroll();
  onOpenStart();
  els.ctas.hidden = false;
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
function parchBrake(pr, vh) {
  const sc = state.scroll;
  if (!sc || state.fallbackScroll || !state.opening || state.opened) return;
  let sq = null; try { sq = sc.sequence; } catch {}
  if (!sq || sq.done) return;
  if (pr.top > 0 || pr.bottom < vh) return; // aún no fija, o ya soltada (salto): no se alarga
  const left = pr.bottom - vh, margin = vh * .9;
  if (left >= margin) return;
  const step = vh * .25, add = Math.ceil((margin - left) / step) * step;
  parchExtra = Math.round(parchExtra + add);
  els.parch.style.setProperty('--parch-extra', parchExtra + 'px');
  refreshTriggers(500);
}

/* ESCENA · zona segura del encuadre de lectura/final: lo que tapan los CTA (abajo en móvil y tableta, columna a la derecha en
 * escritorio ancho) y el botón de música (arriba a la derecha en móvil). Los CTA están maquetados aunque ocultos
 * (visibility), así que se miden siempre. */
function measureParchSafe() {
  const sc = state.scroll;
  if (!sc?.setSafeArea) return;
  const st = els.scrollStage.getBoundingClientRect();
  if (!st.width || !st.height) return;
  const out = { top: 0, bottom: 0, left: 0, right: 0 };
  const r = els.ctas.getBoundingClientRect();
  if (r.width && r.height) {
    const cx = (r.left + r.right) / 2 - st.left;
    if (r.height < st.height * .6 && r.width < st.width * .45 && cx > st.width * .6) out.right = Math.max(0, st.right - r.left + 16);
    else out.bottom = Math.max(0, st.bottom - r.top + 12);
  }
  // (el botón de música, arriba a la derecha en móvil, solo roza la varilla superior: no reserva zona)
  try { sc.setSafeArea(out); } catch {}
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
  const span = Math.max(1, pr.height - vh - parchExtra);
  const pp = clamp(-pr.top / span);
  // ritmo de la secuencia = max(tiempo, scroll): scroll3d acelera (con tope) si el scroll va por delante
  if (state.scroll && pr.top <= 0) { try { state.scroll.setScrollProgress(pp); } catch {} }
  // ESCENA: apertura automática apenas la sección queda fija (antes a mitad del recorrido: el pergamino salía de pantalla
  // antes de escribirse). También abren el sello y el botón.
  if (state.entered && autoOpenArmed && !state.fallbackScroll && pr.top <= 2 && pr.bottom > vh * .5 && !state.opened && !state.opening && state.scroll) {
    autoOpenArmed = false;
    openParchment('auto');
  }
  parchBrake(pr, vh);
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
  gateP = import('./gate.js').then(m => m.mountGate(els.gate, {
    reducedMotion: REDUCED,
    progressSource: () => targetProgress(),
    maxWait: 9000,
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
  Promise.race([critical, sleep(8000)]).then(enableEnter);
  // el pergamino no compite con lo crítico: se descarga cuando ya están los anillos (o a los 10 s) y se monta en tiempo ocioso
  scrollP = Promise.race([critical, sleep(10000)]).then(() => loadScroll());
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
  $('#cta-leer').addEventListener('click', () => { html.classList.add('is-locked'); els.reader.showModal(); });
  $('.reader__close').addEventListener('click', () => els.reader.close());
  els.reader.addEventListener('close', () => html.classList.remove('is-locked'));
  $('.reader__scroll').addEventListener('click', e => { if (e.target.classList.contains('reader__scroll')) els.reader.close(); });

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
  addEventListener('resize', () => {
    onScroll();
    if (state.revealed) layoutLetters(els.names);
    clearTimeout(safeT); safeT = setTimeout(measureParchSafe, 120);
  }, { passive: true });
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

  if (qs.has('skipgate')) Promise.race([critical, sleep(6000)]).then(() => { enableEnter(); gateP.then(g => (g ? g.skip() : enter(false))); });
}

boot();
