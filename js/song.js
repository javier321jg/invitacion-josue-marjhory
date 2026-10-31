// js/song.js — SONG: la canción elegida por el usuario (assets/audio/cancion.mp3) con sincronía musical.
//
// Cadena de audio:  <audio> (preload auto, streaming) → MediaElementAudioSourceNode → loopGain (fundido de bucle)
//                   → master (volumen, fade-in, mute) → duckGain (duck) → AnalyserNode → destino.
// Sincronía: assets/audio/cancion-analisis.json (pulsos, fuerza, compás, acentos, energía por bandas, secciones) leído contra
// audio.currentTime, suavizado con performance.now() y compensado con la latencia de salida (baseLatency + outputLatency).
// Letra: assets/audio/letra.lrc (opcional; la llena el usuario). Este módulo NUNCA contiene versos de la canción.
// SFX: delega en opts.music.sfx (js/music.js, creado con createMusic({ background: false })).
//
// Contrato (SPEC.md, "Decisión del usuario n.º 2"):
//   createSong(opts?) → Promise<{ start, toggle, setMuted, playing, duck, onBeat, onAccent, onSection, onLine, getEnergy,
//                                 currentTime, duration, analysis, analyser, sfx, ... }>
// Extras: seek(t), getBeatPhase(), lyrics, hasLyrics, section, line, audio, context, latency, stats, onLoop(cb), dispose().

const HERE = import.meta.url;
const BAND_KEYS = ['rms', 'low', 'mid', 'high'];
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Primer índice i con arr[i] >= t (arr ordenado; key opcional para arreglos de objetos). */
function lowerBound(arr, t, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    const v = key ? arr[m][key] : arr[m];
    if (v < t) lo = m + 1; else hi = m;
  }
  return lo;
}

/**
 * Lee texto LRC: líneas "[mm:ss.xx] texto" (admite varias marcas por línea, [offset:±ms], etiquetas [ar:]/[ti:],
 * marcas de palabra <mm:ss.xx> y comentarios que empiezan con #, // o ;). Una marca con texto vacío cierra la línea anterior.
 * @returns {{ text: string, start: number, end: number, index: number }[]}
 */
export function parseLRC(text, duration = Infinity) {
  if (typeof text !== 'string' || !text) return [];
  const raw = [];
  let offset = 0;
  const tagRe = /^\[(\d{1,3}):(\d{1,2})(?:[.:,](\d{1,3}))?\]/;
  for (const src of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = src.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;
    const off = line.match(/^\[offset\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\]$/i);
    if (off) { offset = Number(off[1]) / 1000 || 0; continue; }
    if (/^\[[a-z#]+\s*:/i.test(line)) continue; // metadatos [ar:], [ti:], [al:], [by:], [length:]…
    let rest = line, m;
    const times = [];
    while ((m = rest.match(tagRe))) {
      times.push(Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0));
      rest = rest.slice(m[0].length).trimStart();
    }
    if (!times.length) continue;
    const body = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:,]\d{1,3})?>/g, '').replace(/\s+/g, ' ').trim();
    for (const t of times) raw.push({ start: Math.max(0, t - offset), text: body });
  }
  raw.sort((a, b) => a.start - b.start);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    if (!r.text) continue;
    const next = raw[i + 1];
    const end = Math.min(next ? next.start : r.start + 6, duration);
    if (end <= r.start) continue;
    lines.push({ text: r.text, start: r.start, end, index: lines.length });
  }
  return lines;
}

async function fetchWithTimeout(url, ms, as = 'json') {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ac?.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac?.signal, cache: 'no-cache' });
    if (!r.ok) return null;
    return as === 'json' ? await r.json() : await r.text();
  } catch { return null; } finally { clearTimeout(timer); }
}

/**
 * @param {{ src?: string, analysisUrl?: string, lrcUrl?: string, music?: any, volume?: number,
 *           loopFrom?: 'start'|'suave'|number, fadeIn?: number, visualLead?: number,
 *           title?: string, artist?: string, autoUnlock?: boolean }} [opts]
 */
