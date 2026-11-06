// WEB-SHELL · componentes de interfaz: tarjeta HTML del pergamino, .ics, galería + lightbox, cuenta regresiva, botón de música.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------------ */
/* Pergamino HTML                                                            */
/* ------------------------------------------------------------------------ */
function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
/** Borde deshilachado: polígono con los lados izquierdo y derecho irregulares. */
function deckle(seed = 7) {
  const rnd = mulberry(seed), n = 34, pts = [];
  const j = (amp) => (rnd() * amp + (rnd() < .18 ? rnd() * amp * 1.6 : 0)).toFixed(1);
  pts.push('0% 0%', '100% 0%');
  for (let i = 1; i < n; i++) pts.push(`calc(100% - ${j(3.2)}px) ${(i / n * 100).toFixed(2)}%`);
  pts.push('100% 100%', '0% 100%');
  for (let i = n - 1; i > 0; i--) pts.push(`${j(3.2)}px ${(i / n * 100).toFixed(2)}%`);
  return `polygon(${pts.join(',')})`;
}

export function buildParchmentCard(T, { closed = false, reader = false, titleId = '', escritura = false } = {}) {
  const el = document.createElement('div');
  el.className = 'pcard' + (closed ? ' is-closed' : '') + (reader ? ' pcard--reader' : '');
  const [d0, d1] = T.details;
  // FIX ronda 1 (idea): en la tarjeta de respaldo (teléfonos sin WebGL 2 / GPU débil) los nombres se escriben a mano en oro
  // con js/escritura.js (trazos horneados en assets/escritura/tarjeta-*.json); main.js los dispara al abrir la tarjeta
  const esw = id => (escritura ? ` data-escritura="${id}" data-escritura-modo="manual" data-escritura-pluma` : '');
  el.innerHTML = `
    <div class="pcard__rod pcard__rod--top" aria-hidden="true"></div>
    <div class="pcard__wrap"><div class="pcard__clip">
      <div class="pcard__paper" style="clip-path:${deckle(reader ? 11 : 7)}">
        <p class="pcard__kicker">${esc(T.kicker)}</p>
        <h3 class="pcard__title"${titleId ? ` id="${titleId}"` : ''}>${esc(T.title)}</h3>
        <div class="pcard__flourish" aria-hidden="true">${esc(T.flourish)}</div>
        <p class="pcard__names${escritura ? ' pcard__names--esc' : ''}"><span${esw('tarjeta-nombre-1')}>${esc(T.names[0])}</span> <em${esw('tarjeta-nombre-y')}>${esc(T.names[1])}</em> <span${esw('tarjeta-nombre-2')}>${esc(T.names[2])}</span></p>
        <p class="pcard__verse">${T.verse.map(esc).join('<br>')}</p>
        <div class="pcard__details">
          <div><span>${esc(d0.label)}</span><strong>${esc(d0.value)}</strong><span>${esc(d0.sub)}</span></div>
          <i class="pcard__divider" aria-hidden="true"></i>
          <div><span>${esc(d1.label)}</span><strong>${esc(d1.value)}</strong><span>${esc(d1.sub)}</span></div>
        </div>
        <div class="pcard__place"><span>${esc(T.placeLabel)}</span><p>${esc(T.place)}</p></div>
        <p class="pcard__closing">${T.closing.map(esc).join('<br>')}</p>
      </div>
    </div></div>
    <div class="pcard__rod pcard__rod--bottom" aria-hidden="true"></div>
    ${closed ? '<button class="pcard__seal" type="button" aria-label="Romper el sello y abrir el pergamino">J&amp;M</button>' : ''}`;
  return el;
}

/** Copia accesible (lectores de pantalla) del texto del pergamino. */
export function fillA11yCopy(article, T) {
  const [d0, d1] = T.details;
  article.innerHTML = `
    <p>${esc(T.kicker)}</p>
    <h3>${esc(T.title)}</h3>
    <p>${esc(T.names.join(' '))}</p>
    <blockquote><p>${esc(T.verse.join(' '))}</p></blockquote>
    <p>${esc(d0.label)} ${esc(d0.value)}, ${esc(d0.sub)}. ${esc(d1.label)}: ${esc(d1.value)} ${esc(d1.sub)}.</p>
    <p>${esc(T.placeLabel)}: ${esc(T.place)}</p>
    <p>${esc(T.closing.join(' '))}</p>`;
}

