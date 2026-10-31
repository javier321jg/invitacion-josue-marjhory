// js/music.js — MUSIC · Pergamino 3D · Josué & Marjhory
// Música y efectos 100 % sintetizados con Web Audio (sin archivos de audio).
// Arreglo original del Canon en Re de Pachelbel (dominio público): caja de música (síntesis aditiva con parciales
// inarmónicos), celesta, arpa (Karplus-Strong), colchón de cuerdas legato (sierras desafinadas + lowpass) y
// violonchelo sobre el bajo ostinato D–A–Bm–F#m–G–D–G–A, a 66 BPM. Reverb de sala por convolución (impulso
// estéreo generado de 3,6 s), compresor de bus, limitador y recorte suave final (pico ≤ 0,94: nunca satura).
// Forma (18 ciclos de 8 negras ≈ 2:11): intro caja sola → entra el colchón → canon a 2 y a 3 voces → clímax →
// descanso → vuelve la caja y el bucle continúa en el ciclo 1 sin cortes (el planificador nunca se detiene).
//
// createMusic()  → { start, toggle, setMuted, playing, muted, duck, onBeat, sfx, analyser, dispose }
// createEngine(ctx) construye todo el grafo sobre cualquier BaseAudioContext (también OfflineAudioContext).
// renderOffline({ seconds }) y renderSfxOffline() devuelven AudioBuffer (pruebas y exportación .wav).

const BPM = 66, SPB = 60 / BPM, LOOK = 0.15, TICK = 25, FADE_IN = 3;
const PI = Math.PI, TAU = 2 * PI, R = Math.random;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mtof = m => 440 * 2 ** ((m - 69) / 12);
const n2 = () => R() * 2 - 1;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rng = s => () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hold = (p, t) => { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); } };
const CLIP = (() => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a < .8 ? a : .8 + .16 * Math.tanh((a - .8) / .16)); } return c; })();

// ───────────────────────────── Partitura ─────────────────────────────
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midi = s => NOTE[s[0]] + (s[1] === '#' ? 1 : 0) + 12 * (+s[s.length - 1] + 1);
// Variación: un dígito fija la duración en semicorcheas (se mantiene); 32 semicorcheas = 1 ciclo de 8 acordes.
const mel = s => { let p = 0, d = 4; const o = []; for (const t of s.split(' ')) { if (/^\d$/.test(t)) d = +t; else { o.push([p, d, midi(t)]); p += d; } } return o; };
const GROUND = [50, 45, 47, 42, 43, 38, 43, 45];                                  // D3 A2 B2 F#2 G2 D2 G2 A2
const CH = [[2, 6, 9], [9, 1, 4], [11, 2, 6], [6, 9, 1], [7, 11, 2], [2, 6, 9], [7, 11, 2], [9, 1, 4]]; // fundamental, 3.ª, 5.ª
const PADV = [[57, 62, 66], [57, 61, 64], [59, 62, 66], [57, 61, 66], [59, 62, 67], [57, 62, 66], [59, 62, 67], [57, 61, 64]]; // conducción de voces del colchón
const MELS = [
  '4 F#5 E5 D5 C#5 B4 A4 B4 C#5',                                                  // 0 tema en negras
  '4 D5 C#5 B4 A4 G4 F#4 G4 E4',                                                   // 1
  '2 D4 F#4 A4 G4 F#4 D4 F#4 E4 D4 B3 D4 A4 G4 B4 A4 G4',                          // 2 corcheas
  '2 F#4 D4 E4 C#5 D5 F#5 A5 A4 B4 G4 A4 F#4 D4 D5 3 D5 1 C#5',                    // 3
  '1 D5 C#5 D5 D4 C#4 A3 E4 F#4 D4 D5 C#5 B4 C#5 F#5 A5 B5 G5 F#5 E5 G5 F#5 E5 D5 C#5 B4 A4 G4 F#4 E4 G4 F#4 E4', // 4 escalas
  '1 D4 E4 F#4 G4 A4 E4 A4 G4 F#4 B4 A4 G4 A4 G4 F#4 E4 D4 B3 B4 C#5 D5 C#5 B4 A4 G4 F#4 E4 B4 A4 B4 A4 G4',     // 5
  '2 F#5 1 D5 E5 2 E5 1 C#5 D5 2 D5 1 B4 C#5 2 C#5 1 A4 B4 2 B4 1 G4 A4 2 A4 1 F#4 G4 2 G4 1 B4 D5 2 C#5 1 E5 G5', // 6 pastoral
  '2 F#5 F#4 E5 E4 D5 D4 C#5 C#4 B4 B3 A4 A3 B4 B3 C#5 C#4',                       // 7 octavas
  '4 A5 3 A5 1 G5 4 F#5 3 F#5 1 E5 4 D5 3 D5 1 C#5 2 B4 D5 C#5 E5',                // 8 cantabile con suspensiones
  '1 D5 F#5 A5 F#5 C#5 E5 A5 E5 D5 F#5 B5 F#5 C#5 F#5 A5 F#5 D5 G5 B5 G5 D5 F#5 A5 F#5 D5 G5 B5 G5 C#5 E5 A5 G5', // 9 acordes quebrados
].map(mel);
// Ciclo = 8 negras. m: [instrumento, variación, transposición, nivel, terceras]; arp: [instr., figura, nivel];
// pad: nivel del colchón; v4: variación que cantan las cuerdas agudas; bass: ['arco'|'pizz', nivel, sub-octava].
const PLAN = [
  { arp: ['box', 32, .6] },                                                                                  // 0 intro: caja sola
  { arp: ['box', 8, .5], m: [['box', 0, 12, .85]] },                                                         // 1 tema
  { arp: ['box', 8, .36], m: [['box', 1, 12, .9]], pad: .32, bass: ['arco', .5] },                            // 2 entra el colchón
  { m: [['box', 2, 12, .85], ['cel', 0, 0, .8]], pad: .42, bass: ['arco', .58] },                             // 3 canon a 2
  { m: [['box', 3, 12, .85], ['cel', 1, 0, .78], ['harp', 0, -12, .85]], pad: .48, bass: ['arco', .62] },     // 4 canon a 3
  { m: [['box', 4, 12, .8], ['cel', 2, 0, .76], ['harp', 1, -12, .82]], pad: .52, bass: ['arco', .66] },
  { m: [['box', 5, 12, .84], ['cel', 3, 0, .76], ['harp', 2, 0, .78]], pad: .56, bass: ['arco', .7] },
  { m: [['box', 6, 12, .88], ['cel', 4, 0, .72], ['harp', 3, 0, .76]], pad: .6, bass: ['arco', .72] },
  { m: [['box', 7, 12, .9], ['cel', 5, 0, .72], ['harp', 4, 0, .74]], pad: .66, bass: ['arco', .76] },
  { m: [['box', 8, 12, .95], ['cel', 6, 0, .74], ['harp', 5, 0, .74]], pad: .72, bass: ['arco', .8], swell: 1 },
  { m: [['box', 0, 12, 1, 1], ['cel', 7, 0, .78]], arp: ['harp', 16, .78], pad: .92, v4: 0, bass: ['arco', .95, 1], fx: 1 }, // 10 clímax
  { m: [['box', 1, 12, 1, 1], ['cel', 4, 0, .74]], arp: ['harp', 16, .78], pad: .95, v4: 1, bass: ['arco', 1, 1] },
  { m: [['box', 8, 12, 1, 1], ['cel', 9, 0, .72]], arp: ['harp', 16, .74], pad: 1, v4: 8, bass: ['arco', 1, 1] },
  { m: [['box', 4, 12, .92], ['cel', 0, 0, .78, 1]], arp: ['harp', 16, .7], pad: .82, v4: 0, bass: ['arco', .86, 1] },
  { m: [['box', 0, 12, .78]], arp: ['harp', 8, .4], pad: .46, bass: ['pizz', .55] },                          // 14 descanso
  { m: [['harp', 1, 0, .75]], arp: ['harp', 4, .42], pad: .34, bass: ['pizz', .45] },
  { m: [['cel', 6, 0, .72]], arp: ['harp', 4, .3], pad: .2 },
  { arp: ['box', 32, .62] },                                                                                 // 17 la caja vuelve sola → ciclo 1
];
const LOOP_FROM = 1;
const SECT = ['intro', 'intro', 'colchon', 'canon', 'canon', 'canon', 'canon', 'canon', 'canon', 'canon', 'climax', 'climax', 'climax', 'climax', 'descanso', 'descanso', 'descanso', 'intro'];
const arpOf = (kind, k) => {
  const r = GROUND[k] + (kind > 16 ? 24 : 12), t3 = (CH[k][1] - CH[k][0] + 12) % 12;
  if (kind >= 16) return [[0, r, 1], [1, r + 7, .62], [2, r + 12, .75], [3, r + 12 + t3, .62]];
  if (kind === 8) return [[0, r, 1], [2, r + 12 + t3, .7]];
  const g = r - (r < 57 ? 0 : 12); return [[0, g, 1], [.16, g + 7, .8], [.32, g + 12 + t3, .75]];   // acorde arpegiado (rasgueo de arpa)
};
const below = (m, k) => { for (let x = m - 3; x > m - 9; x--) if (CH[k].includes(((x % 12) + 12) % 12)) return x; return m - 5; };
// Campanas: [frecuencia de muestreo del búfer, τ en La4 (s), inclinación, ataque (s), tic, parciales [razón, amplitud, τ relativo]]
const BELL = {
  box: [32000, 1.05, .55, .0006, .3, [[1, 1, 1], [1.0011, .14, 1.15], [2, .2, .45], [3, .09, .28], [4, .035, .2], [5.95, .34, .13], [11.8, .12, .06], [17.6, .06, .035]]],
  cel: [24000, 1.35, .5, .0018, .08, [[1, 1, 1], [1.0019, .28, .9], [2, .3, .42], [3, .1, .25], [4.18, .1, .12], [6.85, .05, .06]]],
  glk: [32000, 1.9, .3, .0004, .1, [[1, 1, 1], [1.0016, .3, .95], [2.76, .36, .34], [2.763, .18, .3], [5.4, .15, .14], [8.93, .06, .07]]],
};
export const SCORE = { MELS, PLAN, GROUND, PADV };
export const MUSIC_INFO = { bpm: BPM, secondsPerBeat: SPB, beatsPerCycle: 8, cycles: PLAN.length, loopFrom: LOOP_FROM,
  firstPassSeconds: PLAN.length * 8 * SPB, loopSeconds: (PLAN.length - LOOP_FROM) * 8 * SPB, sections: SECT };

