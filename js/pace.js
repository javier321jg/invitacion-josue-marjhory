// RITMO · el scroll no se adelanta a las animaciones (05/11, pedido del usuario: «que no se salte al otro; si bajo todo
// rápido, tiene que ir de acuerdo a la velocidad de las animaciones»).
//
// Cada «parada» (hold) es una posición de scroll que no se pasa hasta que su animación termina: la llegada de los anillos,
// el pergamino que se escribe, la foto que se forma con flores, las letras doradas, el atardecer con la estrella fugaz…
// No secuestra el scroll: por encima de la parada todo se mueve normal; al llegar a ella la página se detiene con suavidad
// (rueda, dedo, teclado o un tirón con inercia), aparece «Un momento…» y, cuando la animación acaba, «Desliza para
// continuar». Solo frena hacia abajo; subir siempre está permitido.
// Garantías para no dejar a nadie atrapado: una parada se suelta sola si su animación no avanza en `stallMs` o si el
// invitado lleva `maxMs` empujando contra ella; y una parada que el invitado ya dejó atrás (recarga, salto) no se aplica.
//
// API: createPace({ labelWait, labelGo, ios }) → { add(hold), update(), limit, state() }
//   hold = { id, active(): bool, done(): bool, y(): número (scrollY máximo), prog?(): número que cambia al avanzar,
//            live?(): la animación ya corre (para el escape de teléfono lento), maxMs?, stallMs? }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => performance.now();