/* ------------------------------------------------------------------------ */
/* Calendario (.ics)                                                         */
/* ------------------------------------------------------------------------ */
export function buildIcsHref(EVENT, COUPLE) {
  const fmt = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const e = s => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const fold = line => { const out = []; let s = line; while (s.length > 60) { out.push(s.slice(0, 60)); s = ' ' + s.slice(60); } out.push(s); return out.join('\r\n'); };
  const start = new Date(EVENT.isoStart), end = new Date(EVENT.isoEnd);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Josue y Marjhory//Invitacion//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:cena-compromiso-josue-marjhory-20261224@invitacion',
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(start),
    'DTEND:' + fmt(end),
    'SUMMARY:' + e(`${EVENT.title} · ${COUPLE.a} & ${COUPLE.b}`),
    'LOCATION:' + e(EVENT.place),
    'DESCRIPTION:' + e(`${COUPLE.a} y ${COUPLE.b} te invitan a su ${EVENT.title.toLowerCase()}.\n${EVENT.weekday} ${EVENT.dateLong}, ${EVENT.time} ${EVENT.timeLabel}.\n${EVENT.place}\nCómo llegar: ${EVENT.mapUrl}`),
    'URL:' + EVENT.mapUrl,
    'STATUS:CONFIRMED', 'TRANSP:OPAQUE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + e(EVENT.title), 'TRIGGER:-P1D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + e(EVENT.title), 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.map(fold).join('\r\n') + '\r\n');
}

/* ------------------------------------------------------------------------ */
/* Galería masonry + inclinación 3D + lightbox                               */
/* ------------------------------------------------------------------------ */
export function initGallery(root, photosIn, { gsap = null, reduced = false, coupleLabel = 'Josué y Marjhory', onLayout, crops = {}, after = null } = {}) {
  const photos = photosIn.slice(); // puede reemplazarse por versiones recortadas (blob:)
  const items = photos.map((src, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ph'; b.dataset.i = i;
    b.setAttribute('aria-label', `Ampliar foto ${i + 1} de ${photos.length}`);
    b.innerHTML = `<img class="ph__img" src="${esc(src)}" alt="${esc(coupleLabel)} — recuerdo ${i + 1}" loading="lazy" decoding="async"><span class="ph__glare" aria-hidden="true"></span><span class="ph__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>`;
    b._ar = 1.25;
    const img = b.querySelector('img');
    return b;
  });
  // carga anticipada de proporciones (las <img lazy> no cargan hasta acercarse) y recortes opcionales
  // crops[src] = [x, y, w, h] en fracciones de la imagen original (quita marcos/flechas de capturas de pantalla)
  // FIX: espera a `after` (lo crítico de la puerta) y a un rato ocioso: no compite por la red ni por el hilo al arrancar
  const preload = () => photos.forEach((src, i) => {
    const im = new Image();
    im.onload = () => {
      const c = crops[src];
      if (c) {
        try {
          const cv = document.createElement('canvas');
          const sw = Math.round(im.naturalWidth * c[2]), sh = Math.round(im.naturalHeight * c[3]);
          cv.width = sw; cv.height = sh;
          cv.getContext('2d').drawImage(im, Math.round(im.naturalWidth * c[0]), Math.round(im.naturalHeight * c[1]), sw, sh, 0, 0, sw, sh);
          items[i]._ar = sh / sw; schedule();
          cv.toBlob(b => { if (!b) return; const u = URL.createObjectURL(b); photos[i] = u; items[i].querySelector('img').src = u; }, 'image/jpeg', .92);
          return;
        } catch { /* sin recorte */ }
      }
      items[i]._ar = im.naturalHeight / im.naturalWidth; schedule();
    };
    im.src = src;
  });
  Promise.resolve(after).catch(() => {}).then(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(preload, { timeout: 2500 }) : setTimeout(preload, 300)));

  let cols = 0, raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(layout); }
  function layout() {
    raf = 0;
    const k = innerWidth >= 900 ? 3 : 2;
    const gap = parseFloat(getComputedStyle(root).columnGap || getComputedStyle(root).gap) || 10;
    const W = root.clientWidth;
    if (!W) return;
    const colW = (W - gap * (k - 1)) / k;
    if (k !== cols) {
      cols = k; root.innerHTML = '';
      for (let c = 0; c < k; c++) { const d = document.createElement('div'); d.className = 'gallery__col'; root.append(d); }
    }
    const colEls = [...root.children], heights = new Array(k).fill(0), counts = new Array(k).fill(0);
    items.forEach(it => {
      let c = 0; for (let j = 1; j < k; j++) if (heights[j] < heights[c] - 1) c = j;
      if (it.parentNode !== colEls[c] || colEls[c].lastElementChild !== it) colEls[c].append(it);
      it.style.setProperty('--a', it._ar.toFixed(4));
      heights[c] += it._ar * colW; counts[c]++;
    });
    const total = heights.reduce((a, h, i) => a + h + gap * Math.max(0, counts[i] - 1), 0);
    root.style.height = Math.round(total / k) + 'px';
    onLayout?.();
  }
  schedule();
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(schedule, 120); }, { passive: true });

  // Inclinación 3D (solo puntero fino)
  if (!reduced && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    items.forEach(it => {
      it.addEventListener('pointermove', e => {
        const r = it.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        it.classList.add('is-tilting');
        it.style.setProperty('--ry', ((x - .5) * 12).toFixed(2) + 'deg');
        it.style.setProperty('--rx', ((.5 - y) * 12).toFixed(2) + 'deg');
        it.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
        it.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
      });
      it.addEventListener('pointerleave', () => {
        it.classList.remove('is-tilting');
        it.style.setProperty('--rx', '0deg'); it.style.setProperty('--ry', '0deg');
      });
    });
  }

  const lb = createLightbox(document.getElementById('lightbox'), photos, { gsap, reduced, coupleLabel });
  items.forEach((it, i) => it.addEventListener('click', () => lb.open(i, it)));
  return { items, layout: schedule, lightbox: lb };
}