// ───────────────────────────── Motor (cualquier BaseAudioContext) ─────────────────────────────
export function createEngine(ctx, opt = {}) {
  const sr = ctx.sampleRate, only = opt.only ? new Set(opt.only) : null;
  const cache = opt.store?.cache || {}, take = (k, f) => cache[k] || (cache[k] = f());
  // FIX (sfxOnly = createMusic({ background:false })): sin colchón de cuerdas (12 osciladores + 4 LFO sonando toda la visita
  // a ganancia 0), sin buses de música ni analizador, y las reverbs se arman aparte (warmFx) con respuestas al impulso ya
  // calculadas en tiempo ocioso: el toque del lazo y el hilo de audio quedan libres.
  const lean = !!opt.sfxOnly;
  const G = (v = 1, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  const F = (type, f, Q = .7, gain = 0) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gain; return b; };
  const Pn = v => { if (!ctx.createStereoPanner) return G(); const p = ctx.createStereoPanner(); p.pan.value = v; return p; };
  const chain = (...n) => { for (let i = 1; i < n.length; i++) n[i - 1].connect(n[i]); return n[n.length - 1]; };
  const mk = (chs, rate = sr) => { const b = ctx.createBuffer(chs.length, chs[0].length, rate); chs.forEach((d, i) => b.getChannelData(i).set(d)); return b; };
  const conv = b => { const c = ctx.createConvolver(); c.buffer = b; return c; };
  const dyn = (th, knee, ratio, at, rel) => { const c = ctx.createDynamicsCompressor(); c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = at; c.release.value = rel; return c; };

  // Maestro: pasa-altos 34 Hz → compresor de bus → limitador → recorte suave (≤ 0,94) → mute → analizador → salida
  const analyser = lean ? null : ctx.createAnalyser();
  if (analyser) { analyser.fftSize = 2048; analyser.smoothingTimeConstant = .8; }
  const mute = G(1); if (analyser) chain(mute, analyser, ctx.destination); else mute.connect(ctx.destination);
  const clip = ctx.createWaveShaper(); clip.curve = CLIP;
  const masterIn = G(opt.gain ?? .5);
  chain(masterIn, F('highpass', 34, .6), dyn(-14, 10, 2, .03, .3), dyn(-3, 0, 20, .002, .12), G(.86), clip, mute);

  // Reverbs: sala (música y destellos) y cuarto (efectos de cerca); eco ping-pong a tempo para la magia.
  const hallIn = G(1), roomIn = G(1), sfxD = G(1, masterIn), dIn = G(1);
  let fxReady = false;
  function warmFx(force = !lean) {
    if (fxReady) return true;
    if (!force && !(cache['irHall@' + sr] && cache['irRoom@' + sr])) return false; // aún no: SFX secos (sin bloquear)
    fxReady = true;
    const irH = take('irHall@' + sr, () => irData(3.6, 3.2, 6500, 1200, .024, 16)), irR = take('irRoom@' + sr, () => irData(.8, .55, 9000, 3000, .005, 24));
    chain(hallIn, conv(mk(irH)), F('highpass', 170, .6), F('highshelf', 5500, .7, -3), G(1, masterIn));
    chain(roomIn, conv(mk(irR)), F('highpass', 220, .6), G(.85, sfxD));
    return true;
  }
  if (!lean) warmFx();
  { const dl = ctx.createDelay(2), dr = ctx.createDelay(2); dl.delayTime.value = dr.delayTime.value = SPB * .75;
    chain(dIn, F('lowpass', 5000, .5), dl); chain(dl, G(.4), dr); chain(dr, F('lowpass', 3500, .5), G(.4), dl);
    dl.connect(Pn(-.75)).connect(sfxD); dr.connect(Pn(.75)).connect(sfxD); }

  // Música: seco y envío de reverb, cada uno con fade (entrada) y duck
  const fadeP = [], duckP = [];
  let musD = null, musW = null;
  if (!lean) {
    const fD = G(0), fW = G(0), kD = G(1), kW = G(1);
    musD = G(1); musW = G(1);
    chain(musD, fD, kD, masterIn); chain(musW, fW, kW, hallIn);
    fadeP.push(fD.gain, fW.gain); duckP.push(kD.gain, kW.gain);
  }
  const bus = (name, pan, dry, wet, ...fx) => { const g = G(only && !only.has(name) ? 0 : 1), o = chain(g, ...fx, Pn(pan)); o.connect(G(dry, musD)); o.connect(G(wet, musW)); return g; };
  const B = lean ? {} : {
    box: bus('box', .24, .78, .5, F('peaking', 2600, .8, 2.5), F('highshelf', 9000, .7, -2)),
    cel: bus('cel', -.3, .8, .45, F('lowpass', 7000, .5)),
    harp: bus('harp', -.1, .85, .36, F('peaking', 220, 1, 1.5), F('lowpass', 8000, .5)),
    pad: bus('pad', 0, .62, .6, F('highshelf', 3000, .7, -5), F('peaking', 380, .8, -3)),
    cello: bus('cello', -.08, .88, .3, F('peaking', 230, 1.1, 2), F('lowpass', 2600, .6)),
    glk: bus('glk', .05, .6, .8, F('highshelf', 8000, .7, -4)),
  };

  // Colchón de cuerdas: 4 voces persistentes (3 sierras desafinadas c/u + vibrato) que cambian de nota en legato.
  const padV = lean ? [] : [-.45, .15, .45, -.15].map((pan, i) => {
    const vca = G(0), bow = G(1), lp = F('lowpass', 1200, .5), lfo = ctx.createOscillator(), lg = G(5 + i);
    chain(lp, bow, vca, Pn(pan), B.pad); lfo.frequency.value = 4.7 + i * .37; lfo.connect(lg); lfo.start();
    const os = [-11, 1, 10].map(dt => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = dt + (R() - .5) * 4; lg.connect(o.detune); o.connect(lp); o.start(ctx.currentTime + R() * .03); return o; });
    return { vca, bow, lp, os, last: 0 };
  });
  function padNote(v, t, m) {
    if (v.last === m) return;
    const f = mtof(m);
    for (const o of v.os) v.last ? o.frequency.setTargetAtTime(f, t, .022) : o.frequency.setValueAtTime(f, t);
    if (v.last) { v.bow.gain.setTargetAtTime(.74, t - .05, .02); v.bow.gain.setTargetAtTime(1, t + .015, .11); }
    v.last = m;
  }
  function padLevel(t, lv, v4) {
    padV.forEach((v, i) => { v.vca.gain.setTargetAtTime((i < 3 ? lv : v4 ? lv * 1.2 : 0) * .18, t, i === 3 && !v4 ? .8 : 2); v.lp.frequency.setTargetAtTime(500 + 2400 * lv, t, 2.5); });
  }

  // Violonchelo: 2 sierras + filtro con "mordida" de arco, vibrato retardado; sub-octava suave en el clímax.
  function cello(t, m, dur, lv, sub) {
    const f = mtof(m), g = G(0), lp = F('lowpass', 400, .9), lfo = ctx.createOscillator(), lg = G(0), end = t + dur + .6, A = .19 * lv;
    lfo.frequency.value = 4.9 + R() * .6; lfo.connect(lg); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(9, t + .45);
    const os = [-4, 5].map(d => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; lg.connect(o.detune); o.connect(lp); return o; });
    if (sub && f > 140) { const o = ctx.createOscillator(); o.frequency.value = f / 2; o.connect(G(.45, g)); os.push(o); }
    chain(lp, g, B.cello);
    lp.frequency.setValueAtTime(350, t); lp.frequency.linearRampToValueAtTime(1900 + 900 * lv, t + .05); lp.frequency.setTargetAtTime(850 + 500 * lv, t + .07, .25);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + .07); g.gain.setTargetAtTime(A * .78, t + .1, .3); g.gain.setTargetAtTime(0, t + dur, .07);
    for (const o of [...os, lfo]) { o.start(t); o.stop(end); }
    lfo.onended = () => { g.disconnect(); lp.disconnect(); lg.disconnect(); };
  }

  // Búferes sintetizados (se generan una vez por nota y se reutilizan).
  const bufs = opt.store?.bufs || new Map(), norm = (d, p) => { let m = 0; for (const v of d) m = Math.max(m, Math.abs(v)); if (m) for (let i = 0; i < d.length; i++) d[i] *= p / m; return d; };
  const fadeTail = (d, fr) => { const n = d.length, a = Math.floor(n * (1 - fr)); for (let i = a; i < n; i++) d[i] *= .5 + .5 * Math.cos(PI * (i - a) / (n - a)); };
  function bell(kind, m) {
    const key = kind + m; let b = bufs.get(key); if (b) return b;
    const [rate, tau0, tilt, att, tick, parts] = BELL[kind], f = mtof(m);
    const tau = clamp(tau0 * (440 / f) ** tilt, .25, 3.2), n = Math.ceil(rate * Math.min(tau * 3.6, 4.2)), d = new Float32Array(n);
    for (const [r, a, dm] of parts) {                // osciladores por rotación compleja con decaimiento exponencial
      const fr = f * r; if (fr > rate * .42) continue;
      const w = TAU * fr / rate, td = tau * dm, k = Math.exp(-1 / (td * rate)), cw = Math.cos(w) * k, sw = Math.sin(w) * k, len = Math.min(n, Math.ceil(td * rate * 7));
      for (let i = 0, c = 1, s = 0; i < len; i++) { d[i] += a * s; const c2 = c * cw - s * sw; s = c * sw + s * cw; c = c2; }
    }
    for (let i = 0, y = 0; i < rate * .006; i++) { const x = n2() * Math.exp(-i / (.0012 * rate)); d[i] += tick * (x - y) * 2; y = x; }   // tic de la púa
    const an = Math.max(1, Math.round(att * rate)); for (let i = 0; i < an; i++) d[i] *= i / an;
    fadeTail(d, .25); norm(d, .9);
    b = { buf: mk([d], rate) }; bufs.set(key, b); return b;
  }
  function ks(m, dark) {                             // Karplus-Strong: arpa (brillante, larga) o pizzicato (oscuro, corto)
    const key = (dark ? 'z' : 'k') + m; let b = bufs.get(key); if (b) return b;
    const rate = dark ? 16000 : 22050, f = mtof(m), S = dark ? .5 : clamp(.5 + (f - 200) / 2400, .5, .86);
    const N = Math.max(6, Math.round(rate / f + 1 - S)), Pd = N - 1 + S, f0 = rate / Pd, w = TAU / Pd;
    const T60 = dark ? clamp(1.1 * (98 / f) ** .3, .5, 1.4) : clamp(4.6 * (110 / f) ** .5, 1.2, 4.5);
    const H = Math.hypot(S + (1 - S) * Math.cos(w), (1 - S) * Math.sin(w)), g = Math.min(.99996, .001 ** (1 / (f0 * T60)) / H);
    const n = Math.ceil(rate * Math.min(T60 * .8, 4.5)), d = new Float32Array(n), q = new Float32Array(N);
    const pk = Math.max(1, Math.round(N * (dark ? .1 : .27))), lpA = dark ? .25 : .68;
    let y = 0, mean = 0;
    for (let i = 0; i < N; i++) { const x = (i < pk ? i / pk : (N - i) / (N - pk)) * .8 + n2() * (dark ? .08 : .3); y += lpA * (x - y); q[i] = y; mean += y; }
    mean /= N; for (let i = 0; i < N; i++) q[i] -= mean;
    for (let i = 0, j = 0; i < n; i++) { const j1 = j + 1 === N ? 0 : j + 1, a = q[j]; d[i] = a; q[j] = g * (S * a + (1 - S) * q[j1]); j = j1; }
    fadeTail(d, .15); norm(d, .9);
    b = { buf: mk([d], rate), rate: f / f0 }; bufs.set(key, b); return b;
  }

  const lastV = new Map();
  function play(dest, b, t, v, key, pan) {
    const s = ctx.createBufferSource(), g = G(v); s.buffer = b.buf; if (b.rate) s.playbackRate.value = b.rate;
    const pn = pan != null ? Pn(pan) : null; s.connect(g); (pn ? g.connect(pn) : g).connect(dest); s.start(Math.max(0, t));
    s.onended = () => { g.disconnect(); if (pn) pn.disconnect(); };
    if (key) { const p = lastV.get(key); if (p && p.t < t) { p.g.gain.setTargetAtTime(0, t, .02); try { p.s.stop(t + .25); } catch { /* ya detenida */ } } lastV.set(key, { s, g, t }); }
    return s;
  }
  const loud = m => clamp((587 / mtof(m)) ** .22, .7, 1.25);
  const VOL = { box: .63, cel: .3, glk: .5 };
  const note = (ins, t, m, v) => ins === 'harp' ? play(B.harp, ks(m, 0), t, v * .63, 'h' + m) : play(B[ins], bell(ins, m), t, v * VOL[ins] * loud(m), ins === 'glk' ? 0 : ins + m);
  function sparkle(t, dest, lv) {
    [86, 90, 93, 98, 102, 105].forEach((m, i) => play(dest, bell('glk', m), t + i * .052 + R() * .012, lv * (.25 + .04 * i), 0, -.6 + i * .24));
    return play(dest, bell('glk', 98), t + .43, lv * .2, 0, .1);
  }

  // ── Programación de un pulso (negra) de la partitura en el instante t
  const cyc = b => { const c = Math.floor(b / 8); return c < PLAN.length ? c : LOOP_FROM + (c - LOOP_FROM) % (PLAN.length - LOOP_FROM); };
  function beat(b, t) {
    const c = cyc(b), k = b % 8, P = PLAN[c], r = rng(b * 9973 + 7);
    const hum = () => (r() + r() + r() - 1.5) * .009, vh = () => .9 + r() * .2, arc = .94 + .06 * Math.sin(PI * (k + .5) / 8);
    if (k === 0) { padLevel(t, P.pad || 0, P.v4 != null); if (P.fx) sparkle(t, B.glk, .9); }
    if (k === 5 && P.swell) play(B.glk, swellBuf(), t, .16);
    PADV[k].forEach((m, i) => padNote(padV[i], t, m));
    if (P.v4 == null) padNote(padV[3], t, PADV[k][1] + 12);
    if (P.bass) { const [md, lv, sub] = P.bass; md === 'arco' ? cello(t + hum() * .5, GROUND[k], SPB * .97, lv * arc, sub) : play(B.cello, ks(GROUND[k], 1), t + hum(), lv * vh() * .8, 'z'); }
    if (P.arp) { const [ins, kind, lv] = P.arp; for (const [p, m, a] of arpOf(kind, k)) note(ins, t + p * SPB / 4 + hum(), m, lv * a * vh() * arc); }
    const lines = (P.m || []).slice(); if (P.v4 != null) lines.push(['v4', P.v4, 0]);
    for (const [ins, idx, tr, lv, harm] of lines) for (const [p, , m0] of MELS[idx]) {
      if (p >> 2 !== k) continue;
      const tt = t + (p / 4 - k) * SPB + hum(), m = m0 + tr;
      if (ins === 'v4') { padNote(padV[3], tt, m); continue; }
      const v = lv * (p % 4 ? p % 2 ? .78 : .87 : 1) * vh() * arc;
      note(ins, tt, m, v);
      if (harm && !(p % 4)) note(ins, tt + .01 + r() * .012, below(m, k), v * .6);
    }
    return { cycle: c, beat: k, section: SECT[c], accent: (k ? k === 4 ? .72 : .45 : 1) * (.55 + .45 * (P.pad || .25)) };
  }

  // ───────── Efectos de sonido: síntesis procedural muestra a muestra (estéreo) ─────────
  const gOf = fc => Math.tan(PI * Math.min(fc, sr * .45) / sr);
  function svf() {                                   // filtro de variables de estado TPT (Zavalishin), estable con fc variable
    let a = 0, b = 0; const o = { lp: 0, bp: 0, hp: 0, run(x, g, k) { const a1 = 1 / (1 + g * (g + k)), v1 = a1 * (a + g * (x - b)), v2 = b + g * v1; a = 2 * v1 - a; b = 2 * v2 - b; o.lp = v2; o.bp = v1; o.hp = x - k * v1 - v2; return o; } };
    return o;
  }
  const blank = dur => { const n = Math.ceil(dur * sr); return [new Float32Array(n), new Float32Array(n)]; };
  const norm2 = (o, p) => { let m = 0; for (const d of o) for (const v of d) m = Math.max(m, Math.abs(v)); if (m) for (const d of o) for (let i = 0; i < d.length; i++) d[i] *= p / m; return o; };
  function layer(dur, fill) {                        // capa normalizada; put(i, valor, paneo)
    const o = blank(dur), n = o[0].length;
    fill(n, (i, v, p = 0) => { if (i >= 0 && i < n) { const a = (p + 1) * PI / 4; o[0][i] += v * Math.cos(a); o[1][i] += v * Math.sin(a); } });
    return norm2(o, 1);
  }
  const mix = (o, l, w) => { for (let c = 0; c < 2; c++) for (let i = 0; i < o[c].length && i < l[c].length; i++) o[c][i] += l[c][i] * w; return o; };
  const synth = {
    crack() {                                        // lacre que se quiebra: chasquidos secos + "toc" + astillas resonantes + migas
      const D = 1.5, ms = sr / 1000, o = blank(D);
      mix(o, layer(D, (n, put) => [[0, 1, 2600, 6.5, 0], [29 + R() * 12, .6, 3900, 5, .18], [70 + R() * 25, .32, 3000, 4, -.22], [118 + R() * 30, .17, 5200, 3, .3]].forEach(([t0, a, fc, tau, p]) => {
        const f = svf(), g = gOf(fc), i0 = t0 * ms | 0;
        for (let i = 0; i < tau * 9 * ms; i++) { const e = (1 - Math.exp(-i / (.25 * ms))) * Math.exp(-i / (tau * ms)); f.run(n2() * e, g, .9); put(i0 + i, a * (f.hp * .45 + f.bp * 1.5), p); }
      })), 1);
      mix(o, layer(D, (n, put) => { for (const [t0, a] of [[0, 1], [.03, .45]]) for (let i = 0; i < .14 * sr; i++) { const t = i / sr; put((t0 * sr | 0) + i, a * Math.sin(TAU * (125 * t + 2.2 * (1 - Math.exp(-t / .022)))) * Math.exp(-t / .024) * Math.min(1, i / (.0008 * sr))); } }), .17);
      mix(o, layer(D, (n, put) => { for (let j = 0; j < 9; j++) { const f = svf(), g = gOf(2200 * 3.3 ** R()), k = 1 / (18 + R() * 30), i0 = R() * .16 * sr | 0, a = .3 + R() * .7, p = (R() - .5) * .7; for (let i = 0; i < .03 * sr; i++) { f.run(i < 2 ? n2() : 0, g, k); put(i0 + i, a * f.bp, p); } } }), .3);
      mix(o, layer(D, (n, put) => { for (let j = 0; j < 6; j++) { let t = .16 + R() * .35, dt = .06 + R() * .07, a = .4 + R() * .6; const p = (R() - .5) * 1.1, fc = 2800 + R() * 5000;
        for (let q = 0; q < 4; q++, t += dt, dt *= .6, a *= .45) { const f = svf(), g = gOf(fc * (.9 + R() * .2)), i0 = t * sr | 0; for (let i = 0; i < .012 * sr; i++) { f.run(n2() * Math.exp(-i / (.0007 * sr)), g, .25); put(i0 + i, a * f.bp, p); } } } }), .2);
      return norm2(o, .95);
    },
    swish() {                                        // roce de satén: ruido rosado en banda con barrido + textura de fricción
      const D = .95, o = blank(D);
      mix(o, layer(D, (n, put) => { const f = svf(), h = svf(); let pk = 0, tx = 0;
        for (let i = 0; i < n; i++) { const t = i / sr, x = t / .72; if (x >= 1) break; const e = Math.sin(PI * x ** .65) ** 1.7, w = n2(); pk += .45 * (w - pk); tx += .0035 * (n2() - tx);
          f.run(pk, gOf(950 + 3400 * Math.sin(PI * Math.min(1, x * .92)) ** 1.3), .85); h.run(w, gOf(6800), 1.2); put(i, e * (f.bp * (.55 + 16 * Math.abs(tx)) + h.hp * .1), -.55 + 1.1 * x); } }), 1);
      mix(o, layer(D, (n, put) => { const f = svf(), i0 = .5 * sr | 0; for (let i = 0; i < .2 * sr; i++) { f.run(n2() * Math.exp(-i / (.05 * sr)) * Math.min(1, i / (.01 * sr)), gOf(320), 1); put(i0 + i, f.lp, .35); } }), .22);
      return norm2(o, .9);
    },
    paper(sec) {                                     // papel que se desenrolla: crujido granular + rodar grave + aire + golpes de varilla
      const D = sec + .7, o = blank(D), env = t => sstep(0, .15, t) * (1 - sstep(sec - .45, sec, t)) * (.8 + .2 * Math.sin(t * 9.3));
      mix(o, layer(D, (n, put) => { for (let t = .01; t < sec;) {
        const e = env(t); t += -Math.log(1 - R() * .995) / (14 + 70 * e); if (e < .03) continue;
        const cl = R() < .08 ? 3 + (R() * 7 | 0) : 1;
        for (let c = 0, tt = t; c < cl; c++, tt += .002 + R() * .007) {
          const len = (.0012 + Math.min(.03, -Math.log(1 - R() * .99) * .005)) * sr | 0, f = svf(), g = gOf(1000 * 7 ** R()), k = 1 / (.6 + R() * 2.4), a = e * (.1 + .9 * R() ** 3), p = (R() - .5) * .8, i0 = tt * sr | 0;
          for (let i = 0; i < len; i++) { f.run(n2() * Math.exp(-i / (len * .35)) * Math.min(1, i / (.0003 * sr)), g, k); put(i0 + i, a * f.bp, p); }
        } } }), 1);
      mix(o, layer(D, (n, put) => { const f = svf(), g = gOf(230); let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += (6.5 - 4 * Math.min(1, t / sec)) / sr; f.run(n2(), g, 1.1); put(i, env(t) * f.bp * (.5 + .5 * Math.sin(TAU * ph) ** 2)); } }), .28);
      mix(o, layer(D, (n, put) => { const f = svf(), g = gOf(750); for (let i = 0; i < n; i++) { f.run(n2(), g, 1.4); put(i, env(i / sr) * f.bp); } }), .1);
      mix(o, layer(D, (n, put) => { for (const [t0, a, f1, f2] of [[0, .6, 140, 0], [sec - .04, 1, 165, 420]]) { const i0 = Math.max(0, t0 * sr | 0); for (let i = 0; i < .2 * sr; i++) { const t = i / sr; put(i0 + i, a * Math.exp(-t / .03) * (Math.sin(TAU * f1 * t) + (f2 ? .45 * Math.sin(TAU * f2 * t) * Math.exp(-t / .012) : 0)) * Math.min(1, i / (.0006 * sr))); } } }), .4);
      return norm2(o, .9);
    },
    whoosh() {                                       // paso de aire: banda que sube y baja con paneo
      return norm2(layer(1.1, (n, put) => { const f = svf(), l = svf(); let pk = 0;
        for (let i = 0; i < n; i++) { const x = i / sr / .95; if (x >= 1) break; const e = Math.sin(PI * x ** 1.25) ** 2, w = n2(); pk += .3 * (w - pk);
          f.run(pk, gOf(260 * 7 ** Math.sin(PI * Math.min(1, x * 1.05)) ** 1.5), .7); l.run(w, gOf(210), 1.2); put(i, e * (f.bp + .4 * l.bp), -.7 + 1.4 * x); } }), .9);
    },
    chime() {                                        // clink de cristal: dos anillos (La6 y Re7), modos inarmónicos con batido + rebotes
      return norm2(layer(3.6, (n, put) => { for (const [t0, f0, a, p, dk] of [[0, 1760, 1, -.15, 1], [.0105, 2349.3, .75, .2, 1], [.057, 1760.6, .22, -.05, .55], [.093, 2350, .1, .12, .45]]) {
        const i0 = t0 * sr | 0, tmp = new Float32Array(n - i0);
        for (const [r, am, tau, sp] of [[1, 1, 1.9, .55], [2.83, .42, .75, 1.3], [5.42, .2, .34, 2.3], [8.77, .08, .17, 3.4]]) for (const [df, aa] of [[0, 1], [sp, .65]]) {
          const fr = f0 * r + df; if (fr > sr * .45) continue;
          const w = TAU * fr / sr, k = Math.exp(-1 / (tau * dk * sr)), cw = Math.cos(w) * k, sw = Math.sin(w) * k, len = Math.min(tmp.length, tau * dk * 7 * sr | 0);
          for (let i = 0, c = 1, s = 0; i < len; i++) { tmp[i] += am * aa * s; const c2 = c * cw - s * sw; s = c * sw + s * cw; c = c2; }
        }
        for (let i = 0, y = 0; i < .004 * sr; i++) { const x = n2() * Math.exp(-i / (.0006 * sr)); tmp[i] += .5 * (x - y); y = x; }
        for (let i = 0; i < tmp.length; i++) put(i0 + i, a * tmp[i], p);
      } }), .9);
    },
  };
  let swb = null;                                    // platillo suspendido con baqueta suave (crescendo hacia el clímax)
  const swellBuf = () => swb || (swb = { buf: mk(norm2(layer(3 * SPB + 2, (n, put) => { const f = svf(), h = svf(), up = 3 * SPB;
    for (let i = 0; i < n; i++) { const t = i / sr, e = t < up ? (t / up) ** 3 : Math.exp(-(t - up) / .7), w = n2(); f.run(w, gOf(5200), 2); h.run(w, gOf(9000), 1.4); put(i, e * (f.bp + .35 * h.hp) * (.8 + .2 * Math.abs(Math.sin(TAU * 6.5 * t))), (R() - .5) * .3); } }), .9)) });
  function fire(chs, t, lv, room, hall, dly) {
    if ((room || hall) && !fxReady) warmFx();
    const s = ctx.createBufferSource(), g = G(lv, sfxD); s.buffer = mk(chs); s.connect(g);
    if (room) g.connect(G(room, roomIn)); if (hall) g.connect(G(hall, hallIn)); if (dly) g.connect(G(dly, dIn));
    s.start(Math.max(0, t)); s.onended = () => g.disconnect(); return g;
  }
  function duck(a = .5, s = 1, t = ctx.currentTime) { a = clamp(+a || 0, 0, 1); s = Math.max(.05, +s || 1); for (const p of duckP) { hold(p, t); p.setTargetAtTime(1 - a, t, .06); p.setTargetAtTime(1, t + s, .4); } }
  const sfx = {
    sealCrack: t => { fire(take('crack', synth.crack), t, .95, .3, .05); duck(.45, .9, t); },
    ribbonSwish: t => { fire(take('swish', synth.swish), t, .5, .3, .12); duck(.25, .7, t); },
    paperUnroll: (t, sec = 2.4) => { sec = clamp(+sec || 2.4, .4, 8); fire(take('paper' + sec.toFixed(2), () => synth.paper(sec)), t, 1, .3, .08); duck(.3, sec, t); },
    chime: t => fire(take('chime', synth.chime), t, .6, .15, .5, .25),
    whoosh: t => { fire(take('whoosh', synth.whoosh), t, .45, .15, .25); duck(.2, .6, t); },
    sparkle: t => { warmFx(); const g = G(1, sfxD); g.connect(G(.1, roomIn)); g.connect(G(.5, hallIn)); g.connect(G(.35, dIn)); sparkle(t, g, 1).addEventListener('ended', () => g.disconnect()); },
  };

  // Precarga en segundo plano (por presupuesto de ms): notas en orden de uso y efectos de sonido.
  function* jobs() {
    if (opt.sfxOnly) {                  // createMusic({ background:false }): solo los SFX (sin notas del Canon)
      // en el orden en que se usan: puerta (satén, aire, destellos) → clink de los anillos → reverbs → pergamino
      for (const k of ['swish', 'whoosh']) yield () => { cache[k] = cache[k] || synth[k](); };
      for (const m of [86, 90, 93, 98, 102, 105]) yield () => bell('glk', m);
      yield () => { cache.chime = cache.chime || synth.chime(); };
      for (const r of [48000, 44100]) {
        yield () => take('irHall@' + r, () => irData(3.6, 3.2, 6500, 1200, .024, 16, r));
        yield () => take('irRoom@' + r, () => irData(.8, .55, 9000, 3000, .005, 24, r));
      }
      yield () => { cache.crack = cache.crack || synth.crack(); };
      for (const sec of [2.392, 2.4]) yield () => { const k = 'paper' + sec.toFixed(2); cache[k] = cache[k] || synth.paper(sec); }; // scroll3d: 2.6 × 0.92
      return;
    }
    for (let c = 0; c < PLAN.length; c++) {
      const P = PLAN[c];
      for (let k = 0; k < 8; k++) {
        if (P.arp) for (const [, m] of arpOf(P.arp[1], k)) yield () => P.arp[0] === 'harp' ? ks(m, 0) : bell(P.arp[0], m);
        if (P.bass && P.bass[0] === 'pizz') yield () => ks(GROUND[k], 1);
        for (const [ins, idx, tr, , harm] of P.m || []) for (const [p, , m] of MELS[idx]) if (p >> 2 === k) { yield () => ins === 'harp' ? ks(m + tr, 0) : bell(ins, m + tr); if (harm) yield () => bell(ins, below(m + tr, k)); }
      }
      if (c === 2) for (const k of ['crack', 'swish', 'chime', 'whoosh']) yield () => { cache[k] = cache[k] || synth[k](); };
      if (P.swell) yield swellBuf;
      if (P.fx || c === 2) for (const m of [86, 90, 93, 98, 102, 105]) yield () => bell('glk', m);
    }
  }
  const it = jobs();
  let jobsDone = 0;
  function prewarm(ms = 6) { const t0 = performance.now(); while (performance.now() - t0 < ms) { const r = it.next(); if (r.done) return true; jobsDone++; try { r.value?.(); } catch (e) { console.warn('[music] precarga', e); } } return false; }
  function fadeIn(t, d = FADE_IN) { for (const p of fadeP) { p.setValueAtTime(0, t); p.setTargetAtTime(1, t, d / 3); } }
  // Respuesta al impulso estéreo: ruido decorrelado con decaimiento exponencial (T60), oscurecimiento progresivo
  // (los agudos mueren antes), pre-retardo, entrada difusa suave y reflexiones tempranas.
  function irData(dur, t60, f0, f1, pre, ner, sr = ctx.sampleRate) {
    const n = Math.ceil(dur * sr), o = [new Float32Array(n), new Float32Array(n)], p0 = Math.ceil(pre * sr);
    for (const d of o) {
      let y = 0;
      for (let i = p0; i < n; i++) {
        const t = (i - p0) / sr, x = t / (dur - pre), a = 1 - Math.exp(-TAU * f0 * (f1 / f0) ** x / sr);
        y += a * (n2() - y);
        d[i] = y * Math.sqrt((2 - a) / a) * Math.exp(-6.9 * t / t60) * Math.min(1, t / .03) * Math.min(1, (1 - x) * 12);
      }
      for (let k = 0; k < ner; k++) d[Math.floor((pre * .45 + R() * .07) * sr)] += (R() < .5 ? -1 : 1) * (1.6 - k / ner);
    }
    return o;
  }
  return { ctx, beat, fadeIn, duck, sfx, analyser, mute: mute.gain, prewarm, warmFx, synth, voices: { ks, bell }, cycleOf: cyc, get jobsDone() { return jobsDone; } };
}

