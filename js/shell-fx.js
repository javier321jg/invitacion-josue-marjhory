// WEB-SHELL · atmósfera: grano de película, polvo de oro (canvas 2D ligero) y brillo de cursor.

/** Genera una textura de grano (claro/oscuro con alfa bajo) y la publica como --grain. */
export function initGrain() {
  try {
    const S = 220, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true }); // FIX: lienzo en CPU (solo genera un PNG): no espera a la GPU
    const img = ctx.createImageData(S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      // aproximación gaussiana: suma de 3 uniformes
      const n = (Math.random() + Math.random() + Math.random()) / 1.5 - 1; // −1…1
      const a = Math.min(255, Math.abs(n) * 46);
      const light = n > 0;
      d[i] = light ? 255 : 8; d[i + 1] = light ? 244 : 4; d[i + 2] = light ? 222 : 2; d[i + 3] = a;
    }
    ctx.putImageData(img, 0, 0);
    document.documentElement.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
  } catch { /* sin grano */ }
}

/** Textura de fibras para el pergamino HTML (fallback / tarjeta de lectura). */
export function initFiber() {
  try {
    const S = 260, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.lineCap = 'round';
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * S, y = Math.random() * S, len = 4 + Math.random() * 22, ang = (Math.random() - .5) * .9;
      ctx.strokeStyle = Math.random() < .55 ? `rgba(110,70,30,${.04 + Math.random() * .08})` : `rgba(255,248,230,${.05 + Math.random() * .1})`;
      ctx.lineWidth = .4 + Math.random() * .8;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + len * .5, y + Math.sin(ang) * len * .5 + (Math.random() - .5) * 3, x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    for (let i = 0; i < 26; i++) { // "foxing": pequeñas manchas
      const x = Math.random() * S, y = Math.random() * S, r = 1 + Math.random() * 5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(130,80,35,${.08 + Math.random() * .1})`); g.addColorStop(1, 'rgba(130,80,35,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    document.documentElement.style.setProperty('--fiber', `url(${c.toDataURL('image/png')})`);
  } catch { /* sin fibras */ }
}

/** Polvo de oro flotante en canvas 2D. Solo dibuja cuando setEnabled(true) y la pestaña está visible. */
export function initDust(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { setEnabled() {}, burst() {} };
  const mobile = matchMedia('(max-width: 719px)').matches;
  const N = reduced ? 16 : mobile ? 38 : 72;
  const dpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  let W = 0, H = 0, enabled = false, raf = 0, last = 0;

  // sprite suave
  const spr = document.createElement('canvas'); spr.width = spr.height = 64;
  const sc = spr.getContext('2d');
  const g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
  // CREMA: motas de oro viejo (un brillo claro aditivo no se ve sobre el papel crema)
  g.addColorStop(0, 'rgba(214,176,104,.95)'); g.addColorStop(.18, 'rgba(190,148,82,.7)');
  g.addColorStop(.45, 'rgba(168,127,64,.18)'); g.addColorStop(1, 'rgba(168,127,64,0)');
  sc.fillStyle = g; sc.fillRect(0, 0, 64, 64);

  const P = Array.from({ length: N }, () => spawn(true));
  function spawn(init) {
    const z = .25 + Math.random() * .75;
    return {
      x: Math.random(), y: init ? Math.random() : 1.05, z,
      r: (1.4 + Math.random() * 3.6) * z,
      vy: (.006 + Math.random() * .018) * (.4 + z),
      ph: Math.random() * Math.PI * 2, tw: .6 + Math.random() * 1.8, sway: .004 + Math.random() * .012,
    };
  }
  const resize = () => {
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  };
  resize();
  addEventListener('resize', resize, { passive: true });

  let lastScroll = scrollY, scrollVel = 0;
  const frame = (now) => {
    raf = 0;
    if (!enabled || document.hidden) return;
    const dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    const sy = scrollY; scrollVel += ((sy - lastScroll) - scrollVel) * .2; lastScroll = sy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    const t = now / 1000;
    for (const p of P) {
      if (!reduced) {
        p.y -= p.vy * dt + (scrollVel / H) * .35 * p.z;
        p.x += Math.sin(t * .6 + p.ph) * p.sway * dt;
      }
      if (p.y < -.05) Object.assign(p, spawn(false));
      if (p.y > 1.08) p.y = -.04;
      if (p.x < -.05) p.x = 1.04; if (p.x > 1.05) p.x = -.04;
      const a = (.25 + .75 * Math.pow(.5 + .5 * Math.sin(t * p.tw + p.ph), 2)) * (.35 + .65 * p.z);
      const s = p.r * 6;
      ctx.globalAlpha = a * .6;
      ctx.drawImage(spr, p.x * W - s / 2, p.y * H - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    if (!reduced) raf = requestAnimationFrame(frame);
  };
  const kick = () => { if (!raf && enabled && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', kick);
  if (reduced) addEventListener('scroll', kick, { passive: true });
  return {
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      canvas.style.opacity = on ? '1' : '0';
      if (on) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
  };
}

/** Brillo cálido que sigue al cursor (solo escritorio). */
export function initGlow(el) {
  if (!el || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty, raf = 0;
  const step = () => {
    x += (tx - x) * .12; y += (ty - y) * .12;
    el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > .4 ? requestAnimationFrame(step) : 0;
  };
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    tx = e.clientX; ty = e.clientY;
    el.classList.add('is-on');
    if (!raf) raf = requestAnimationFrame(step);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => el.classList.remove('is-on'));
}
