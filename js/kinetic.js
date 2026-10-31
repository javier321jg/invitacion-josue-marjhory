// js/kinetic.js — KINETIC · tipografía cinética sincronizada con la canción del usuario.
//
// Contrato (SPEC.md, "Decisión del usuario n.º 2"):
//   mountKinetic({ song, root?, reducedMotion? }) → { setStage(name), setEnabled(on), dispose() }
//   (extras: refresh(), fps, stage, level, debug)
// - song: objeto de createSong() o compatible: onBeat(i,t,{strength,downbeat}) / onAccent(t,s) / onSection({level,…}) /
//   onLine(l|null) / getEnergy() / currentTime / playing / analysis. Todo es opcional: sin song funciona con un reloj propio.
// - Marca: data-kinetic="letters" (letras que respiran con la energía grave, barrido de oro en cada tiempo fuerte, ondas en los
//   acentos) · data-kinetic="title" (revelado cuantizado al siguiente pulso, desenfoque→nitidez y tinta que se asienta) ·
//   data-kinetic="pulse" (latido sutil + subrayado dorado en los downbeats).
// - Crea la capa #kinetic-lyrics: líneas del LRC del usuario si song emite onLine; si no, FRASES DE LA INVITACIÓN (content.js)
//   con un estilo distinto por sección musical (calma: polvo de oro · suave: flotan y se entintan · media: escritura
//   caligráfica · clímax: estallan en los acentos y se deshacen en chispas).
// - Este archivo NUNCA contiene versos de la canción (derechos de autor).
//
// Rendimiento: un solo requestAnimationFrame; se anima solo transform/opacity/filter (WAAPI → compositor) y la máscara de la
// escritura; las lecturas de layout se agrupan (una vez al crear cada frase / al redimensionar); perfil de calidad automático
// que reduce partículas y efectos si el fps cae; nada corre con la pestaña oculta o con setEnabled(false).

import { COUPLE, EVENT, HERO, PARCHMENT_TEXT } from './content.js';

const LEVEL_ALIAS = { calma: 'calma', suave: 'suave', media: 'media', climax: 'climax', 'clímax': 'climax', respiro: 'suave', cierre: 'calma' };
const STAGE_INTENSITY = { gate: 0, hero: 1, pergamino: 0, historia: 0.85, momentos: 0.75, final: 1 };
const BAND_STAGES = new Set(['hero', 'historia', 'momentos', 'final']);

// ---------- Frases de la invitación (solo textos de content.js) ----------
const NAMES = `${COUPLE.a} & ${COUPLE.b}`;
const INVITE = `${PARCHMENT_TEXT.kicker} ${PARCHMENT_TEXT.title.charAt(0).toLowerCase()}${PARCHMENT_TEXT.title.slice(1)}`;
const PHRASES = {
  hero: [
    { lines: [HERO.eyebrow], role: 'line' },
    { lines: [NAMES], role: 'names' },
    { lines: [HERO.subtitle], role: 'line' },
    { lines: [INVITE], role: 'line' },
    { lines: [EVENT.dateLong], role: 'date' },
  ],
  // FIX: cada sección canta textos de la invitación que ELLA NO MUESTRA (antes repetía su propio antetítulo/título y se
  // leía como subtítulos duplicados)
  historia: [
    { lines: PARCHMENT_TEXT.verse, role: 'verse' },
    { lines: PARCHMENT_TEXT.closing, role: 'verse' },
    { lines: [INVITE], role: 'line' },
    { lines: [EVENT.dateLong], role: 'date' },
  ],
  momentos: [
    { lines: PARCHMENT_TEXT.verse, role: 'verse' },
    { lines: [NAMES], role: 'names' },
    { lines: PARCHMENT_TEXT.closing, role: 'verse' },
  ],
  final: [
    { lines: PARCHMENT_TEXT.closing, role: 'verse' },
    { lines: [INVITE], role: 'line' },
    { lines: [EVENT.dateLong], role: 'date' },
    { lines: [NAMES], role: 'names' },
  ],
};

// ---------- utilidades ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const easeOut3 = t => 1 - (1 - t) ** 3;
const easeIO3 = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const nowMs = () => performance.now();
const noop = () => {};
const animate = (el, kf, opt) => { try { return el.animate(kf, opt); } catch { return null; } };
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('es', { granularity: 'grapheme' }) : null;
const graphemes = s => (SEG ? [...SEG.segment(s)].map(g => g.segment) : [...s]);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'svg', 'SVG', 'CANVAS', 'IMG', 'BR', 'VIDEO', 'PICTURE']);

function ensureStylesheet() {
  try {
    if (document.querySelector('link[href*="kinetic.css"]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = new URL('../css/kinetic.css', import.meta.url).href; l.dataset.kinetic = '';
    document.head.append(l);
  } catch { /* sin estilos: el texto sigue visible */ }
}

/** Divide el texto de `host` en palabras (.kx-w) y letras (.kx-c) conservando su estructura. Reutiliza .ch del shell. */
function splitText(host) {
  const pre = host.querySelectorAll('.ch');
  if (pre.length) { const letters = [...pre]; return { letters, words: [{ el: host, letters }], presplit: true }; }
  const words = [], letters = [];
  const walk = node => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        if (!n.nodeValue.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const part of n.nodeValue.split(/([ \t\n\r\f]+)/)) {
          if (!part) continue;
          if (/^[ \t\n\r\f]+$/.test(part)) { frag.append(document.createTextNode(' ')); continue; }
          const w = document.createElement('span'); w.className = 'kx-w'; w.setAttribute('aria-hidden', 'true');
          const wl = [];
          for (const g of graphemes(part)) {
            const c = document.createElement('span'); c.className = 'kx-c'; c.textContent = g; c.dataset.kx = g;
            w.append(c); wl.push(c); letters.push(c);
          }
          frag.append(w); words.push({ el: w, letters: wl });
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !SKIP_TAGS.has(n.tagName) && !n.classList.contains('kx-sr') && !n.hasAttribute('data-kinetic-skip')) {
        walk(n);
      }
    }
  };
  walk(host);
  return { letters, words, presplit: false };
}

/** aria-label con el texto completo + copia invisible (para elementos genéricos donde aria-label no se anuncia). */
function labelHost(host, text) {
  if (!text || host.closest('[aria-hidden="true"]')) return noop;
  const had = host.hasAttribute('aria-label');
  if (!had) host.setAttribute('aria-label', text);
  const sr = document.createElement('span'); sr.className = 'kx-sr'; sr.textContent = text; host.append(sr);
  return () => { if (!had) host.removeAttribute('aria-label'); sr.remove(); };
}

