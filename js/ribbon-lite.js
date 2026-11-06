// The real Blender animation, baked into WebP frames: no video decoder, autoplay or WebGL.
import { device } from './device.js?v=20261105a';
const BASE = new URL('../assets/botanical/', import.meta.url);
const SIZE = device.light ? 240 : 360, COLS = 7, FRAMES = 42, FPS = 15;
// 05/11 («que se vea la cinta soltándose en móvil»): el atlas tiene 15 cuadros/s; se funde cada cuadro con el siguiente
// (movimiento continuo a 60 Hz en vez de saltos) y el desatado va un 12 % más pausado. openTime() sigue en segundos del
// video original, así los eventos de la puerta (tirón, nudo, polvo de oro, apertura) caen donde deben.
const SPEED = 0.88;
export function createRibbonLite({ button, canvas, assets, reduced, onOwnProgress, ts = 1 }) {
  const ctx = canvas.getContext('2d');
  let idle = null, atlas = null, mode = 'canvas', disposed = false, opening = false;
  let raf = 0, elapsed = 0, frame = -1, opacity = 1, ended = false, fallbackOpening = false;
  const load = (url, ms = 7000) => new Promise(resolve => {
    const im = new Image(); im.decoding = 'async';
    const timer = setTimeout(() => resolve(null), ms);
    im.onload = () => { clearTimeout(timer); resolve(disposed ? null : im); };
    im.onerror = () => { clearTimeout(timer); resolve(null); };
    im.src = url;
  });
  function resize() {
    if (disposed) return;
    const px = Math.min(640, Math.max(240, Math.round(button.clientWidth * Math.min(devicePixelRatio || 1, 1.5))));
    if (canvas.width !== px) canvas.width = canvas.height = px;
    draw();
  }
  function draw() {
    if (disposed || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = opacity;
    if (opening && atlas && !fallbackOpening) {
      const ff = Math.min(FRAMES - 1, elapsed * FPS), f = Math.floor(ff), k = ff - f;
      ctx.drawImage(atlas, f % COLS * SIZE, Math.floor(f / COLS) * SIZE, SIZE, SIZE, 0, 0, canvas.width, canvas.height);
      if (k > .02 && f < FRAMES - 1) {
        const g = f + 1;
        ctx.globalAlpha = opacity * k;
        ctx.drawImage(atlas, g % COLS * SIZE, Math.floor(g / COLS) * SIZE, SIZE, SIZE, 0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = opacity;
      }
    } else if (idle && opening && fallbackOpening) {
      // If the atlas is unavailable, the two halves still pull apart visibly.
      const t = Math.min(1, elapsed / 2.2), W = canvas.width, H = canvas.height;
      for (const side of [-1, 1]) {
        ctx.save(); ctx.globalAlpha = opacity * Math.min(1, (1-t)*2);
        ctx.translate(W/2 + side * W * t * .65, H * (.43 + t*.12)); ctx.rotate(side * t * .28);
        const sx = side < 0 ? 0 : idle.width/2;
        ctx.drawImage(idle, sx, 0, idle.width/2, idle.height, side < 0 ? -W/2 : 0, -H*.43, W/2, H);
        ctx.restore();
      }
    } else if (idle) ctx.drawImage(idle, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
  }
  // Start the atlas request immediately; a broken atlas never prevents entry.
  const atlasP = reduced ? Promise.resolve(null) : load(new URL(device.light ? 'ribbon-open.webp' : 'ribbon-open-hq.webp', BASE)).then(im => { atlas = im; return im; });
  const idleReady = load(new URL('ribbon-idle.webp', BASE), 3500).then(async im => {
    idle = im || await load(assets.poster, 2000);
    if (disposed) return mode;
    if (!idle) {
      mode = 'svg';
      const el = document.createElement('span'); el.className = 'cg-bow__emergency';
      el.innerHTML = '<i></i><i></i><b></b>'; button.querySelector('.cg-bow__lift').append(el);
    }
    button.classList.add('is-atlas'); resize(); onOwnProgress?.(1); return mode;
  });
  const ready = idleReady;
  // el lazo se puede tocar cuando ya está la animación real del desatado (o a los 7 s, con la de respaldo): gate.js lo espera
  const atlasReady = Promise.race([atlasP, new Promise(r => setTimeout(r, 7000))]);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  ro?.observe(button); addEventListener('resize', resize, { passive: true });
  function halt() { cancelAnimationFrame(raf); raf = 0; }
  return {
    ready, atlasReady,
    get mode() { return mode; }, get fps() { return FPS; }, get bankSize() { return 0; },
    get canvasEl() { return canvas; }, get abrir() { return atlas; },
    get bandSource() { return idle ? [idle, 'img'] : null; },
    get abrirEnded() { return ended; }, get gpuMasks() { return true; },
    onFirstFrame(cb) { ready.then(() => { if (!disposed) cb(); }); },
    openTime() { return elapsed; }, duration() { return 2.8; }, get speed() { return SPEED; },
    setGlow() {}, pauseIdle() {}, precomputeMasks() {}, bankMask() { return null; },
    sampleMask() {
      if (disposed || !idle) return Promise.resolve([]);
      const c = document.createElement('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d', { willReadFrequently: true });
      const f = Math.min(FRAMES - 1, Math.floor(elapsed * FPS));
      if (atlas && !fallbackOpening) x.drawImage(atlas, f % COLS * SIZE, Math.floor(f / COLS) * SIZE, SIZE, SIZE, 0, 0, 48, 48);
      else x.drawImage(idle, 0, 0, 48, 48);
      const d = x.getImageData(0, 0, 48, 48).data, pts = [];
      for (let i = 0; i < 48*48; i += 2) if (d[i*4+3] > 90) pts.push({u: (i%48)/48, v: Math.floor(i/48)/48});
      return Promise.resolve(pts);
    },
    playOpen() {
      if (disposed || reduced || !ctx) return Promise.resolve(false);
      // Don't await a network request before acknowledging the tap.
      button.classList.add('is-ribbon-pull');
      return Promise.race([atlasP, new Promise(r => setTimeout(() => r(null), atlas ? 0 : 1600))]).then(im => {
        if (disposed || (!im && !idle)) return false;
        fallbackOpening = !im;
        opening = true; ended = false; frame = -1; const start = performance.now();
        button.classList.remove('is-ribbon-pull');
        const tick = now => {
          if (disposed) return;
          elapsed = Math.min(2.8, (now - start) / 1000 * ts * SPEED);
          const next = Math.round(elapsed * FPS * 8);   // (1/8 de cuadro: el fundido avanza en cada refresco)
          if (next !== frame) { frame = next; draw(); }
          if (elapsed < 2.8) raf = requestAnimationFrame(tick); else { ended = true; raf = 0; }
        };
        raf = requestAnimationFrame(tick); return true;
      });
    },
    fadeOut(ms = 400) {
      const start = performance.now(), from = opacity;
      return new Promise(resolve => {
        const tick = now => {
          if (disposed) return resolve();
          opacity = from * Math.max(0, 1 - (now - start) / ms); draw();
          if (opacity > 0) requestAnimationFrame(tick); else resolve();
        }; requestAnimationFrame(tick);
      });
    },
    halt,
    dispose() { disposed = true; halt(); ro?.disconnect(); removeEventListener('resize', resize); idle = atlas = null; canvas.remove(); },
  };
}