// ───────────────────────────── API en tiempo real ─────────────────────────────
// createMusic({ background:false }): sin el Canon de fondo (la web usa la canción del usuario, js/song.js); start() solo crea y
// desbloquea el AudioContext para los SFX dentro del gesto.
/** opts.idle (opcional): función que devuelve una promesa; el trabajo de fondo (síntesis previa de los SFX) espera a que
 *  resuelva. main.js la usa para no sintetizar nada durante la apertura de la puerta y la llegada de los anillos. */
export function createMusic({ background = true, idle: idleGate = null } = {}) {
  let ctx = null, eng = null, started = false, muted = false, beat = 0, nextT = 0, timer = 0, raf = 0, warmT = 0, susT = 0, visT = 0, away = false;
  let owned = true; // false: el AudioContext es de song.js (un solo contexto para la canción y los SFX)
  const cbs = new Set(), q = [], AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  // background:false → los SFX se sintetizan ANTES del gesto, en tiempo ocioso, con un motor sobre OfflineAudioContext
  // (no requiere gesto ni avisa en consola) y búferes compartidos: el clic/tap y las animaciones no pagan la síntesis.
  const store = background ? null : { cache: {}, bufs: new Map() };
  let prepT = 0, prepDone = false;
  const ric = f => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 60));
  // (el permiso de main.js ya incluye esperar un rato ocioso del navegador)
  const idle = f => { if (typeof idleGate === 'function') Promise.resolve().then(idleGate).catch(() => {}).then(f); else ric(f); return 1; };
  const ESSENTIAL = 9; // satén, aire, 6 notas de destellos y el clink: se usan en los primeros ~8 s tras el toque
  function prepare() {
    if (!store || prepT || prepDone || typeof OfflineAudioContext === 'undefined') return;
    prepT = ric(() => {
      let pe;
      try { pe = createEngine(new OfflineAudioContext(2, 1, 48000), { sfxOnly: true, store }); } catch { prepDone = true; return; }
      // los SFX de la apertura y del clink no esperan al permiso (si faltan, mejor un tirón breve ahora que congelar el clink);
      // el resto (reverbs, lacre, papel) sí
      const step = () => { if (!pe.prewarm(4)) prepT = pe.jobsDone < ESSENTIAL ? ric(step) : idle(step); else { prepDone = true; pe = null; } };
      prepT = ric(step);
    });
  }
  if (store && typeof window !== 'undefined') setTimeout(prepare, 1500);
  const resume = () => { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') return ctx.resume().catch(() => {}); return Promise.resolve(); };
  function ensure(shared) {
    if (ctx) return ctx;
    if (shared && typeof shared.createGain === 'function' && shared.state !== 'closed') { ctx = shared; owned = false; }
    else {
      if (!AC) return null;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS 17+: suena aun con el interruptor de silencio */ }
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch { ctx = new AC(); }
    }
    try { const s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0); } catch { /* desbloqueo iOS */ }
    resume();
    eng = createEngine(ctx, background ? {} : { sfxOnly: true, store });
    if (!background) {
      // reverbs: después del toque (nunca dentro) y solo con las respuestas al impulso ya listas; respaldo a los 12 s
      const t0 = Date.now();
      const tryFx = () => { try { if (!eng || eng.warmFx(Date.now() - t0 > 12000)) return; } catch { return; } idle(tryFx); };
      setTimeout(tryFx, 90);
    }
    eng.mute.value = muted ? 0 : 1;
    document.addEventListener('visibilitychange', onVis);
    for (const e of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(e, kick, { passive: true });
    if (background) warm(); // (sin el Canon, lo que falte lo sigue sintetizando prepare() en tiempo ocioso)
    return ctx;
  }
  const kick = () => { if (ctx && !muted && !document.hidden && (started || ctx.state === 'interrupted')) resume(); };
  function warm() { clearTimeout(warmT); if (eng && !eng.prewarm(document.hidden ? 20 : 5)) warmT = setTimeout(warm, 40); }
  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, look = document.hidden ? 1.2 : LOOK;
    if (nextT < now - .1) { const skip = Math.ceil((now - nextT) / SPB); nextT += skip * SPB; beat += skip; }   // temporizador estrangulado: realinear
    while (nextT < now + look) { const info = eng.beat(beat, nextT); q.push([beat, nextT, info]); beat++; nextT += SPB; }
    flush();
  }
  function flush() {
    if (!ctx) return;
    const now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    while (q.length && q[0][1] <= now + .008) { const [b, t, info] = q.shift(); if (t < now - .3) continue; cbs.forEach(cb => { try { cb(b, t, info); } catch (e) { console.error(e); } }); }
  }
  const loop = () => { flush(); raf = requestAnimationFrame(loop); };
  function fadeMaster(on, tc) { if (!eng) return; const p = eng.mute, t = ctx.currentTime; hold(p, t); p.setTargetAtTime(on ? 1 : 0, t, tc); }
  function onVis() {                                 // pestaña oculta: pausa con fundido (ahorra batería); al volver, retoma
    if (!ctx || !started) return;
    clearTimeout(visT);
    if (document.hidden) { away = true; fadeMaster(false, .08); if (owned) visT = setTimeout(() => { if (ctx && document.hidden) ctx.suspend().catch(() => {}); }, 350); }
    else if (away) { away = false; if (!muted) { resume(); fadeMaster(true, .3); } }
  }
  /** o.context: AudioContext ya creado (song.js) para no abrir un segundo contexto. */
  async function start(o) {
    if (!ensure(o?.context)) return;
    if (!started) {
      started = true;
      if (background) {
        beat = 0; nextT = ctx.currentTime + .12;
        eng.fadeIn(nextT, FADE_IN);
        eng.prewarm(40); timer = setInterval(tick, TICK); tick(); loop();
      }
    }
    if (!muted) await resume();
  }
  function setMuted(m) {
    muted = !!m;
    if (!ctx) return;
    clearTimeout(susT); fadeMaster(!muted, muted ? .12 : .25);
    if (muted && owned) susT = setTimeout(() => { if (ctx && muted && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 900);
    else resume();
  }
  function toggle() { if (!started) { start(); setMuted(false); return true; } setMuted(!muted); return !muted; }
  const sfx = {};
  for (const k of ['sealCrack', 'ribbonSwish', 'paperUnroll', 'chime', 'whoosh', 'sparkle']) sfx[k] = (...a) => {
    if (muted || !ensure() || ctx.state === 'closed') return;
    resume();
    try { eng.sfx[k](ctx.currentTime + .01, ...a); } catch (e) { console.warn('[music] sfx', k, e); }
  };
  return {
    start, toggle, setMuted, sfx,
    duck(amount = .5, seconds = 1) { if (eng) eng.duck(amount, seconds); },
    onBeat(cb) { cbs.add(cb); return () => cbs.delete(cb); },
    get playing() { return started && !muted && !!ctx && ctx.state !== 'closed'; },
    get muted() { return muted; },
    get sfxReady() { return prepDone; },             // background:false: SFX ya sintetizados en tiempo ocioso
    get sfxCached() { return store ? Object.keys(store.cache).filter(k => store.cache[k]).length + store.bufs.size : 0; },
    get analyser() { return eng ? eng.analyser : null; },
    get context() { return ctx; },
    get position() { return ctx && started ? { beat, cycle: eng.cycleOf(Math.max(0, beat - 1)), time: ctx.currentTime } : null; },
    info: MUSIC_INFO,
    dispose() {
      clearInterval(timer); clearTimeout(warmT); clearTimeout(susT); clearTimeout(visT); cancelAnimationFrame(raf); cbs.clear();
      document.removeEventListener('visibilitychange', onVis);
      for (const e of ['pointerdown', 'touchend', 'keydown']) window.removeEventListener(e, kick);
      if (ctx && owned) ctx.close().catch(() => {}); ctx = null; eng = null; started = false;
    },
  };
}

// ───────────────────────────── Render offline (pruebas / exportación) ─────────────────────────────
export function renderOffline({ seconds = 40, sampleRate = 44100, fromCycle = 0, fade = true, only, gain } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate), eng = createEngine(ctx, { only, gain }), t0 = .1;
  eng.fadeIn(t0, fade ? FADE_IN : .02);
  for (let b = fromCycle * 8, t = t0; t < seconds; b++, t += SPB) eng.beat(b, t);
  return ctx.startRendering();
}
export const SFX_SEQUENCE = [['sealCrack', .3], ['ribbonSwish', 2.4], ['paperUnroll', 3.8, 2.4], ['chime', 7.8], ['whoosh', 11.6], ['sparkle', 13.2]];
export function renderSfxOffline({ sampleRate = 44100, seconds = 16 } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate), eng = createEngine(ctx);
  for (const [k, t, a] of SFX_SEQUENCE) eng.sfx[k](t, a);
  return ctx.startRendering();
}