function createLightbox(dlg, photos, { gsap, reduced, coupleLabel }) {
  const img = dlg.querySelector('.lb__img'), stage = dlg.querySelector('.lb__stage');
  const iEl = dlg.querySelector('.lb__i'), nEl = dlg.querySelector('.lb__n');
  nEl.textContent = photos.length;
  let idx = 0, opener = null, busy = false;
  const html = document.documentElement;
  const setSrc = (i) => {
    idx = (i + photos.length) % photos.length;
    img.src = photos[idx]; img.alt = `${coupleLabel} — recuerdo ${idx + 1} de ${photos.length}`;
    iEl.textContent = idx + 1;
    [idx + 1, idx - 1].forEach(j => { const p = new Image(); p.src = photos[(j + photos.length) % photos.length]; });
  };
  const ready = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve());

  async function open(i, fromEl) {
    opener = fromEl || null;
    setSrc(i);
    // FIX compatibilidad (Safari < 15.4 sin <dialog>.showModal): se abre con el atributo open (style.css lo muestra igual)
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    html.classList.add('is-locked');
    await ready();
    if (gsap && !reduced && fromEl) {
      const a = fromEl.getBoundingClientRect(), b = img.getBoundingClientRect();
      if (b.width) {
        const s = Math.max(a.width / b.width, a.height / b.height);
        gsap.fromTo(img, { x: (a.left + a.width / 2) - (b.left + b.width / 2), y: (a.top + a.height / 2) - (b.top + b.height / 2), scale: s, opacity: .4 },
          { x: 0, y: 0, scale: 1, opacity: 1, duration: .85, ease: 'expo.out', clearProps: 'transform' });
      }
    }
  }
  async function go(d) {
    if (busy) return; busy = true;
    if (gsap && !reduced) {
      await gsap.to(img, { x: -d * 70, opacity: 0, duration: .22, ease: 'power2.in' });
      setSrc(idx + d); await ready();
      await gsap.fromTo(img, { x: d * 70, opacity: 0 }, { x: 0, opacity: 1, duration: .5, ease: 'expo.out' });
    } else { setSrc(idx + d); }
    busy = false;
  }
  function close() { if (typeof dlg.close === 'function') dlg.close(); else { dlg.removeAttribute('open'); dlg.dispatchEvent(new Event('close')); } }
  dlg.addEventListener('close', () => {
    html.classList.remove('is-locked');
    if (gsap) gsap.set(img, { clearProps: 'all' });
    opener?.focus({ preventScroll: true });
  });
  dlg.querySelector('.lb__close').addEventListener('click', close);
  dlg.querySelector('.lb__prev').addEventListener('click', () => go(-1));
  dlg.querySelector('.lb__next').addEventListener('click', () => go(1));
  dlg.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  });
  // Swipe / arrastre
  let x0 = null, y0 = 0, moved = false;
  stage.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; moved = false; });
  stage.addEventListener('pointermove', e => {
    if (x0 === null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 6) moved = true;
    if (moved && !busy) img.style.transform = `translateX(${dx * .85}px) rotate(${dx * .01}deg)`;
  });
  const end = e => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    img.style.transform = '';
    if (moved && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (!moved && e.target === stage) close();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', () => { x0 = null; img.style.transform = ''; });
  return { open, close, go, get index() { return idx; } };
}