export function createPace({ labelWait = 'Un momento…', labelGo = 'Desliza para continuar', ios = false, bottom = null } = {}) {
  const html = document.documentElement;
  const holds = [];
  let limit = Infinity, cur = null, listening = false, touchY = null, tickT = 0, stopT = 0, goT = 0;
  let lastContact = -1e9;
  // fps de la página mientras hay una parada cerca: en un teléfono que no llega a ~12 fps la animación avanza a cámara lenta
  // y nadie debe esperarla minutos: ahí (menos de 8 fps sostenidos) cada parada se suelta a los 16 s de empujar contra ella
  const frames = [];
  let fpsRaf = 0;
  // (promedio de 8 s: un bache corto —compilar un sombreador, montar una escena— no cuenta como teléfono lento)
  const fpsLoop = t => { frames.push(t); while (frames.length && frames[0] < t - 8000) frames.shift(); fpsRaf = listening ? requestAnimationFrame(fpsLoop) : 0; };
  const slow = () => {
    if (frames.length < 4) return false;
    const span = (frames[frames.length - 1] - frames[0]) / 1000;
    return span > 6 && (frames.length - 1) / span < 8;
  };

  // aviso discreto abajo al centro (sin texto en el árbol accesible: es decorativo)
  const cue = document.createElement('div');
  cue.className = 'pace-cue'; cue.setAttribute('aria-hidden', 'true');
  cue.innerHTML = '<span class="pace-cue__dots"><i></i><i></i><i></i></span><span class="pace-cue__t"></span>';
  const cueText = cue.querySelector('.pace-cue__t');
  (document.body || html).append(cue);
  const showCue = mode => {
    let b = 18; try { b = bottom ? +bottom() || 18 : 18; } catch {}
    cue.style.bottom = `calc(${b}px + env(safe-area-inset-bottom, 0px))`;
    cue.dataset.mode = mode;
    cueText.textContent = mode === 'go' ? labelGo : labelWait;
    cue.classList.add('is-on');
  };
  const hideCue = () => cue.classList.remove('is-on');

  function add(h) {
    holds.push({ maxMs: 15000, stallMs: 9000, prog: null, ...h, released: false, armed: false, contact: 0, pv: null, pt: 0 });
    schedule();
  }
  function release(h, why) {
    if (h.released) return;
    h.released = true;
    if (why !== 'done') console.info('[pace] ' + h.id + ' suelta (' + why + ')');
    // si el invitado estaba empujando contra ella, se le invita a seguir
    if (h.contact && now() - lastContact < 2500 && why !== 'passed') {
      showCue('go'); cue._y = scrollY; clearTimeout(goT); goT = setTimeout(hideCue, 2600);
    }
  }
  function compute() {
    const y0 = scrollY, vh = innerHeight || 1, t = now();
    let lim = Infinity, best = null;
    for (const h of holds) {
      if (h.released) continue;
      let on = false; try { on = !!h.active(); } catch { on = false; }
      if (!on) continue;
      let done = false; try { done = !!h.done(); } catch { done = true; }
      if (done) { release(h, 'done'); continue; }
      let y = NaN; try { y = h.y(); } catch {}
      if (!Number.isFinite(y)) continue;
      y = Math.max(0, Math.round(y + (h.shift || 0)));
      // solo frena a quien llega desde arriba: si ya estaba bastante más abajo (recarga, salto con la barra), no se aplica;
      // si la parada aparece cuando el invitado acaba de pasarla (menos de media pantalla), se queda donde está
      if (!h.armed) {
        if (y0 <= y + 2) h.armed = true;
        else if (y0 > y + vh * .5) { release(h, 'passed'); continue; }
        else { h.armed = true; h.shift = (h.shift || 0) + (y0 - y); y = y0; }
      }
      // avance de la animación (para soltar si se atasca)
      if (h.prog) {
        let v = null; try { v = h.prog(); } catch {}
        if (v !== h.pv) { h.pv = v; h.pt = t; }
        if (h.contact && t - h.pt > h.stallMs) { release(h, 'sin avance'); continue; }
      }
      if (h.contact && t - h.contact > h.maxMs) { release(h, 'tiempo máximo'); continue; }
      // (solo con la animación ya en marcha: mientras una escena se monta, su propio respaldo decide)
      let live = true; if (h.live) { try { live = !!h.live(); } catch { live = true; } }
      if (live && !h.liveAt) h.liveAt = t;
      if (h.contact && live && t - Math.max(h.contact, h.liveAt) > 16000 && slow()) { release(h, 'teléfono lento'); continue; }
      if (y < lim) { lim = y; best = h; }
    }
    limit = lim; cur = best;
    return lim;
  }
  function contact() {
    const t = now();
    lastContact = t;
    if (cur && !cur.contact) cur.contact = t;
    if (cur) { showCue('wait'); clearTimeout(goT); goT = setTimeout(() => { if (now() - lastContact > 1100) hideCue(); }, 1300); }
  }
  // inercia de iOS: un scrollTo no la corta; quitar el desplazamiento un instante sí
  function stopMomentum() {
    if (!ios) return;
    html.classList.add('pace-stop');
    clearTimeout(stopT); stopT = setTimeout(() => html.classList.remove('pace-stop'), 90);
  }
  function clampNow() {
    if (scrollY > limit + 1) {
      stopMomentum();
      scrollTo(0, limit);
      contact();
    }
  }

  // escuchas activas solo cerca de una parada (un oyente táctil no pasivo hace esperar al scroll por el hilo principal)
  const onWheel = e => {
    if (!(e.deltaY > 0) || limit === Infinity) return;
    const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
    const room = limit - scrollY;
    if (room <= 1) { e.preventDefault(); contact(); }
    else if (d > room) { e.preventDefault(); scrollTo(0, limit); contact(); }
  };
  const onTouchStart = e => { touchY = e.touches?.[0]?.clientY ?? null; };
  const onTouchMove = e => {
    const y = e.touches?.[0]?.clientY;
    if (y == null || touchY == null) return;
    const up = touchY - y;            // > 0: el dedo sube → la página bajaría
    touchY = y;
    if (up > 0 && limit !== Infinity && scrollY >= limit - 1 && e.cancelable) { e.preventDefault(); contact(); }
  };
  const KEYS = new Set([' ', 'Spacebar', 'PageDown', 'ArrowDown', 'Down', 'End']);
  const onKey = e => {
    if (!KEYS.has(e.key) || limit === Infinity || e.shiftKey && e.key === ' ') return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    if (scrollY >= limit - 1 || e.key === 'End') { e.preventDefault(); if (e.key === 'End') scrollTo(0, limit); contact(); }
  };
  function listen(on) {
    if (on === listening) return;
    listening = on;
    const o = { passive: false };
    if (on) {
      if (!fpsRaf) { frames.length = 0; fpsRaf = requestAnimationFrame(fpsLoop); }
      addEventListener('wheel', onWheel, o); addEventListener('touchstart', onTouchStart, { passive: true });
      addEventListener('touchmove', onTouchMove, o); addEventListener('keydown', onKey);
    } else {
      removeEventListener('wheel', onWheel, o); removeEventListener('touchstart', onTouchStart, { passive: true });
      removeEventListener('touchmove', onTouchMove, o); removeEventListener('keydown', onKey);
    }
  }

  function update() {
    compute();
    const near = limit !== Infinity && scrollY > limit - (innerHeight || 800) * 1.6;
    listen(near);
    if (limit !== Infinity) clampNow();
    if (limit === Infinity || scrollY < limit - 4) { if (cue.dataset.mode === 'wait' && now() - lastContact > 900) hideCue(); }
    if (cue.dataset.mode === 'go' && cue.classList.contains('is-on') && scrollY > cue._y + 40) hideCue();
  }
  // las paradas se sueltan con el tiempo (la animación termina): se revisa a menudo mientras quede alguna
  function schedule() {
    if (tickT) return;
    tickT = setInterval(() => {
      if (holds.every(h => h.released)) { clearInterval(tickT); tickT = 0; listen(false); limit = Infinity; return; }
      update();
    }, 200);
  }

  return {
    add, update,
    get limit() { return limit; },
    state: () => ({ limit, current: cur?.id || null, holds: holds.map(h => ({ id: h.id, released: h.released, armed: h.armed, contact: !!h.contact })) }),
  };
}