/** Destello estelar de 4 puntas (como los diamantes del hero). */
function makeStar() {
  const c = document.createElement('canvas'); c.width = c.height = 96;
  const g = c.getContext('2d'); g.translate(48, 48);
  const ray = (len, th) => {
    const gr = g.createLinearGradient(-len, 0, len, 0);
    gr.addColorStop(0, 'rgba(255,236,190,0)'); gr.addColorStop(0.5, 'rgba(255,250,235,1)'); gr.addColorStop(1, 'rgba(255,236,190,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, len, th, 0, 0, Math.PI * 2); g.fill();
  };
  ray(48, 1.6); g.rotate(Math.PI / 2); ray(30, 1.3); g.rotate(-Math.PI / 4); ray(14, 0.9); g.rotate(Math.PI / 2); ray(14, 0.9);
  const core = g.createRadialGradient(0, 0, 0, 0, 0, 12);
  core.addColorStop(0, 'rgba(255,252,240,1)'); core.addColorStop(1, 'rgba(255,228,170,0)');
  g.setTransform(1, 0, 0, 1, 48, 48); g.fillStyle = core; g.fillRect(-12, -12, 24, 24);
  return c;
}

function makeSprite(stops) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

// =====================================================================================================================
export function mountKinetic(opts = {}) {
  const song = opts.song || null;
  const root = opts.root || document.body;
  const RM = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const MOBILE = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || innerWidth < 720;
  ensureStylesheet();

  // ---------- estado ----------
  let enabled = true, disposed = false, raf = 0, lastFrame = 0;
  let stage = 'hero', intensity = 1, level = 'calma';
  const qMax = Number.isFinite(opts.quality) ? clamp(opts.quality, 0.3, 1) : MOBILE ? 0.8 : 1;
  const autoQuality = opts.autoQuality !== false;
  let quality = qMax;
  let fps = 60, fpsAcc = 0, fpsN = 0, lowFor = 0, highFor = 0;
  let eLow = 0, eRms = 0, eHigh = 0;
  let lastBeatPerf = 0, lastBeatSong = -1, beatCounter = 0, sinceDown = 0;
  let fontsReady = false;
  const timers = [];
  const offs = [];
  const flags = { breath: true, sweep: true, pulse: true, wave: true, band: true, fx: true, beats: true }; // perfiles de depuración (debug.flags)
  const hosts = []; // { el, mode, held?, ... }
  const mountedEls = new WeakSet();
  const heldEls = new WeakSet(); // PERF: anfitriones en pausa (api.hold) — p. ej. los nombres mientras GSAP los revela

  const A = () => song?.analysis || null;
  const beats = () => A()?.beats || null;
  const period = () => { const t = A()?.tempo; return t ? 60 / t : 0.9; };
  const songPlaying = () => !!(song && song.playing);
  const after = (ms, fn) => timers.push({ at: nowMs() + ms, fn });

  try { document.fonts?.ready?.then(() => { fontsReady = true; }); } catch { fontsReady = true; }
  setTimeout(() => { fontsReady = true; }, 2500);

  // ---------- rejilla musical: tiempos futuros cuantizados al pulso (en ms desde ahora) ----------
  function beatAt(b, t) { // último índice con b[i] <= t (−1 si ninguno)
    if (!b.length || t < b[0]) return -1;
    let lo = 0, hi = b.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; }
    return lo;
  }
  function gridDelays(lead, count, div = 1) {
    const b = beats(); const P = period();
    if (songPlaying() && b && b.length) {
      const now = song.currentTime, from = now + lead, out = [];
      let i = Math.max(0, beatAt(b, from));
      while (out.length < count && i < b.length + 512) {
        const b0 = i < b.length ? b[i] : b[b.length - 1] + (i - b.length + 1) * P;
        const b1 = i + 1 < b.length ? b[i + 1] : b0 + P;
        for (let k = 0; k < div && out.length < count; k++) { const tk = b0 + ((b1 - b0) * k) / div; if (tk >= from - 1e-3) out.push((tk - now) * 1000); }
        i++;
      }
      return out;
    }
    // sin canción: rejilla al tempo de la canción anclada al último pulso conocido (o a ahora)
    const now = nowMs() / 1000, step = P / div, anchor = lastBeatPerf ? lastBeatPerf / 1000 : now;
    const k0 = Math.ceil((now + lead - anchor) / step);
    return Array.from({ length: count }, (_, j) => (anchor + (k0 + j) * step - now) * 1000);
  }

  // =================================================================================================================
  // Anfitriones data-kinetic
  // =================================================================================================================
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const en of entries) {
        const h = hosts.find(x => x.el === en.target); if (!h) continue;
        h.visible = en.isIntersecting;
        if (h.mode === 'letters') {
          h.el.classList.toggle('kx-live', h.visible && enabled && !h.held);
          if (!h.visible) resetBreath(h);
        }
        if (h.mode === 'title' && en.isIntersecting && en.intersectionRatio >= 0.2) revealTitle(h);
      }
    }, { threshold: [0, 0.2, 0.5], rootMargin: '0px 0px -6% 0px' })
    : null;

  function scan() {
    if (disposed) return;
    for (const el of root.querySelectorAll('[data-kinetic]')) {
      if (mountedEls.has(el) || el.closest('#kinetic-lyrics')) continue;
      const mode = el.getAttribute('data-kinetic');
      let h = null;
      if (mode === 'letters') h = mountLetters(el);
      else if (mode === 'title') h = mountTitle(el);
      else if (mode === 'pulse') h = mountPulse(el);
      if (!h) continue;
      h.held = heldEls.has(el);
      mountedEls.add(el); hosts.push(h);
      if (io) io.observe(el); else { h.visible = true; if (h.mode === 'title') revealTitle(h); }
    }
  }

  function mountLetters(el) {
    if (RM) return { el, mode: 'letters', letters: [], visible: false, restore: noop, static: true };
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const original = [...el.childNodes].map(n => n.cloneNode(true));
    const cs = getComputedStyle(el);
    const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    const gradient = clip === 'text' && cs.backgroundImage && cs.backgroundImage !== 'none';
    const { letters, presplit } = splitText(el);
    if (presplit) letters.forEach(L => { if (!L.dataset.kx) L.dataset.kx = L.textContent; });
    if (gradient && !presplit) { el.classList.add('kx-gtext'); el.style.setProperty('--kx-grad', cs.backgroundImage); }
    const unlabel = presplit ? noop : labelHost(el, text);
    el.classList.add('kx-letters');
    const ph = letters.map((_, i) => i * 0.62 + Math.sin(i * 1.7) * 0.4);
    return {
      el, mode: 'letters', letters, ph, visible: false, presplit,
      restore() {
        el.classList.remove('kx-letters', 'kx-live', 'kx-gtext'); el.style.removeProperty('--kx-grad'); unlabel();
        if (presplit) letters.forEach(L => { L.getAnimations?.({ subtree: true }).forEach(a => a.cancel()); delete L.dataset.kx; });
        else el.replaceChildren(...original);
      },
    };
  }

  function mountTitle(el) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    const original = [...el.childNodes].map(n => n.cloneNode(true));
    const { letters, words, presplit } = splitText(el);
    const unlabel = presplit ? noop : labelHost(el, text);
    el.classList.add('kx-title');
    if (!RM && enabled) el.classList.add('kx-title--pending');
    return {
      el, mode: 'title', letters, words, presplit, visible: false, revealed: false,
      restore() {
        el.classList.remove('kx-title', 'kx-title--pending'); unlabel();
        if (presplit) letters.forEach(L => L.getAnimations?.().forEach(a => a.cancel()));
        else el.replaceChildren(...original);
      },
    };
  }

  function mountPulse(el) {
    // halo y subrayado son capas propias: el latido anima solo opacity/transform/scale (compositor), nunca drop-shadow
    const u = document.createElement('span'); u.className = 'kx-uline'; u.setAttribute('aria-hidden', 'true');
    const g = document.createElement('span'); g.className = 'kx-halo'; g.setAttribute('aria-hidden', 'true');
    el.append(g, u);
    let posSet = false;
    if (getComputedStyle(el).position === 'static') { el.style.position = 'relative'; posSet = true; }
    el.classList.add('kx-pulse');
    return {
      el, mode: 'pulse', u, g, visible: false,
      restore() { u.remove(); g.remove(); el.classList.remove('kx-pulse'); if (posSet) el.style.position = ''; el.getAnimations?.().forEach(a => a.cancel()); },
    };
  }

  // ----- letters: respiración (WAAPI scale por pulso), barrido de oro (WAAPI filter), ondas (WAAPI translate) -----
  // Todo va por Web Animations: el compositor lo mantiene fluido aunque el hilo principal esté ocupado con WebGL.
  function resetBreath(h) { for (const L of h.letters) L.getAnimations?.().forEach(a => { if (a.id === 'kx-breath') a.cancel(); }); }
  function breathBeat(letters, ph, P) {
    // cada letra se hincha con la energía grave en cada pulso; la fase por letra hace una ola lenta que recorre la palabra
    const amp = 0.07 * eLow * intensity * (0.6 + 0.4 * quality);
    if (amp < 0.004) return;
    const dur = Math.max(400, P * 1000 * 0.97);
    for (let i = 0; i < letters.length; i++) {
      const a = amp * (0.5 + 0.5 * Math.sin(beatCounter * 0.8 + (ph ? ph[i] : i * 0.62)));
      const an = animate(letters[i], [
        { scale: '1 1' },
        { scale: `${(1 + a * 0.55).toFixed(4)} ${(1 + a).toFixed(4)}`, offset: 0.28 },
        { scale: '1 1' },
      ], { duration: dur, delay: i * 16, easing: 'cubic-bezier(.33,0,.45,1)' });
      if (an) an.id = 'kx-breath';
    }
  }
  const busy = L => { const f = L.style.filter, o = L.style.opacity; return (f && f !== 'none' && !/^blur\(0(px)?\)$/.test(f)) || (o !== '' && +o < 0.98); };
  // Barrido de oro: una copia luminosa de cada letra (::after con content: attr(data-kx), ver kinetic.css) que se enciende
  // y se apaga en ola. Solo anima opacity de una capa hoja → compositor puro. (Un filter: brightness() por letra obligaba a
  // una superficie de render por letra dentro del drop-shadow de .hero__names: el doble de GPU por cuadro.)
  const SHINE = { pseudoElement: '::after' };
  function sweepLetters(letters, power, step = 42) {
    const p = clamp(power, 0.15, 1.2) * intensity;
    if (p < 0.05) return;
    const peak = +(0.24 + 0.4 * Math.min(1, p)).toFixed(3);
    letters.forEach((L, i) => {
      if (busy(L) || !L.dataset.kx || !L.dataset.kx.trim()) return;
      animate(L, [{ opacity: 0 }, { opacity: peak, offset: 0.3 }, { opacity: 0 }], { ...SHINE, duration: 820, delay: i * step, easing: 'cubic-bezier(.3,.6,.2,1)' });
    });
  }
  function waveLetters(letters, s, step = 34) {
    const amp = (0.045 + 0.085 * clamp(s)) * intensity;
    if (amp < 0.01) return;
    letters.forEach((L, i) => animate(L, [{ translate: '0 0' }, { translate: `0 ${(-amp).toFixed(3)}em`, offset: 0.36 }, { translate: '0 0' }],
      { duration: 640, delay: i * step, easing: 'cubic-bezier(.35,0,.25,1)' }));
  }

  // ----- title: revelado cuantizado -----
  function revealTitle(h) {
    if (h.revealed) return;
    h.revealed = true;
    const el = h.el;
    if (RM || !enabled || !h.words.length) {
      el.classList.remove('kx-title--pending');
      if (RM && enabled) animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 900, easing: 'ease-out' });
      return;
    }
    const nW = h.words.length, P = period();
    let div = nW <= 2 ? 1 : 2;
    if ((nW * P) / div > 3.4) div = 4;
    const lands = gridDelays(0.62, nW, div);
    const D = 860, OFF = 0.62;
    h.words.forEach((W, i) => {
      const land = lands[i];
      W.letters.forEach((L, j) => animate(L, [
        { opacity: 0, transform: 'translate3d(0,-.42em,0) scale(1.15)', filter: 'blur(9px) brightness(1.7)' },
        { opacity: 1, transform: 'translate3d(0,.04em,0) scale(.985)', filter: 'blur(0px) brightness(1.6)', offset: OFF },
        { opacity: 1, transform: 'translate3d(0,-.012em,0) scale(1.006)', filter: 'blur(0px) brightness(1.18)', offset: 0.8 },
        { opacity: 1, transform: 'translate3d(0,0,0) scale(1)', filter: 'blur(0px) brightness(1)' },
      ], { duration: D, delay: Math.max(0, land - D * OFF + j * 20), easing: 'cubic-bezier(.3,0,.2,1)', fill: 'backwards' }));
      if (!h.presplit) {
        const ink = document.createElement('span'); ink.className = 'kx-ink'; ink.setAttribute('aria-hidden', 'true');
        W.el.append(ink);
        const a = animate(ink, [
          { opacity: 0, transform: 'scale(.3,.55)' },
          { opacity: 0.85, transform: 'scale(1,1)', offset: 0.16 },
          { opacity: 0, transform: 'scale(1.4,1.18)' },
        ], { duration: 2100, delay: Math.max(0, land - 40), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'both' });
        if (a) a.onfinish = () => ink.remove(); else ink.remove();
      }
    });
    el.classList.remove('kx-title--pending');
  }

  // ----- pulse: latido -----
  function pulseHost(h, s) {
    const p = (0.6 + 0.4 * clamp(s)) * Math.max(0.35, intensity);
    // latido doble: escala del texto + halo dorado detrás (solo scale/opacity/transform → compositor, sin filtros)
    animate(h.el, [
      { scale: '1' },
      { scale: `${(1 + 0.03 * p).toFixed(4)}`, offset: 0.12 },
      { scale: '1', offset: 0.3 },
      { scale: `${(1 + 0.016 * p).toFixed(4)}`, offset: 0.42 },
      { scale: '1' },
    ], { duration: 1500, easing: 'cubic-bezier(.25,.6,.3,1)' });
    animate(h.g, [
      { opacity: 0, transform: 'scale(.82,.6)' },
      { opacity: 0.85 * p, transform: 'scale(1,1)', offset: 0.12 },
      { opacity: 0.3 * p, transform: 'scale(.96,.9)', offset: 0.3 },
      { opacity: 0.55 * p, transform: 'scale(1.02,1)', offset: 0.42 },
      { opacity: 0, transform: 'scale(1.1,1.05)' },
    ], { duration: 1500, easing: 'cubic-bezier(.25,.6,.3,1)' });
    animate(h.u, [
      { transform: 'scaleX(0)', opacity: 0 },
      { transform: 'scaleX(1)', opacity: 0.95 * p, offset: 0.24 },
      { transform: 'scaleX(1.04)', opacity: 0 },
    ], { duration: 1700, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  // =================================================================================================================
  // Banda #kinetic-lyrics
  // =================================================================================================================
  let band = document.getElementById('kinetic-lyrics');
  const bandOwned = !band;
  if (!band) { band = document.createElement('div'); band.id = 'kinetic-lyrics'; root.append(band); }
  band.classList.add('kx-band'); if (RM) band.classList.add('kx-rm');
  band.setAttribute('aria-hidden', 'true');
  band.innerHTML = '<div class="kx-band__scrim"></div><canvas class="kx-band__fx"></canvas><div class="kx-band__stage"></div><div class="kx-band__rule"><i></i><b></b></div>';
  const canvas = band.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const stageEl = band.querySelector('.kx-band__stage');
  const ruleI = band.querySelector('.kx-band__rule i');
  const ruleB = band.querySelector('.kx-band__rule b');
  const SPR_GOLD = makeSprite([[0, 'rgba(255,250,236,1)'], [0.16, 'rgba(255,234,186,.95)'], [0.42, 'rgba(226,186,118,.32)'], [1, 'rgba(214,186,132,0)']]);
  const SPR_SOFT = makeSprite([[0, 'rgba(255,240,205,.55)'], [0.5, 'rgba(214,186,132,.16)'], [1, 'rgba(214,186,132,0)']]);
  const SPR_STAR = makeStar();
  const fx = { w: 1, h: 1, dpr: 1, rect: null, parts: [], dirty: false };
  const maxParts = () => Math.round((MOBILE ? 170 : 320) * quality);

  function fxResize() {
    const r = canvas.getBoundingClientRect();
    fx.rect = r; fx.w = Math.max(1, r.width); fx.h = Math.max(1, r.height);
    fx.dpr = Math.min(devicePixelRatio || 1, 1.25);
    const W = Math.round(fx.w * fx.dpr), H = Math.round(fx.h * fx.dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    if (cur) measure(cur);
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fxResize()) : null;
  ro?.observe(canvas);
  const onWinResize = () => { if (!ro) fxResize(); };
  addEventListener('resize', onWinResize);

  function addPart(p) { if (fx.parts.length < maxParts()) { fx.parts.push(p); return p; } return null; }
  function spark(x, y, vx, vy, life, size, opt = {}) {
    return addPart({ k: 'spark', x, y, vx, vy, age: 0, life, size, a: opt.a ?? 1, g: opt.g ?? 60, drag: opt.drag ?? 1.6, seed: Math.random() * 99, streak: opt.streak ?? 0 });
  }
  function mote(x, y, opt = {}) {
    return addPart({ k: 'mote', x, y, vx: rnd(-6, 6), vy: opt.vy ?? rnd(-16, -6), age: 0, life: opt.life ?? rnd(1.6, 3.2), size: opt.size ?? rnd(2.5, 5), a: opt.a ?? 0.7, seed: Math.random() * 99 });
  }
  function burst(x, y, n, power = 1) {
    n = Math.round(n * quality);
    for (let i = 0; i < n; i++) {
      const ang = rnd(0, Math.PI * 2), sp = rnd(50, 170) * power;
      spark(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp * 0.7 - 30, rnd(0.45, 0.95), rnd(2.2, 4.6), { streak: 0.045, g: 90 });
    }
    addPart({ k: 'streak', x, y, age: 0, life: 0.75, w0: 30, w1: 300 * power, h: 9, a: 0.75 });
    addPart({ k: 'star', x, y, age: 0, life: 0.6, size: 74 * power, a: 1, rot: rnd(-0.2, 0.2) });
    addPart({ k: 'flash', x, y, age: 0, life: 0.6, size: 120 * power, a: 0.6 });
  }
  function twinkle(x, y, size = 34, life = 0.5, a = 0.9) { return addPart({ k: 'star', x, y, age: 0, life, size, a, rot: rnd(-0.3, 0.3) }); }

  function fxStep(dt, t) {
    const ps = fx.parts;
    if (!ps.length && !fx.dirty && !nib.on) return;
    const c = ctx, d = fx.dpr;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, fx.w, fx.h);
    c.globalCompositeOperation = 'lighter';
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      let alive = true;
      if (p.k === 'dust') {
        // polvo de oro que viaja por una curva hasta su letra
        if (t < p.t1) { // flotando en su origen
          const f = clamp((t - p.t0) / 450);
          const x = p.x0 + Math.sin(t / 380 + p.seed) * 3, y = p.y0 + Math.cos(t / 450 + p.seed) * 3;
          drawSpr(SPR_GOLD, x, y, p.size, 0.55 * f * p.a);
        } else if (t < p.t2) {
          const u = easeIO3((t - p.t1) / (p.t2 - p.t1)), v = 1 - u;
          const x = v * v * p.x0 + 2 * v * u * p.cx + u * u * p.x1;
          const y = v * v * p.y0 + 2 * v * u * p.cy + u * u * p.y1;
          drawSpr(SPR_GOLD, x, y, p.size * (1 + 0.5 * Math.sin(u * Math.PI)), (0.55 + 0.45 * u) * p.a);
        } else {
          const f = (t - p.t2) / 320;
          if (f >= 1) alive = false; else drawSpr(SPR_GOLD, p.x1, p.y1, p.size * (1 - 0.6 * f), (1 - f) * p.a);
        }
      } else if (p.age >= p.life) {
        alive = false;
      } else if (p.k === 'spark') {
        p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; p.vy += p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const f = 1 - p.age / p.life;
        const fl = 0.7 + 0.3 * Math.sin(p.age * 38 + p.seed);
        if (p.streak) {
          c.globalAlpha = 0.5 * f * p.a; c.strokeStyle = '#f3d79f'; c.lineWidth = Math.max(0.6, p.size * 0.32);
          c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * p.streak, p.y - p.vy * p.streak); c.stroke();
        }
        drawSpr(SPR_GOLD, p.x, p.y, p.size * (0.5 + 0.5 * f) * 2.2, f * fl * p.a);
      } else if (p.k === 'mote') {
        p.x += (p.vx + Math.sin(p.age * 1.7 + p.seed) * 6) * dt; p.y += p.vy * dt;
        const f = p.age / p.life, a = Math.sin(Math.PI * f);
        drawSpr(SPR_GOLD, p.x, p.y, p.size * 2, a * p.a * (0.75 + 0.25 * Math.sin(p.age * 9 + p.seed)));
      } else if (p.k === 'streak') { // destello anamórfico horizontal
        const f = p.age / p.life, w = p.w0 + (p.w1 - p.w0) * easeOut3(f), hh = p.h * (1 - 0.6 * f);
        drawSpr(SPR_GOLD, p.x, p.y, w, (1 - f) * (1 - f) * p.a, hh);
      } else if (p.k === 'star') { // destello estelar: crece y se apaga girando apenas
        const f = p.age / p.life, sz = p.size * Math.sin(Math.PI * Math.min(1, f * 1.25 + 0.05));
        if (sz > 1) {
          c.save(); c.translate(p.x, p.y); c.rotate(p.rot + f * 0.5);
          c.globalAlpha = Math.min(1, p.a * (1 - f * 0.6)); c.drawImage(SPR_STAR, -sz / 2, -sz / 2, sz, sz); c.restore();
        }
      } else if (p.k === 'flash') {
        const f = p.age / p.life;
        drawSpr(SPR_SOFT, p.x, p.y, p.size * (0.7 + 0.5 * f), (1 - f) * (1 - f) * p.a);
      }
      if (!alive) { ps[i] = ps[ps.length - 1]; ps.pop(); }
    }
    if (nib.on) { // la pluma: punto incandescente + halo
      drawSpr(SPR_SOFT, nib.x, nib.y, 54, 0.7);
      drawSpr(SPR_GOLD, nib.x, nib.y, 15, 1);
    }
    c.globalAlpha = 1;
    fx.dirty = ps.length > 0 || nib.on;
  }
  function drawSpr(s, x, y, size, a, hgt = size) {
    if (a <= 0.004) return;
    ctx.globalAlpha = a > 1 ? 1 : a;
    ctx.drawImage(s, x - size / 2, y - hgt / 2, size, hgt);
  }
  function clearFx() { fx.parts.length = 0; nib.on = false; fx.dirty = true; }

  // ----- frases -----
  const nib = { on: false, x: 0, y: 0 };
  let cur = null;            // frase visible
  const leaving = new Set(); // frases saliendo
  let barsLeft = 0, pendingSwap = false, phraseIdx = -1, lastPickRole = '';
  let lyricMode = false, lastLineAt = 0, accentCount = 0;
  let bandOn = false;

  const fontFor = (ph, style) => {
    const len = ph.lines.reduce((m, l) => Math.max(m, l.length), 0);
    if (ph.role === 'names') return { f: 'script', long: len > 22 };
    if (ph.role === 'date') return { f: 'caps', long: false };
    if (ph.role === 'verse') return { f: 'serif', long: len > 30 };
    if ((style === 'media' || style === 'climax') && len <= 32) return { f: 'script', long: len > 18 };
    return { f: 'serif', long: len > 34 };
  };

  function buildPhrase(ph, style) {
    const node = { ph, style, el: null, words: [], letters: [], born: nowMs(), settleAt: Infinity, exiting: false, write: null };
    const { f, long } = fontFor(ph, style);
    const el = document.createElement('div');
    el.className = `kx-phrase kx-phrase--${style} kx-f-${f}${long ? ' kx-long' : ''}`;
    let li = 0;
    for (const line of ph.lines) {
      const ln = document.createElement('div'); ln.className = 'kx-line';
      const parts = line.split(/\s+/).filter(Boolean);
      parts.forEach((word, wi) => {
        if (wi) ln.append(document.createTextNode(' '));
        const w = document.createElement('span'); w.className = 'kx-w';
        const W = { el: w, letters: [], line: li };
        for (const g of graphemes(word)) {
          const c = document.createElement('span'); c.className = 'kx-c'; c.textContent = g; c.dataset.kx = g;
          w.append(c); const L = { el: c, cx: 0, cy: 0, h: 0, w: W }; W.letters.push(L); node.letters.push(L);
        }
        ln.append(w); node.words.push(W);
      });
      el.append(ln); li++;
    }
    node.el = el;
    if (style === 'media') node.words.forEach(W => W.el.style.setProperty('--p', '0'));
    stageEl.append(el);
    measure(node);
    return node;
  }

  function measure(node) {
    const fr = canvas.getBoundingClientRect(); fx.rect = fr;
    for (const W of node.words) {
      const r = W.el.getBoundingClientRect();
      // .kx-w lleva un relleno de .22em/.34em (para trazos que sobresalen): lo descontamos
      const fs = parseFloat(getComputedStyle(W.el).fontSize) || 24;
      W.fs = fs;
      W.x = r.left - fr.left + 0.34 * fs; W.w = Math.max(4, r.width - 0.68 * fs);
      W.y = r.top - fr.top + 0.22 * fs; W.h = Math.max(4, r.height - 0.56 * fs);
      W.cx = W.x + W.w / 2; W.cy = W.y + W.h / 2;
    }
    for (const L of node.letters) {
      const r = L.el.getBoundingClientRect();
      L.cx = r.left - fr.left + r.width / 2; L.cy = L.w.cy + L.w.h * 0.08; L.h = L.w.h;
    }
  }

  function pickPhrase() {
    const list = PHRASES[stage] || PHRASES.hero;
    if (level === 'climax' && lastPickRole !== 'names') {
      const k = list.findIndex(p => p.role === 'names');
      if (k >= 0 && k !== phraseIdx) { phraseIdx = k; lastPickRole = 'names'; return list[k]; }
    }
    phraseIdx = (phraseIdx + 1) % list.length;
    lastPickRole = list[phraseIdx].role;
    return list[phraseIdx];
  }

  function barsFor(ph) {
    const chars = ph.lines.join(' ').length;
    let b = chars > 30 ? 3 : 2;
    if (level === 'climax' && chars <= 18) b = 2;
    return b;
  }

  let lastInBar = 0;
  function enterPhrase(ph, { fast = false } = {}) {
    if (!bandOn) return;
    const style = RM ? 'still' : level;
    const node = buildPhrase(ph, style);
    cur = node;
    barsLeft = barsFor(ph) + (lastInBar >= 2 ? 1 : 0); // si entra a mitad de compás, ese compás no cuenta
    accentCount = 0;
    const I = intensity;
    if (style === 'still') {
      animate(node.el, [{ opacity: 0 }, { opacity: 1 }], { duration: 1200, easing: 'ease-out', fill: 'backwards' });
      node.settleAt = nowMs() + 1200;
    } else if (style === 'calma') enterDust(node, fast, I);
    else if (style === 'suave') enterInk(node, fast);
    else if (style === 'media') enterWrite(node, fast);
    else enterBurst(node, fast, I);
  }

  // calma → letras que se materializan desde polvo de oro
  function enterDust(node, fast, I) {
    const Ls = node.letters, n = Ls.length;
    const first = fast ? 260 : Math.max(380, gridDelays(0.8, 1, 1)[0]);
    const spread = Math.min(2100, 140 + n * 62);
    const now = nowMs();
    const per = Math.max(1, Math.round((MOBILE ? 2 : 3) * quality * (0.6 + 0.4 * I)));
    Ls.forEach((L, i) => {
      const arrive = first + (n > 1 ? (i / (n - 1)) * spread : 0) + rnd(-40, 40);
      for (let k = 0; k < per; k++) {
        const flight = rnd(900, 1500);
        const x0 = clamp(L.cx + rnd(-0.42, 0.42) * fx.w, 6, fx.w - 6);
        const y0 = clamp(L.cy + rnd(-1, 0.6) * Math.max(60, fx.h * 0.55), 4, fx.h - 4);
        const mx = (x0 + L.cx) / 2, my = (y0 + L.cy) / 2;
        const nx = -(L.cy - y0), ny = L.cx - x0, nl = Math.hypot(nx, ny) || 1, bend = rnd(-0.35, 0.35) * nl;
        addPart({ k: 'dust', t0: now + arrive - flight - rnd(300, 700), t1: now + arrive - flight, t2: now + arrive + rnd(-30, 30),
          x0, y0, cx: mx + (nx / nl) * bend, cy: my + (ny / nl) * bend, x1: L.cx + rnd(-2, 2), y1: L.cy + rnd(-L.h * 0.25, L.h * 0.25),
          size: rnd(5, 9), a: rnd(0.65, 1), seed: Math.random() * 99, age: 0, life: 99 });
      }
      if (i % 3 === 1 || i === n - 1) after(arrive + 40, () => { if (!node.exiting && bandOn) twinkle(L.cx, L.cy - L.h * 0.1, 26 + L.h * 0.5, 0.6, 0.75); });
      animate(L.el, [
        { opacity: 0, transform: 'scale(1.32)', filter: 'blur(7px) brightness(2.4)' },
        { opacity: 1, transform: 'scale(1.03)', filter: 'blur(.6px) brightness(1.7)', offset: 0.42 },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px) brightness(1)' },
      ], { duration: 1050, delay: Math.max(0, arrive - 230), easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
    });
    node.settleAt = now + first + spread + 1100;
  }

  // suave → palabras que flotan y se entintan
  function enterInk(node, fast) {
    const Ws = node.words;
    const lands = fast ? Ws.map((_, i) => 600 + i * 220) : gridDelays(0.85, Ws.length, Ws.length > 6 ? 4 : 2);
    const D = 1600, OFF = 0.7;
    Ws.forEach((W, i) => {
      const land = lands[i];
      W.letters.forEach((L, j) => animate(L.el, [
        { opacity: 0, transform: 'translateY(.62em) scale(.95)', filter: 'blur(10px) brightness(2)' },
        { opacity: 0.9, transform: 'translateY(-.05em) scale(1)', filter: 'blur(1.4px) brightness(1.4)', offset: OFF },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px) brightness(1)' },
      ], { duration: D, delay: Math.max(0, land - D * OFF + j * 16), easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'backwards' }));
      // gota de tinta dorada que se expande bajo la palabra
      after(Math.max(0, land - 120), () => {
        if (node.exiting || !bandOn) return;
        addPart({ k: 'flash', x: W.cx, y: W.cy, age: 0, life: 1.5, size: Math.max(W.w, W.h * 2) * 1.5, a: 0.32 });
      });
      // flotación lenta y continua (compositor)
      // ola coherente: mismo periodo, fase que avanza por palabra (se lee como una línea que respira, no como saltos)
      animate(W.el, [{ translate: '0 -1.8px' }, { translate: '0 1.8px' }],
        { duration: 2650, delay: -i * 260, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' });
    });
    node.settleAt = nowMs() + (lands[lands.length - 1] || 0) + D * 0.4;
  }

  // media → escritura caligráfica: la máscara avanza con una pluma de luz
  function enterWrite(node, fast) {
    const start = nowMs() + (fast ? 60 : 140);
    let t = start;
    const speed = fast ? 1.4 : 1;
    node.write = node.words.map(W => {
      const d = clamp(W.letters.length * 108, 320, 1150) / speed;
      const s = t; t += d + 80;
      return { s, d, done: false };
    });
    node.settleAt = t + 200;
  }

  // clímax → palabras que estallan con brillo
  function enterBurst(node, fast, I) {
    const Ws = node.words;
    const lands = fast ? Ws.map((_, i) => 280 + i * 200) : gridDelays(0.36, Ws.length, Ws.length > 6 ? 4 : 2);
    const D = 720, OFF = 0.42;
    Ws.forEach((W, i) => {
      const land = lands[i], n = W.letters.length, mid = (n - 1) / 2;
      W.letters.forEach((L, j) => {
        const dx = ((j - mid) * -0.16).toFixed(3);
        animate(L.el, [
          { opacity: 0, transform: `translate(${dx}em,.12em) scale(.25)`, filter: 'blur(10px) brightness(3)' },
          { opacity: 1, transform: 'translate(0em,0em) scale(1.16)', filter: 'blur(0px) brightness(2.1)', offset: OFF },
          { opacity: 1, transform: 'translate(0em,0em) scale(1)', filter: 'blur(0px) brightness(1)' },
        ], { duration: D, delay: Math.max(0, land - D * OFF + Math.abs(j - mid) * 14), easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'backwards' });
      });
      after(Math.max(0, land - 30), () => {
        if (node.exiting || !bandOn) return;
        burst(W.cx, W.cy, 12 + Math.min(10, n), 0.75 + 0.35 * I);
      });
    });
    node.settleAt = nowMs() + (lands[lands.length - 1] || 0) + D * 0.6;
  }

  function exitPhrase(node, { quick = false } = {}) {
    if (!node || node.exiting) return;
    node.exiting = true;
    if (cur === node) cur = null;
    leaving.add(node);
    nib.on = false;
    const style = node.style;
    let dur = 0;
    const done = () => { node.el.remove(); leaving.delete(node); };
    if (quick || style === 'still') {
      animate(node.el, [{ opacity: 1 }, { opacity: 0 }], { duration: quick ? 450 : 900, easing: 'ease-in', fill: 'forwards' });
      dur = quick ? 450 : 900;
    } else if (style === 'calma') {
      node.letters.forEach((L, i) => {
        animate(L.el, [
          { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
          { opacity: 0, transform: 'translateY(-.3em) scale(1.06)', filter: 'blur(7px)' },
        ], { duration: 1100, delay: i * 14, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
        if (i % 2 === 0) after(i * 14 + 250, () => mote(L.cx, L.cy, { vy: rnd(-22, -10), size: rnd(2.5, 4.5), a: 0.6 }));
      });
      dur = 1100 + node.letters.length * 14;
    } else if (style === 'suave') {
      node.words.forEach((W, i) => W.letters.forEach(L => animate(L.el, [
        { opacity: 1, transform: 'translateY(0)', filter: 'blur(0px)' },
        { opacity: 0, transform: 'translateY(-.55em)', filter: 'blur(8px)' },
      ], { duration: 1000, delay: i * 70, easing: 'cubic-bezier(.45,0,.7,.4)', fill: 'forwards' })));
      dur = 1000 + node.words.length * 70;
    } else if (style === 'media') {
      node.letters.forEach((L, i) => animate(L.el, [
        { opacity: 1, filter: 'blur(0px) brightness(1)' },
        { opacity: 0.7, filter: 'blur(1px) brightness(1.5)', offset: 0.3 },
        { opacity: 0, filter: 'blur(5px) brightness(1)' },
      ], { duration: 800, delay: i * 12, easing: 'ease-in', fill: 'forwards' }));
      dur = 800 + node.letters.length * 12;
    } else { // clímax: las letras se deshacen en chispas
      const n = node.letters.length;
      node.letters.forEach((L, i) => {
        const dx = rnd(-46, 46), dy = rnd(-70, -18), rot = rnd(-40, 40);
        animate(L.el, [
          { opacity: 1, transform: 'translate(0px,0px) rotate(0deg) scale(1)', filter: 'blur(0px) brightness(1)' },
          { opacity: 0.95, transform: `translate(${(dx * 0.2).toFixed(1)}px,${(dy * 0.2).toFixed(1)}px) rotate(${(rot * 0.2).toFixed(1)}deg) scale(1.08)`, filter: 'blur(0px) brightness(2.4)', offset: 0.22 },
          { opacity: 0, transform: `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(.45)`, filter: 'blur(5px) brightness(2.6)' },
        ], { duration: 820, delay: i * 15, easing: 'cubic-bezier(.3,.1,.3,1)', fill: 'forwards' });
        after(i * 15 + 140, () => {
          const k = Math.max(1, Math.round(2.5 * quality));
          for (let s = 0; s < k; s++) spark(L.cx + rnd(-4, 4), L.cy + rnd(-L.h * 0.3, L.h * 0.3), dx * rnd(0.6, 1.6), dy * rnd(0.8, 1.8), rnd(0.5, 1.1), rnd(2, 3.6), { g: 40, drag: 1.2, streak: 0.04 });
        });
      });
      dur = 820 + n * 15;
    }
    after(dur + 60, done);
  }

  function swap() {
    pendingSwap = false;
    if (cur) exitPhrase(cur);
    if (lyricMode) return;
    enterPhrase(pickPhrase());
  }

  let offTimer = 0;
  function purgeBand() {
    for (const n of [...leaving]) { n.el.remove(); leaving.delete(n); }
    if (cur) { cur.el.remove(); cur = null; }
    stageEl.replaceChildren();
    clearFx(); timers.length = 0;
  }
  function setBandOn(on) {
    if (on === bandOn) return;
    bandOn = on;
    band.classList.toggle('is-on', on);
    clearTimeout(offTimer); offTimer = 0;
    if (!on) {
      // la banda se desvanece con la frase quieta; después se limpia
      nib.on = false;
      offTimer = setTimeout(() => { offTimer = 0; if (!bandOn) purgeBand(); }, 1200);
    } else {
      purgeBand();
      fxResize();
      pendingSwap = true; // la primera frase entra en el siguiente pulso
    }
  }
  // ----- zonas que la banda no debe tapar: [data-kinetic-avoid] (p. ej. el texto del hero, botones) -----
  // Si un elemento marcado se ve (opacidad efectiva > 8 %) dentro de la franja de la banda, la banda se aparta
  // (se desvanece) y vuelve 0.35 s después de que la franja quede libre. Se mide cada ~140 ms, solo lecturas.
  let blocked = false, avoidAt = -1e9, clearSince = 0;
  function seenOpacity(el) {
    let o = 1;
    for (let n = el, k = 0; n && n !== document.body && k < 7; n = n.parentElement, k++) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      o *= parseFloat(cs.opacity) || 0;
      if (o < 0.08) return 0;
    }
    return o;
  }
  function avoidBlocked(t) {
    if (t - avoidAt < 140) return blocked;
    avoidAt = t;
    const list = document.querySelectorAll('[data-kinetic-avoid]');
    if (!list.length) { blocked = false; clearSince = 0; return false; }
    const b = stageEl.getBoundingClientRect(), top = b.top - 10, bot = b.bottom + 6;
    let hit = false;
    for (const el of list) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= top || r.top >= bot || r.right <= b.left || r.left >= b.right) continue;
      if (seenOpacity(el) > 0.08) { hit = true; break; }
    }
    if (hit) { blocked = true; clearSince = 0; } else if (blocked) {
      if (!clearSince) clearSince = t; else if (t - clearSince > 350) { blocked = false; clearSince = 0; }
    }
    return blocked;
  }
  const wantBand = () => enabled && BAND_STAGES.has(stage) && intensity > 0 && songPlaying() && fontsReady && !avoidBlocked(nowMs());

  function bandSweep(power) {
    if (!cur || cur.exiting || nowMs() < cur.settleAt) return;
    sweepLetters(cur.letters.map(L => L.el), power * (cur.style === 'calma' ? 0.55 : 0.85), cur.letters.length > 26 ? 24 : 34);
  }

  function bandBeat(downbeat, beatInBar, strength) {
    lastInBar = downbeat ? 0 : beatInBar;
    if (!bandOn) return;
    if (downbeat && !RM) {
      animate(ruleI, [
        { transform: 'scaleX(.42)', opacity: 0.5 },
        { transform: 'scaleX(1)', opacity: 1, offset: 0.16 },
        { transform: 'scaleX(.42)', opacity: 0.5 },
      ], { duration: 1600, easing: 'cubic-bezier(.2,.7,.2,1)' });
      animate(ruleB, [
        { transform: 'rotate(45deg) scale(.55)', opacity: 0.7 },
        { transform: 'rotate(45deg) scale(1.05)', opacity: 1, offset: 0.14 },
        { transform: 'rotate(45deg) scale(.55)', opacity: 0.7 },
      ], { duration: 1300, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
    if (lyricMode) { if (downbeat) bandSweep(0.7 + 0.3 * strength); return; }
    if (!cur || pendingSwap) { if (fontsReady) swap(); return; }
    if (downbeat) {
      barsLeft--;
      if (barsLeft <= 0) { swap(); return; }
      bandSweep(0.7 + 0.3 * strength);
    } else if (beatInBar === 3 && barsLeft === 1) {
      exitPhrase(cur); // sale un pulso antes para que la nueva aterrice en el tiempo fuerte
    }
  }

  function bandAccent(s) {
    if (!bandOn || !cur || cur.exiting || RM) return;
    const settled = nowMs() >= cur.settleAt;
    if (cur.style === 'climax' && settled) {
      const W = cur.words[accentCount++ % cur.words.length];
      const p = 0.6 + 0.6 * clamp(s);
      animate(W.el, [{ scale: '1' }, { scale: `${(1 + 0.075 * p).toFixed(3)}`, offset: 0.2 }, { scale: '1' }], { duration: 950, easing: 'cubic-bezier(.2,.8,.2,1)' });
      sweepLetters(W.letters.map(L => L.el), 0.9 + 0.3 * clamp(s), 26);
      burst(W.cx, W.cy, 8 + 8 * s, 0.55 + 0.4 * s);
    } else if ((cur.style === 'suave' || cur.style === 'media') && settled) {
      waveLetters(cur.letters.map(L => L.el), s * 0.8, cur.letters.length > 26 ? 20 : 30);
    } else if (cur.style === 'calma') {
      const k = Math.round(3 * quality);
      for (let i = 0; i < k; i++) { const L = cur.letters[(Math.random() * cur.letters.length) | 0]; if (L) mote(L.cx, L.cy, { vy: rnd(-26, -12) }); }
    }
  }

  // actualización por fotograma de la banda
  function bandFrame(t, dt) {
    if (!bandOn) return;
    const node = cur;
    if (node && !RM) {
      if (node.style === 'media' && node.write) {
        let active = null;
        node.write.forEach((w, k) => {
          if (w.done) return;
          const W = node.words[k];
          const p = clamp((t - w.s) / w.d);
          if (p <= 0) return;
          const pv = p < 1 ? p * 0.82 + easeIO3(p) * 0.18 : 1; // avance casi lineal, con ataque y remate suaves
          W.el.style.setProperty('--p', pv.toFixed(4));
          if (p >= 1) {
            w.done = true; W.el.classList.add('kx-written');
            twinkle(W.x + W.w, W.cy - W.h * 0.15, 22 + W.h * 0.5, 0.55, 0.8);
            sweepLetters(W.letters.map(L => L.el), 1, 22); // la tinta recién escrita brilla y se asienta
          } else if (!active) active = { W, p: pv };
        });
        if (active) {
          const { W, p } = active;
          const n = W.letters.length;
          nib.on = true;
          nib.x = W.x + W.w * p;
          nib.y = W.cy + Math.sin(p * n * Math.PI * 1.15) * W.h * 0.2 - W.h * 0.04;
          if (Math.random() < 0.55 * quality) spark(nib.x, nib.y, rnd(-18, 10), rnd(8, 40), rnd(0.35, 0.8), rnd(1.6, 3), { g: 70, drag: 2 });
        } else nib.on = false;
      } else if (node.style === 'climax' && t > node.settleAt && Math.random() < dt * 5 * quality * intensity) {
        const L = node.letters[(Math.random() * node.letters.length) | 0];
        if (L) spark(L.cx + rnd(-6, 6), L.cy - L.h * 0.3, rnd(-10, 10), rnd(-60, -25), rnd(0.7, 1.4), rnd(1.8, 3.2), { g: -10, drag: 0.8 });
      }
    }
    // polvo ambiental por sección
    const amb = (level === 'calma' ? 2.2 : level === 'suave' ? 1.2 : level === 'climax' ? 1.6 : 0.6) * quality * intensity;
    if (!RM && Math.random() < dt * amb) mote(rnd(0.12, 0.88) * fx.w, fx.h - rnd(20, 70), { vy: rnd(-18, -8), a: 0.45 });
  }

  // ---------- letra del usuario (LRC) ----------
  function showLine(l) {
    if (l && l.text && String(l.text).trim()) {
      lyricMode = true; lastLineAt = nowMs();
      if (!bandOn) return;
      if (cur) exitPhrase(cur);
      enterPhrase({ lines: [String(l.text).trim()], role: 'lyric' }, { fast: true });
      barsLeft = Infinity;
    } else if (cur && lyricMode) {
      exitPhrase(cur);
    }
  }

  // =================================================================================================================
  // Eventos de la canción
  // =================================================================================================================
  function onBeat(i, time, info = {}) {
    if (disposed) return;
    lastBeatPerf = nowMs(); lastBeatSong = time ?? -1; beatCounter++;
    const ph = A()?.downbeatPhase ?? 0;
    const inBar = Number.isFinite(info.beatInBar) ? info.beatInBar
      : Number.isFinite(i) && A() ? (((i - ph) % 4) + 4) % 4 : sinceDown % 4;
    const downbeat = info.downbeat ?? inBar === 0;
    sinceDown = downbeat ? 1 : sinceDown + 1;
    const strength = Number.isFinite(info.strength) ? info.strength : 0.5;
    if (!enabled || RM || !flags.beats) { if (enabled) bandBeat(downbeat, inBar, strength); return; }
    const strong = downbeat || strength >= 0.72;
    const P = Number.isFinite(info.period) ? info.period : period();
    for (const h of hosts) {
      if (!h.visible || h.held) continue;
      if (h.mode === 'letters' && h.letters.length) {
        if (flags.breath) breathBeat(h.letters, h.ph, P);
        if (strong && flags.sweep) sweepLetters(h.letters, 0.75 + 0.35 * strength, h.letters.length > 24 ? 28 : 42);
      } else if (h.mode === 'pulse' && downbeat && flags.pulse) pulseHost(h, strength);
    }
    if (flags.breath && cur && !cur.exiting && eLow * intensity > 0.06) {
      const a = 0.024 * eLow * intensity;
      animate(cur.el, [{ scale: '1' }, { scale: (1 + a).toFixed(4), offset: 0.28 }, { scale: '1' }], { duration: Math.max(400, P * 970), easing: 'cubic-bezier(.33,0,.45,1)' });
    }
    bandBeat(downbeat, inBar, strength);
  }
  function onAccent(time, s = 0.5) {
    if (disposed || !enabled || RM || !flags.beats) return;
    if (flags.wave) for (const h of hosts) if (h.visible && !h.held && h.mode === 'letters' && h.letters.length && s > 0.25) waveLetters(h.letters, s);
    bandAccent(s);
  }
  function onSection(sec) {
    if (disposed || !sec) return;
    const lv = LEVEL_ALIAS[String(sec.level || '').toLowerCase()] || 'suave';
    if (lv !== level) { level = lv; band.dataset.level = lv; if (bandOn && !lyricMode) pendingSwap = true; }
  }

  if (song) {
    try { if (song.onBeat) offs.push(song.onBeat(onBeat)); } catch {}
    try { if (song.onAccent) offs.push(song.onAccent(onAccent)); } catch {}
    try { if (song.onSection) offs.push(song.onSection(onSection)); } catch {}
    try { if (song.onLine) offs.push(song.onLine(showLine)); } catch {}
    if (song.hasLyrics) lyricMode = true;
    // nivel inicial a partir del análisis
    try {
      const secs = A()?.sections, t = song.currentTime || 0;
      const s = secs?.find(x => t >= x.start && t < x.end);
      if (s) level = LEVEL_ALIAS[s.level] || level;
    } catch {}
  }
  band.dataset.level = level; band.dataset.stage = stage;

  // =================================================================================================================
  // Bucle único
  // =================================================================================================================
  function frame(t) {
    raf = 0;
    if (disposed || !enabled) return;
    if (document.hidden) { lastFrame = 0; return; } // se reanuda con visibilitychange
    raf = requestAnimationFrame(frame);
    const dt = lastFrame ? Math.min(0.1, (t - lastFrame) / 1000) : 1 / 60;
    lastFrame = t;
    // fps + calidad automática
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) {
      fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      if (fps < 46) lowFor += 0.5; else lowFor = Math.max(0, lowFor - 0.25);
      if (autoQuality && lowFor >= 2 && quality > 0.4) { quality = Math.max(0.4, quality - 0.2); lowFor = 0; highFor = 0; }
      if (fps > 55) highFor += 0.5; else highFor = 0;
      if (highFor >= 6 && quality < qMax) { quality = Math.min(qMax, quality + 0.1); highFor = 0; }
    }
    // temporizadores
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= t) { const tm = timers[i]; timers.splice(i, 1); try { tm.fn(); } catch {} }
    // energía (suavizada: ataque rápido, caída lenta)
    const e = songPlaying() && song.getEnergy ? song.getEnergy() : null;
    const tl = e ? clamp(e.low) : 0, tr = e ? clamp(e.rms) : 0, th = e ? clamp(e.high) : 0;
    const kA = 1 - Math.exp(-dt * 14), kR = 1 - Math.exp(-dt * 3.2);
    eLow += (tl - eLow) * (tl > eLow ? kA : kR); eRms += (tr - eRms) * (tr > eRms ? kA : kR); eHigh += (th - eHigh) * (th > eHigh ? kA : kR);
    // metrónomo de respaldo si la canción suena pero no emite pulsos
    if (songPlaying() && lastBeatPerf && t - lastBeatPerf > period() * 3000) onBeat(NaN, -1, { strength: 0.4 });
    else if (songPlaying() && !lastBeatPerf && beatCounter === 0 && t > 4000) { lastBeatPerf = t; }
    // banda visible o no
    setBandOn(wantBand());
    if (lyricMode && !song?.hasLyrics && t - lastLineAt > 14000 && !(cur && cur.ph.role === 'lyric')) lyricMode = false;
    // letras que respiran
    if (flags.band) bandFrame(t, dt);
    if (flags.fx) fxStep(dt, t);
  }
  const start = () => { if (!raf && enabled && !disposed && !document.hidden) { lastFrame = 0; raf = requestAnimationFrame(frame); } };
  const onVis = () => { if (!document.hidden) start(); };
  document.addEventListener('visibilitychange', onVis);

  scan();
  start();

  // =================================================================================================================
  // API pública
  // =================================================================================================================
  let tracker = null;
  const untrack = () => { if (tracker) { tracker(); tracker = null; } };
  const api = {
    setStage(name) {
      if (disposed) return;
      const s = name in STAGE_INTENSITY ? name : 'hero';
      scan();
      if (s === stage) return;
      stage = s; intensity = STAGE_INTENSITY[s]; band.dataset.stage = s;
      phraseIdx = -1; lastPickRole = '';
      if (bandOn && BAND_STAGES.has(s) && !lyricMode) pendingSwap = true;
      setBandOn(wantBand());
    },
    setEnabled(on) {
      on = !!on;
      if (disposed || on === enabled) return;
      enabled = on;
      if (!on) {
        cancelAnimationFrame(raf); raf = 0;
        setBandOn(false);
        for (const h of hosts) {
          if (h.mode === 'letters') { resetBreath(h); h.el.classList.remove('kx-live'); h.letters.forEach(L => L.getAnimations?.({ subtree: true }).forEach(a => a.cancel())); }
          if (h.mode === 'title' && !h.revealed) { h.revealed = true; h.el.classList.remove('kx-title--pending'); }
          if (h.mode === 'pulse') h.el.getAnimations?.().forEach(a => a.cancel());
        }
      } else {
        for (const h of hosts) if (h.mode === 'letters' && h.visible && !h.held) h.el.classList.add('kx-live');
        start();
      }
    },
    refresh() { scan(); },
    /** PERF: pausa (on = true) o reanuda un anfitrión data-kinetic sin desmontarlo: no respira, no brilla, no ondea.
     *  main.js lo usa con .hero__names mientras GSAP revela las letras (las dos capas de animación a la vez costaban ~10 fps). */
    hold(el, on = true) {
      if (!el || disposed) return;
      if (on) heldEls.add(el); else heldEls.delete(el);
      const h = hosts.find(x => x.el === el);
      if (!h) return;
      h.held = !!on;
      if (h.mode !== 'letters') return;
      if (on) { resetBreath(h); h.el.classList.remove('kx-live'); }
      else h.el.classList.toggle('kx-live', !!h.visible && enabled);
    },
    /**
     * Cambia de escena sola según la sección que cruza la línea de lectura (por defecto, el centro de la pantalla).
     * map: { hero: '#inicio', pergamino: '#pergamino', historia: '#historia', momentos: '#momentos', final: '#final' }
     * (selectores o elementos). Sin escucha de scroll: un IntersectionObserver avisa al cruzar la línea.
     * Devuelve una función para dejar de seguir. Llamarla DESPUÉS de la puerta (mientras tanto, setStage('gate')).
     */
    track(map = {}, { line = 0.5 } = {}) {
      untrack();
      if (disposed || typeof IntersectionObserver !== 'function') return noop;
      const list = Object.entries(map)
        .map(([name, s]) => [name, typeof s === 'string' ? document.querySelector(s) : s])
        .filter(([name, el]) => el && name in STAGE_INTENSITY);
      if (!list.length) return noop;
      const pick = () => {
        if (disposed) return;
        const y = innerHeight * line;
        for (const [name, el] of list) { const r = el.getBoundingClientRect(); if (r.top <= y && r.bottom > y) { api.setStage(name); return; } }
      };
      const pct = clamp(line, 0.02, 0.97) * 100;
      const obs = new IntersectionObserver(pick, { rootMargin: `-${pct.toFixed(2)}% 0px -${(99 - pct).toFixed(2)}% 0px`, threshold: 0 });
      list.forEach(([, el]) => obs.observe(el));
      addEventListener('resize', pick, { passive: true });
      pick();
      tracker = () => { obs.disconnect(); removeEventListener('resize', pick); };
      return untrack;
    },
    dispose() {
      if (disposed) return;
      untrack();
      api.setEnabled(false);
      disposed = true;
      offs.forEach(f => { try { f?.(); } catch {} }); offs.length = 0;
      io?.disconnect(); ro?.disconnect(); clearTimeout(offTimer);
      removeEventListener('resize', onWinResize);
      document.removeEventListener('visibilitychange', onVis);
      for (const h of hosts) { try { h.restore(); if (!h.el.getAttribute('style')) h.el.removeAttribute('style'); } catch {} }
      hosts.length = 0;
      if (bandOwned) band.remove(); else { band.innerHTML = ''; band.classList.remove('kx-band', 'is-on', 'kx-rm'); }
    },
    get fps() { return Math.round(fps); },
    get stage() { return stage; },
    get level() { return level; },
    get quality() { return quality; },
    debug: {
      flags,
      get state() {
        return { enabled, stage, level, intensity, quality, bandOn, blocked, lyricMode, phrase: cur ? cur.ph.lines.join(' / ') : null, style: cur?.style ?? null,
          particles: fx.parts.length, hosts: hosts.map(h => h.mode), energy: { low: +eLow.toFixed(3), rms: +eRms.toFixed(3) }, beats: beatCounter };
      },
      replayTitles() {
        for (const h of hosts) if (h.mode === 'title') { h.revealed = false; h.letters.forEach(L => (L.el || L).getAnimations?.().forEach(a => a.cancel())); if (!RM) h.el.classList.add('kx-title--pending'); if (h.visible) revealTitle(h); }
      },
      swap() { pendingSwap = true; },
      setLevel(lv) { onSection({ level: lv }); },
    },
  };
  return api;
}

export default mountKinetic;