export async function createSong(opts = {}) {
  const doc = typeof document !== 'undefined' ? document : null;
  const resolve = (p, def) => (p ? new URL(p, doc?.baseURI || HERE).href : new URL(def, HERE).href);
  const src = resolve(opts.src, '../assets/audio/cancion.mp3');
  const analysisUrl = resolve(opts.analysisUrl, '../assets/audio/cancion-analisis.json');
  const lrcUrl = opts.lrcUrl === null ? null : resolve(opts.lrcUrl, '../assets/audio/letra.lrc');
  const music = opts.music || null;
  const VOLUME = clamp01(opts.volume ?? 0.9);
  const FADE_IN = opts.fadeIn ?? 2.5;
  const LOOP_FADE_OUT = 3.2, LOOP_FADE_IN = 2.6, MUTE_OUT = 0.7, UNMUTE_IN = 1.2;
  // El evento sale ~medio cuadro antes (el cambio se pinta en el siguiente frame): se adapta al ritmo real de frames.
  const FIXED_LEAD = Number.isFinite(opts.visualLead) ? opts.visualLead : null;
  let frameDt = 1 / 60, lead = FIXED_LEAD ?? 0.008;
  const STALE = 0.22;                            // pulsos más viejos que esto (tirón, pestaña oculta) se saltan sin disparar

  // ---------- elemento de audio (empieza a bajar ya, en streaming) ----------
  const audio = new Audio();
  // FIX: antes del toque solo los metadatos (duración): con preload='auto' se bajaban ~2.3 MB que competían con la puerta y
  // los anillos (y se perdían si el invitado entraba sin música). start() pasa a 'auto'; con HTTP Range arranca en < 1 s
  // y el fundido de entrada de 2.5 s lo cubre.
  audio.preload = 'metadata';
  audio.loop = false;
  audio.setAttribute('playsinline', '');
  audio.src = src;
  try { audio.load(); } catch {}

  // ---------- análisis + letra (en paralelo; no bloquean más de 6 s) ----------
  let analysis = null, beats = [], strengths = [], accents = [], sections = [], energy = null, efps = 20, dbPhase = 0;
  let lyrics = [];
  let loopIn = 0, loopOut = Infinity;
  // reloj suavizado y punteros de despacho
  let est = 0, lastCt = -1, lastNow = 0, heard = 0, prevHeard = 0, needResync = true;
  let nextBeat = 0, nextAccent = 0, curSection = -1, curLine = -1;

  function setAnalysis(a) {
    if (!a || !Array.isArray(a.beats)) return;
    analysis = a;
    beats = a.beats;
    strengths = Array.isArray(a.beatStrength) ? a.beatStrength : beats.map(() => 0.5);
    accents = Array.isArray(a.accents) ? a.accents : [];
    sections = (Array.isArray(a.sections) ? a.sections : []).map((s, index) => ({ ...s, index }));
    energy = a.energy && Array.isArray(a.energy.rms) ? a.energy : null;
    efps = a.energyFps || 20;
    dbPhase = Number.isFinite(a.downbeatPhase) ? a.downbeatPhase : 0;
    computeLoopPoints();
    needResync = true;
  }

  function computeLoopPoints() {
    const dur = songDuration();
    // Recorta el silencio del final y del principio con la envolvente rms (umbral ~2 %)
    if (energy) {
      const r = energy.rms;
      let last = r.length - 1;
      while (last > 0 && r[last] < 5) last--;
      let first = 0;
      while (first < r.length - 1 && r[first] < 5) first++;
      loopOut = Math.min(dur - 0.05, (last + 1) / efps + 0.25);
      loopIn = Math.max(0, first / efps - 0.08);
    } else {
      loopOut = Number.isFinite(dur) ? dur - 0.05 : Infinity;
      loopIn = 0;
    }
    const from = opts.loopFrom;
    if (typeof from === 'number') loopIn = Math.max(0, from);
    else if (from === 'suave') { const s = sections.find(x => x.level === 'suave'); if (s) loopIn = s.start; }
  }

  const analysisP = fetchWithTimeout(analysisUrl, 15000, 'json');
  const lrcP = lrcUrl ? fetchWithTimeout(lrcUrl, 8000, 'text') : Promise.resolve(null);
  const settle = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(undefined), ms))]);
  const [a0, l0] = await Promise.all([settle(analysisP, 6000), settle(lrcP, 4000)]);
  if (a0) setAnalysis(a0); else analysisP.then(a => a && !analysis && setAnalysis(a));
  const applyLrc = txt => { if (typeof txt === 'string') { lyrics = parseLRC(txt, songDuration()); needResync = true; } };
  if (l0 !== undefined) applyLrc(l0); else lrcP.then(applyLrc);

  function songDuration() {
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return analysis?.duration || 0;
  }
  const onMeta = () => { computeLoopPoints(); lyrics = lyrics.map(l => ({ ...l, end: Math.min(l.end, songDuration() || l.end) })); };
  audio.addEventListener('loadedmetadata', onMeta);
  if (audio.readyState >= 1) onMeta(); // por si los metadatos llegaron durante el await

  // ---------- grafo de Web Audio ----------
  let ctx = null, srcNode = null, analyser = null, graphFailed = false;
  const params = {}; // loop, master, duck: { node?, fallback ramp state }

  // Parámetro de ganancia con dos backends: AudioParam (normal) o volumen del <audio> (sin Web Audio).
  function makeGain(name, initial) {
    const p = { name, node: null, v: initial, from: initial, to: initial, t0: 0, dur: 0, plan: null };
    params[name] = p;
    return p;
  }
  const gLoop = makeGain('loop', 1), gMaster = makeGain('master', 0), gDuck = makeGain('duck', 1);

  function ensureGraph() {
    if (ctx || graphFailed) return ctx;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) { graphFailed = true; return null; }
    let c = null;
    try {
      // 'balanced': la canción no se entrecorta y los SFX (mismo contexto) no llegan tarde respecto de la imagen
      try { c = new AC({ latencyHint: 'balanced' }); } catch { c = new AC(); }
      const loopNode = c.createGain(), masterNode = c.createGain(), duckNode = c.createGain();
      loopNode.gain.value = gLoop.v; masterNode.gain.value = gMaster.v; duckNode.gain.value = gDuck.v;
      const an = c.createAnalyser();
      an.fftSize = 2048; an.minDecibels = -92; an.maxDecibels = -18; an.smoothingTimeConstant = 0.7;
      // createMediaElementSource al final: si algo antes falla, el <audio> sigue sonando por su cuenta.
      const s = c.createMediaElementSource(audio);
      s.connect(loopNode); loopNode.connect(masterNode); masterNode.connect(duckNode); duckNode.connect(an); an.connect(c.destination);
      try { audio.volume = 1; audio.muted = false; } catch {}
      ctx = c; srcNode = s; analyser = an;
      gLoop.node = loopNode.gain; gMaster.node = masterNode.gain; gDuck.node = duckNode.gain;
      api.analyser = an;
      ctx.addEventListener?.('statechange', () => { if (ctx && ctx.state !== 'running' && wantPlay) armUnlock(); });
    } catch (e) {
      console.warn('[song] Web Audio no disponible, uso el <audio> directo:', e?.message || e);
      try { c?.close(); } catch {}
      graphFailed = true; ctx = null;
    }
    return ctx;
  }

  // Fundido por tramos cuadráticos ("hacia el silencio" lento al subir y rápido al bajar: suena natural).
  function fade(p, to, secs) {
    to = Math.max(0, to);
    if (p.node && ctx) {
      const t = ctx.currentTime, from = p.node.value;
      p.node.cancelScheduledValues(t);
      p.node.setValueAtTime(from, t);
      if (!(secs > 0.02) || Math.abs(to - from) < 1e-4) { p.node.linearRampToValueAtTime(to, t + 0.015); return; }
      const N = 12, up = to > from;
      for (let i = 1; i <= N; i++) {
        const x = i / N, s = up ? x * x : 1 - (1 - x) * (1 - x);
        p.node.linearRampToValueAtTime(from + (to - from) * s, t + secs * x);
      }
      return;
    }
    // backend de volumen del elemento
    p.from = gainValue(p); p.to = to; p.t0 = nowMs(); p.dur = Math.max(0, secs) * 1000; p.plan = null;
    applyElementVolume();
  }
  function gainValue(p) {
    if (p.node) return p.node.value;
    if (p.plan) { // duck en modo elemento: [bajar, mantener, subir]
      const e = nowMs() - p.plan.t0, { down, hold, up, low } = p.plan;
      if (e < down) return 1 + (low - 1) * (e / down);
      if (e < down + hold) return low;
      if (e < down + hold + up) return low + (1 - low) * ((e - down - hold) / up);
      p.plan = null; p.v = 1; return 1;
    }
    if (!p.dur) return (p.v = p.to);
    const x = clamp01((nowMs() - p.t0) / p.dur), up = p.to > p.from;
    const s = up ? x * x : 1 - (1 - x) * (1 - x);
    p.v = p.from + (p.to - p.from) * s;
    if (x >= 1) p.dur = 0;
    return p.v;
  }
  function applyElementVolume() {
    if (ctx || !graphFailed) return; // solo en modo sin Web Audio (si no, el volumen del <audio> también silenciaría el grafo)
    const v = clamp01(gainValue(gLoop) * gainValue(gMaster) * gainValue(gDuck));
    try { if (Math.abs(audio.volume - v) > 0.002) audio.volume = v; } catch {}
  }
  const audiblePresence = () => clamp01((gainValue(gLoop) * gainValue(gMaster)) / (VOLUME || 1));

  // ---------- estado ----------
  let started = false, muted = false, wantPlay = false, disposed = false;
  let pauseTimer = 0, raf = 0, unlockArmed = false;
  let loopPhase = 0; // 0 normal · 1 fundiendo al final · 2 saltando al inicio
  const subs = { beat: new Set(), accent: new Set(), section: new Set(), line: new Set(), loop: new Set() };
  const stats = { beats: 0, accents: 0, sections: 0, lines: 0, loops: 0, resyncs: 0, skipped: 0,
    drift: { max: 0, sum: 0, n: 0, last: 0, excess: 0 }, frame: { max: 0 }, clock: { max: 0, sum: 0, n: 0, over30: 0 }, latency: 0, startedAt: 0 };


  function latency() {
    if (!ctx) return 0;
    const l = (Number(ctx.baseLatency) || 0) + (Number(ctx.outputLatency) || 0);
    return l > 0 && l < 1 ? l : 0;
  }

  // Reloj de medios suavizado: audio.currentTime + extrapolación con performance.now() entre muestras.
  // Tras play/seek el navegador deja currentTime quieto mientras ceba el audio (~100-250 ms): no se extrapola
  // hasta ver que el reloj real se mueve (clockLive), así el primer pulso no sale adelantado.
  let clockLive = false, lastCtAt = 0;
  function readClock(now) {
    const ct = audio.currentTime || 0;
    const running = !audio.paused && !audio.seeking && audio.readyState >= 3;
    if (!running) { est = ct; lastCt = ct; lastNow = lastCtAt = now; clockLive = false; return est; }
    const rate = audio.playbackRate || 1;
    const pred = est + ((now - lastNow) / 1000) * rate;
    if (ct !== lastCt) {
      if (!clockLive) { clockLive = true; est = ct; }
      else {
        const err = ct - pred, a = Math.abs(err);
        // métrica de deriva: cuánto se separó el reloj extrapolado del reloj real al llegar cada muestra
        stats.clock.n++; stats.clock.sum += a; if (a > stats.clock.max) stats.clock.max = a; if (a > 0.03) stats.clock.over30++;
        est = a > 0.25 ? ct : pred + err * (err < 0 ? 0.5 : 0.3);
      }
      lastCt = ct; lastCtAt = now;
    } else if (clockLive) {
      // sin muestra nueva: extrapola poco; si el audio se atasca (>120 ms sin avanzar) se queda en el reloj real
      est = Math.min(pred, ct + (now - lastCtAt < 120 ? 0.07 * rate : 0));
    } else est = ct;
    lastNow = now;
    return est;
  }

  function emit(set, ...args) {
    for (const cb of set) { try { cb(...args); } catch (e) { console.warn('[song] callback:', e); } }
  }

  const beatInfo = i => {
    const inBar = (((i - dbPhase) % 4) + 4) % 4;
    return { strength: strengths[i] ?? 0.5, downbeat: inBar === 0, beatInBar: inBar, bar: Math.floor((i - dbPhase) / 4),
      period: (beats[i + 1] ?? beats[i] + 0.9) - beats[i] };
  };
  const sectionAt = t => { for (let i = 0; i < sections.length; i++) if (t >= sections[i].start && t < sections[i].end) return i; return -1; };
  const lineAt = t => {
    const i = lowerBound(lyrics, t + 1e-6, 'start') - 1;
    return i >= 0 && t < lyrics[i].end ? i : -1;
  };
  const sectionObj = i => (i >= 0 ? { start: sections[i].start, end: sections[i].end, level: sections[i].level, index: i, energy: sections[i].energy } : null);
  const lineObj = i => (i >= 0 ? { ...lyrics[i] } : null);

  function resync(t) {
    nextBeat = lowerBound(beats, t);
    nextAccent = lowerBound(accents, t, 't');
    stats.resyncs++;
    needResync = false;
  }

  // Despacha pulsos/acentos/secciones/letra para el tiempo escuchado t.
  function dispatch(t) {
    if (needResync || Math.abs(t - prevHeard) > 0.6) resync(t);
    else if (t < prevHeard) t = prevHeard; // monotónico ante el jitter: un pulso nunca se dispara dos veces
    const tt = t + lead;
    while (nextBeat < beats.length && beats[nextBeat] <= tt) {
      const i = nextBeat++, bt = beats[i];
      if (tt - bt > STALE) { stats.skipped++; continue; }
      const d = t - bt;
      stats.beats++; stats.drift.last = d; stats.drift.sum += Math.abs(d); stats.drift.n++;
      if (Math.abs(d) > stats.drift.max) stats.drift.max = Math.abs(d);
      // "excess": cuánto llevaba ya vencido el pulso en el frame anterior (retraso atribuible al algoritmo, no a frames lentos)
      const ex = Math.max(0, prevHeard + lead - bt);
      if (ex > stats.drift.excess) stats.drift.excess = ex;
      emit(subs.beat, i, bt, beatInfo(i));
    }
    while (nextAccent < accents.length && accents[nextAccent].t <= tt) {
      const a = accents[nextAccent++];
      if (tt - a.t > STALE) continue;
      stats.accents++;
      emit(subs.accent, a.t, a.s);
    }
    const si = sectionAt(t);
    if (si !== curSection) { curSection = si; if (si >= 0) { stats.sections++; emit(subs.section, sectionObj(si)); } }
    const li = lineAt(t);
    if (li !== curLine) { curLine = li; stats.lines++; emit(subs.line, lineObj(li)); }
    prevHeard = t;
  }

  let lastTick = 0;
  function tick(now) {
    raf = 0;
    if (disposed) return;
    if (lastTick) {
      const dt = Math.min(0.25, (now - lastTick) / 1000);
      if (dt > stats.frame.max) stats.frame.max = dt;
      frameDt += (Math.min(dt, 0.05) - frameDt) * 0.1;
      if (FIXED_LEAD === null) lead = Math.min(0.03, Math.max(0.004, frameDt * 0.5));
    }
    lastTick = now; stats.lead = lead;
    const media = readClock(now);
    stats.latency = latency();
    const raw = Math.max(0, media - stats.latency);
    heard = needResync || raw >= heard || heard - raw > 0.6 ? raw : heard;
    if (!audio.paused) dispatch(heard);
    checkLoop();
    applyElementVolume();
    if (shouldRun()) raf = requestAnimationFrame(tick);
  }
  const shouldRun = () => !disposed && started && !(doc && doc.hidden) && (!audio.paused || audiblePresence() > 0.001);
  function ensureLoop() {
    if (!raf && shouldRun()) { lastNow = nowMs(); lastTick = 0; raf = requestAnimationFrame(tick); }
  }

  // ---------- bucle de la canción sin silencio brusco ----------
  function checkLoop() {
    if (!started || audio.paused || loopPhase === 2 || !Number.isFinite(loopOut)) return;
    const t = audio.currentTime, rate = audio.playbackRate || 1;
    if (loopPhase === 0 && t >= loopOut - LOOP_FADE_OUT && t < loopOut) {
      loopPhase = 1;
      fade(gLoop, 0, Math.max(0.3, (loopOut - t) / rate));
    }
    if (loopPhase === 1 && t >= loopOut - 0.03) doLoop();
  }
  function doLoop() {
    if (loopPhase === 2) return;
    loopPhase = 2;
    fade(gLoop, 0, 0.02);
    const resume = () => {
      audio.removeEventListener('seeked', resume);
      loopPhase = 0;
      stats.loops++;
      needResync = true;
      if (wantPlay && audio.paused) audio.play().catch(() => armUnlock());
      fade(gLoop, 1, LOOP_FADE_IN);
      emit(subs.loop, loopIn);
      ensureLoop();
    };
    audio.addEventListener('seeked', resume);
    try { audio.currentTime = loopIn; } catch { resume(); return; }
    // Si el navegador no puede buscar (servidor sin Range), 'seeked' igual llega; red de seguridad por si no:
    setTimeout(() => { if (loopPhase === 2) resume(); }, 1500);
  }
  audio.addEventListener('timeupdate', () => { checkLoop(); applyElementVolume(); });
  audio.addEventListener('ended', () => { if (started && wantPlay) { loopPhase = 1; doLoop(); } });
  audio.addEventListener('seeking', () => {
    needResync = true; clockLive = false;
    if (loopPhase === 1 && audio.currentTime < loopOut - LOOP_FADE_OUT) { loopPhase = 0; fade(gLoop, 1, 0.3); }
  });
  audio.addEventListener('play', () => { needResync = true; clockLive = false; ensureLoop(); });
  audio.addEventListener('playing', () => { needResync = true; ensureLoop(); });

  // ---------- desbloqueo (por si start() llegó fuera del gesto o iOS suspendió el contexto) ----------
  const unlockEvents = ['pointerdown', 'touchend', 'keydown'];
  function armUnlock() {
    if (unlockArmed || disposed || opts.autoUnlock === false || typeof window === 'undefined') return;
    unlockArmed = true;
    unlockEvents.forEach(ev => window.addEventListener(ev, onUnlock, { capture: true, passive: true }));
  }
  function disarmUnlock() {
    if (!unlockArmed) return;
    unlockArmed = false;
    unlockEvents.forEach(ev => window.removeEventListener(ev, onUnlock, { capture: true }));
  }
  function onUnlock() {
    if (!wantPlay) { disarmUnlock(); return; }
    try { ctx?.resume?.(); } catch {}
    const p = audio.paused ? audio.play() : Promise.resolve();
    Promise.resolve(p).then(() => { if (!ctx || ctx.state === 'running') disarmUnlock(); ensureLoop(); }).catch(() => {});
  }

  // ---------- visibilidad: sigue sonando; al volver se resincroniza sin ráfagas ----------
  function onVisibility() {
    if (doc.hidden) return; // rAF se detiene solo; el bucle de la canción sigue por 'timeupdate'
    needResync = true;
    if (wantPlay && ctx && ctx.state !== 'running') { ctx.resume().catch(() => armUnlock()); }
    ensureLoop();
  }
  doc?.addEventListener('visibilitychange', onVisibility);

  // Media Session (controles de la pantalla de bloqueo)
  try {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      if (opts.title && typeof MediaMetadata !== 'undefined') navigator.mediaSession.metadata = new MediaMetadata({ title: opts.title, artist: opts.artist || '' });
      navigator.mediaSession.setActionHandler?.('play', () => api.setMuted(false));
      navigator.mediaSession.setActionHandler?.('pause', () => api.setMuted(true));
    }
  } catch {}

  // ---------- energía ----------
  let freq = null, td = null, eCache = null, eAt = -1;
  const liveMean = { rms: 0.5, low: 0.5, mid: 0.5, high: 0.5 }, preMean = { rms: 0.6, low: 0.6, mid: 0.6, high: 0.6 };
  function preEnergyAt(t, out) {
    const x = Math.max(0, t) * efps, i = Math.floor(x), f = x - i;
    for (const k of BAND_KEYS) {
      const arr = energy[k] || energy.rms, n = arr.length;
      const v0 = arr[Math.min(n - 1, i)] || 0, v1 = arr[Math.min(n - 1, i + 1)] || 0;
      out[k] = (v0 + (v1 - v0) * f) / 255;
    }
    return out;
  }
  function liveEnergy(out) {
    if (!analyser) return null;
    const n = analyser.frequencyBinCount;
    if (!freq || freq.length !== n) { freq = new Uint8Array(n); td = new Float32Array(analyser.fftSize); }
    analyser.getByteFrequencyData(freq);
    const hz = (ctx?.sampleRate || 48000) / analyser.fftSize;
    const band = (lo, hi) => {
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(n, Math.max(a + 1, Math.ceil(hi / hz)));
      let s = 0; for (let j = a; j < b; j++) s += freq[j];
      return s / (b - a) / 255;
    };
    out.low = band(30, 250); out.mid = band(250, 2500); out.high = band(2500, 9000);
    if (analyser.getFloatTimeDomainData) {
      analyser.getFloatTimeDomainData(td);
      let s = 0; for (let j = 0; j < td.length; j++) s += td[j] * td[j];
      const r = Math.sqrt(s / td.length);
      out.rms = clamp01(Math.log1p(r * 60) / 2.6);
    } else out.rms = (out.low + out.mid + out.high) / 3;
    return out;
  }
  function computeEnergy() {
    const out = { rms: 0, low: 0, mid: 0, high: 0 };
    if (!started) return out;
    const presence = audiblePresence();
    const pre = energy ? preEnergyAt(heard, {}) : null;
    const live = !audio.paused || presence > 0.001 ? liveEnergy({}) : null;
    for (const k of BAND_KEYS) {
      if (live && pre && presence > 0.9) { // calibración adaptativa: lleva el analizador en vivo a la escala del análisis
        liveMean[k] += (live[k] - liveMean[k]) * 0.01;
        preMean[k] += (pre[k] - preMean[k]) * 0.01;
      }
      const cal = live ? clamp01(live[k] * Math.min(2, Math.max(0.5, preMean[k] / Math.max(0.05, liveMean[k])))) : 0;
      if (pre && live) out[k] = clamp01(pre[k] * presence * 0.68 + cal * 0.32);
      else if (pre) out[k] = clamp01(pre[k] * presence);
      else out[k] = cal;
    }
    return out;
  }

  // ---------- API ----------
  const sub = (set, cb, replay) => {
    if (typeof cb !== 'function') return () => {};
    set.add(cb);
    if (replay) queueMicrotask(() => { if (set.has(cb)) { const v = replay(); if (v) { try { cb(v); } catch (e) { console.warn('[song] callback:', e); } } } });
    return () => set.delete(cb);
  };
  const duckTo = (amount, seconds) => {
    const low = clamp01(1 - (amount ?? 0.45)), hold = Math.max(0, seconds ?? 1.2);
    if (gDuck.node && ctx) {
      const t = ctx.currentTime, p = gDuck.node;
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(low, t + 0.12);
      p.setValueAtTime(low, t + 0.12 + hold);
      p.linearRampToValueAtTime(1, t + 0.12 + hold + 0.9);
    } else {
      gDuck.plan = { t0: nowMs(), down: 120, hold: hold * 1000, up: 900, low };
    }
  };
  const callMusic = (name, ...args) => {
    const f = music?.sfx?.[name];
    if (typeof f !== 'function') return false;
    try { f.apply(music.sfx, args); return true; } catch (e) { console.warn('[song] sfx', name, e); return false; }
  };

  const api = {
    analyser: null,
    get playing() { return started && !muted && wantPlay && !audio.paused; },
    get currentTime() { return heard; },
    get duration() { return songDuration(); },
    get latency() { return latency(); },
    get lyrics() { return lyrics.map(l => ({ ...l })); },
    get hasLyrics() { return lyrics.length > 0; },
    get section() { return sectionObj(curSection >= 0 ? curSection : sectionAt(heard)); },
    get line() { return lineObj(curLine); },
    get started() { return started; },
    get muted() { return muted; },
    get audio() { return audio; },
    get context() { return ctx; },
    get loopPoints() { return { in: loopIn, out: loopOut }; },
    stats,

    /** Llamar dentro del gesto del usuario: crea/reanuda el AudioContext, suena con fade-in de 2.5 s. */
    start() {
      if (disposed) return Promise.resolve();
      // FIX: los SFX (music.js) usan ESTE AudioContext: uno solo para la canción y los efectos (antes eran dos, creados
      // dentro del toque: ~185 ms de hilo bloqueado antes de que el lazo reaccionara)
      const startSfx = () => { try { const p = music?.start?.({ context: ctx || undefined }); p?.catch?.(() => {}); } catch {} };
      if (started && !muted && !audio.paused) { startSfx(); return Promise.resolve(); }
      if (started) { startSfx(); api.setMuted(false); return Promise.resolve(); }
      started = true; wantPlay = true; muted = false;
      stats.startedAt = nowMs();
      try { if (typeof navigator !== 'undefined' && navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
      try { audio.preload = 'auto'; } catch {}
      ensureGraph();
      startSfx();
      fade(gMaster, 0, 0);
      const resumeP = ctx && ctx.state !== 'running' ? ctx.resume().catch(() => {}) : Promise.resolve();
      let playP;
      try { playP = audio.play(); } catch (e) { playP = Promise.reject(e); }
      needResync = true;
      ensureLoop();
      return Promise.resolve(playP).then(async () => {
        await resumeP;
        if (ctx && ctx.state !== 'running') armUnlock();
        if (!muted) fade(gMaster, VOLUME, FADE_IN);
        ensureLoop();
      }, e => {
        armUnlock(); // el siguiente toque en la página la arranca
        if (!muted) fade(gMaster, VOLUME, FADE_IN);
        throw e;
      });
    },

    toggle() {
      if (!started) { api.start().catch(() => {}); return true; }
      // según lo que de verdad suena: si el navegador bloqueó el arranque, un toque la hace sonar (no la silencia)
      const on = api.playing;
      api.setMuted(on);
      return !on;
    },

    setMuted(m) {
      m = !!m;
      if (!started) { if (!m) api.start().catch(() => {}); return; }
      muted = m;
      try { music?.setMuted?.(m); } catch {} // los SFX callan con la canción
      clearTimeout(pauseTimer); pauseTimer = 0;
      if (m) {
        wantPlay = false;
        fade(gMaster, 0, MUTE_OUT);
        pauseTimer = setTimeout(() => { pauseTimer = 0; if (muted) audio.pause(); }, MUTE_OUT * 1000 + 80);
      } else {
        wantPlay = true;
        try { ctx?.resume?.(); } catch {}
        if (audio.paused) audio.play().catch(() => armUnlock());
        fade(gMaster, VOLUME, UNMUTE_IN);
        needResync = true;
        ensureLoop();
      }
    },

    duck(amount = 0.45, seconds = 1.2) { duckTo(amount, seconds); },

    /** Crea el AudioContext y el grafo sin sonar (p. ej. al PRESIONAR el lazo con el ratón: abrir el dispositivo de audio
     *  cuesta ~170 ms en Windows y así ocurre mientras el botón está presionado, no al soltarlo). */
    warm() { if (!disposed && !ctx && !graphFailed) ensureGraph(); },

    seek(t) {
      const d = songDuration();
      t = Math.max(0, Math.min(Number(t) || 0, d ? d - 0.1 : t));
      if (loopPhase === 1) { loopPhase = 0; fade(gLoop, 1, 0.3); }
      needResync = true;
      try { audio.currentTime = t; } catch {}
      est = t; lastCt = -1;
    },

    onBeat: cb => sub(subs.beat, cb),
    onAccent: cb => sub(subs.accent, cb),
    onSection: cb => sub(subs.section, cb, () => (started && curSection >= 0 ? sectionObj(curSection) : null)),
    onLine: cb => sub(subs.line, cb, () => (started && curLine >= 0 ? lineObj(curLine) : null)),
    onLoop: cb => sub(subs.loop, cb),

    getEnergy() {
      const t = nowMs();
      if (!eCache || t - eAt > 8) { eCache = computeEnergy(); eAt = t; }
      return { rms: eCache.rms, low: eCache.low, mid: eCache.mid, high: eCache.high };
    },

    /** Posición dentro del pulso actual: útil para cuantizar animaciones al siguiente tiempo. */
    getBeatPhase() {
      const t = heard;
      if (!beats.length) return { index: -1, phase: 0, period: 0.9, toNext: 0, nextDownbeat: false };
      const n = lowerBound(beats, t);
      const prev = n - 1;
      const period = n < beats.length && prev >= 0 ? beats[n] - beats[prev] : 0.9;
      const phase = prev >= 0 && n < beats.length ? clamp01((t - beats[prev]) / period) : 0;
      return { index: prev, phase, period, toNext: n < beats.length ? beats[n] - t : Infinity,
        nextIndex: n, nextDownbeat: n < beats.length ? beatInfo(n).downbeat : false };
    },

    sfx: {
      sealCrack() { if (callMusic('sealCrack')) duckTo(0.4, 0.5); },
      ribbonSwish() { callMusic('ribbonSwish'); },
      paperUnroll(s) { if (callMusic('paperUnroll', s)) duckTo(0.28, Math.max(0.4, (s ?? 2) * 0.8)); },
      chime() { if (callMusic('chime')) duckTo(0.22, 0.6); },
      whoosh() { callMusic('whoosh'); },
      sparkle() { callMusic('sparkle'); },
      // UNIR · raspado de la pluma (js/pluma.js lo llama cada cuadro; music.js calla solo si no se refresca)
      quill(x) { callMusic('quill', x); },
    },

    dispose() {
      disposed = true;
      cancelAnimationFrame(raf); raf = 0;
      clearTimeout(pauseTimer);
      disarmUnlock();
      doc?.removeEventListener('visibilitychange', onVisibility);
      Object.values(subs).forEach(s => s.clear());
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
      try { srcNode?.disconnect(); analyser?.disconnect(); } catch {}
      try { ctx?.close(); } catch {}
      ctx = null; analyser = null; api.analyser = null;
    },
  };
  Object.defineProperty(api, 'analysis', { get: () => analysis, enumerable: true });
  return api;
}

export default createSong;