/* ------------------------------------------------------------------------ */
/* Cuenta regresiva con tarjetas "flip"                                      */
/* ------------------------------------------------------------------------ */
export function initCountdown(root, iso, { reduced = false } = {}) {
  const target = new Date(iso).getTime();
  const units = [['d', 'días'], ['h', 'horas'], ['m', 'min'], ['s', 'seg']];
  const sr = document.createElement('p'); sr.className = 'sr-only';
  const cards = {};
  units.forEach(([k, label]) => {
    const u = document.createElement('div'); u.className = 'cd';
    u.innerHTML = `<div class="flip" aria-hidden="true"><span class="flip__sizer">00</span>
      <span class="flip__half flip__half--top"><span class="flip__num">00</span></span>
      <span class="flip__half flip__half--bottom"><span class="flip__num">00</span></span>
      <span class="flip__leaf"><span class="flip__face flip__face--front"><span class="flip__num">00</span></span><span class="flip__face flip__face--back"><span class="flip__num">00</span></span></span>
    </div><span class="cd__label">${label}</span>`;
    root.append(u);
    const f = u.querySelector('.flip');
    cards[k] = {
      f, val: null,
      sizer: f.querySelector('.flip__sizer'),
      top: f.querySelector('.flip__half--top .flip__num'), bot: f.querySelector('.flip__half--bottom .flip__num'),
      front: f.querySelector('.flip__face--front .flip__num'), back: f.querySelector('.flip__face--back .flip__num'),
    };
    f.addEventListener('animationend', () => { const c = cards[k]; c.bot.textContent = c.front.textContent = c.val; f.classList.remove('is-flipping'); });
  });
  root.append(sr);
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);

  const set = (k, v, animate) => {
    const c = cards[k];
    if (c.val === v) return;
    const old = c.val ?? v; c.val = v;
    c.sizer.textContent = v;
    if (!animate || reduced || old === v) {
      c.top.textContent = c.bot.textContent = c.front.textContent = c.back.textContent = v;
      return;
    }
    c.f.classList.remove('is-flipping');
    c.top.textContent = v; c.bot.textContent = old; c.front.textContent = old; c.back.textContent = v;
    void c.f.offsetWidth; c.f.classList.add('is-flipping');
  };
  let first = true, lastMin = -1;
  const tick = () => {
    let s = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const v = { d: String(d).padStart(2, '0'), h: String(h).padStart(2, '0'), m: String(m).padStart(2, '0'), s: String(s).padStart(2, '0') };
    for (const k in v) set(k, v[k], !first && visible && !document.hidden);
    if (m !== lastMin) { lastMin = m; sr.textContent = `Faltan ${d} ${d === 1 ? 'día' : 'días'}, ${h} ${h === 1 ? 'hora' : 'horas'} y ${m} ${m === 1 ? 'minuto' : 'minutos'}.`; }
    first = false;
    setTimeout(tick, 1000 - (Date.now() % 1000) + 8);
  };
  tick();
}

/* ------------------------------------------------------------------------ */
/* Botón flotante de música con ecualizador                                  */
/* ------------------------------------------------------------------------ */
export function initMusicButton(btn, getMusic, { onStart } = {}) {
  const bars = [...btn.querySelectorAll('.music__eq i')];
  let started = false, raf = 0, data = null, unBeat = null;
  const sync = () => {
    const m = getMusic();
    const on = !!(m && m.playing);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Pausar música' : 'Activar música');
    btn.classList.toggle('is-css', on && !m?.analyser);
    if (on && m?.analyser && !raf) raf = requestAnimationFrame(loop);
  };
  const loop = () => {
    raf = 0;
    const m = getMusic();
    if (!m || !m.playing || !m.analyser || document.hidden) return;
    const an = m.analyser;
    if (!data || data.length !== an.frequencyBinCount) data = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(data);
    const n = data.length;
    bars.forEach((b, i) => {
      const lo = Math.floor(Math.pow(n, i / bars.length) * .9), hi = Math.max(lo + 1, Math.floor(Math.pow(n, (i + 1) / bars.length) * .9));
      let sum = 0; for (let j = lo; j < hi; j++) sum += data[j];
      const v = Math.min(1, .14 + (sum / (hi - lo) / 255) * 1.25);
      b.style.setProperty('--v', v.toFixed(3));
    });
    raf = requestAnimationFrame(loop);
  };
  btn.addEventListener('click', async () => {
    const m = getMusic();
    if (!m) return;
    try {
      if (!started && !m.playing) { started = true; const p = m.start(); onStart?.(); await p; }
      else m.toggle();
    } catch (e) { console.warn('[inv] música:', e); }
    sync(); setTimeout(sync, 200);
  });
  document.addEventListener('visibilitychange', sync);
  setInterval(sync, 800);
  return {
    show() { btn.hidden = false; sync(); },
    markStarted() { started = true; setTimeout(sync, 60); },
    attachBeat(m) {
      unBeat?.();
      unBeat = m?.onBeat?.((i) => {
        if (i % 2) return;
        btn.classList.remove('is-beat'); void btn.offsetWidth; btn.classList.add('is-beat');
      }) || null;
    },
    sync,
  };
}
