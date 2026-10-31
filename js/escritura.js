// js/escritura.js — ESCRITURA-HTML · letras DORADAS que se escriben a mano en el HTML (SPEC, decisión n.º 6).
//
// USO (se monta solo, sin dependencias, sin WebGL):
//   <link rel="stylesheet" href="css/escritura.css">
//   <script type="module" src="js/escritura.js"></script>
//   <span class="line" data-escritura="historia-titulo-1">Un paso más</span>
//
// Cada elemento [data-escritura="<id>"] recibe un SVG vectorial (nítido a cualquier DPR) con el texto en ORO METÁLICO que se
// revela TRAZO A TRAZO siguiendo el esqueleto horneado (assets/escritura/<id>.json, ver tools/escritura-html/hornear.py):
// una máscara de trazo grueso por tramo, animada con stroke-dashoffset y recortada a la región de tinta de ese trazo. Encima,
// un lienzo 2D efímero dibuja la chispa de la punta de la pluma, chispas y el brillo de la tinta fresca que se asienta; al
// terminar, un brillo recorre las letras (capa CSS compuesta, sin trabajo del hilo principal) y se repite en los tiempos
// fuertes de la música (window.__inv.music.onBeat) o cada ~9 s mientras se ve.
// El texto real queda en el DOM (transparente, seleccionable y accesible). Sin JS, sin SVG o si falla el JSON: texto dorado.
//
// Atributos opcionales (en el mismo elemento):
//   data-escritura-modo="vista"      (por defecto) se escribe UNA vez al entrar en pantalla (35 % visible, sobre el 88 % inferior)
//                      ="scroll"     el avance sigue al scroll: 0 con el elemento al 92 % de la altura de la ventana, 1 al 42 %
//                                    (ajustable: data-escritura-scroll="0.92 0.42")
//                      ="manual"     solo con play()/seek()
//   data-escritura-duracion="3.2"    segundos (por defecto: durSugerida del horneado)
//   data-escritura-retraso="0.25"    segundos de espera tras dispararse
//   data-escritura-tras="<id>"       espera a que termine esa otra pieza. Sin él, las piezas de una misma <section>
//                                    (o [data-escritura-grupo]) se encadenan solas en orden del DOM.
//
// API (window.__inv.escritura y window.__escritura):
//   mount(el) → Promise<pieza|null>      monta (idempotente). Lo hace solo al cargar y con elementos nuevos (MutationObserver).
//   play(el, { duracion?, desde? }) → Promise<void>   escribe ya (desde 0..1), sin esperar a la vista ni a la cola.
//   reset(el)                            borra la escritura; vuelve a escribirse al entrar en pantalla.
//   seek(el, p)  /  complete(el)         fija el avance 0..1 / lo deja escrito.
//   list() → [{ id, estado, avance, duracion }]      ready: Promise (todas las piezas presentes montadas)      fps
// Eventos en el elemento (bubbles): 'escritura:inicio' y 'escritura:fin' con detail { id }.
// Movimiento reducido (prefers-reduced-motion, html.reduced, ?reduced=1, __inv.shell.reduced): aparece completo con fundido.

const SVGNS = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';
const BASE = new URL('../assets/escritura/', import.meta.url);
const QS = new URLSearchParams(location.search);
const MQ = matchMedia('(prefers-reduced-motion: reduce)');
// COMPAT-FLUIDEZ: con html.soft-motion (preferencia del sistema → modo suave de main.js) se escribe igual, por trazos
const reduced = () => (MQ.matches && !document.documentElement.classList.contains('soft-motion')) || QS.has('reduced') || document.documentElement.classList.contains('reduced') || !!window.__inv?.shell?.reduced;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

let UID = 0;
const piezas = new Map();          // elemento → Pieza
const datos = new Map();           // id → Promise<json>

function cargar(id) {
  if (!datos.has(id)) {
    datos.set(id, fetch(new URL(encodeURIComponent(id) + '.json', BASE)).then(r => {
      if (!r.ok) throw new Error(`escritura: ${id}.json → ${r.status}`);
      return r.json();
    }));
  }
  return datos.get(id);
}

function svg(tag, attrs, parent) {
  const n = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

const norm = s => s.normalize('NFC').replace(/\s+/g, ' ').trim();

// Oro metálico (unidades de fuente, y hacia abajo, línea base 0): champán arriba, horizonte brillante, bronce abajo.
const ORO = [
  [0, '#fff9e4'], [0.15, '#fce9b4'], [0.3, '#f4d185'], [0.44, '#e4b55d'], [0.53, '#fff4d2'],
  [0.585, '#f6d890'], [0.68, '#d6a24a'], [0.8, '#ae7b2d'], [0.9, '#c89545'], [1, '#f2cf88'],
];
// CREMA (decisión n.º 9.1): sobre el papel crema (historia, momentos) el oro claro no se lee → oro en lámina PROFUNDO con un
// brillo estrecho; sobre las fotos (#final, cielo de Ahuayro) sigue el oro champán.
const ORO_HONDO = [
  [0, '#93692f'], [0.15, '#a87f40'], [0.3, '#c49c58'], [0.44, '#8a6430'], [0.53, '#d4b273'],
  [0.585, '#a87f40'], [0.68, '#7d5a2b'], [0.8, '#5e4019'], [0.9, '#6e4c1f'], [1, '#93692f'],
];
// Filete oscuro bajo el oro (solo asoma por fuera: paint-order stroke) → legible sobre fotos claras.
const FILETE = { color: '#2b1706', ancho: 22 };

/* ====================================================================================================== */
class Pieza {
  constructor(el) {
    this.el = el;
    this.id = el.dataset.escritura;
    this.n = ++UID;
    this.estado = 'cargando';      // cargando → armado → pendiente → escribiendo → escrito | error
    this.tn = 0;                   // tiempo natural (s del horneado)
    this.visible = false;
    this.shineAt = 0;
    this.fx = null;
    this.lay = null;
    this.waiters = [];
    this.lastBuildKey = '';
  }

  get modo() { return this.el.dataset.escrituraModo || 'vista'; }
  get dur() {                       // segundos reales de la escritura
    const a = parseFloat(this.el.dataset.escrituraDuracion);
    return a > 0 ? a : (this.data.durSugerida || this.data.dur || 3);
  }

  async init() {
    try {
      this.data = await cargar(this.id);
    } catch (e) {
      this.fail(e); return null;
    }
    if (this.data.v !== 2) { this.fail(new Error('formato de horneado no soportado')); return null; }
    if (typeof SVGElement === 'undefined' || !document.createElementNS(SVGNS, 'svg').createSVGRect) { this.fail(new Error('sin SVG')); return null; }
    neutralizarRevelados(this.el);
    await fuentesListas(this.el, this.data.texto);
    this.build();
    // halo cálido estático detrás del texto (sin filter: solo opacidad, en el compositor); no si el anfitrión ya trae filter
    if (getComputedStyle(this.el).filter === 'none') {
      this.halo = document.createElement('div');
      this.halo.className = 'esc-capa esc-halo';
      this.halo.setAttribute('aria-hidden', 'true');
      this.el.insertBefore(this.halo, this.svg);
    }
    if (!this.layout()) {
      // aún sin caja (oculto) o texto distinto: reintenta al cambiar de tamaño; si el texto no coincide, se queda el respaldo
      if (this.estado === 'error') return null;
    }
    this.el.classList.add('esc-on');
    this.el.dataset.escrituraEstado = 'armado';
    this.estado = 'armado';
    this.setTime(0, true);
    observar(this);
    return this;
  }

  fail(e) {
    this.estado = 'error';
    this.el.dataset.escrituraEstado = 'error';
    this.el.classList.remove('esc-on');
    this.fxClose?.(true);
    this.svg?.remove();
    this.brillo?.remove();
    this.halo?.remove();
    console.warn('[escritura]', this.id, e?.message || e);
  }

  /* ---------------------------------------------------------------- SVG */
  build() {
    const d = this.data, n = this.n, el = this.el;
    const root = svg('svg', { class: 'esc-capa esc-svg', 'aria-hidden': 'true', focusable: 'false', width: 1, height: 1 });
    const defs = svg('defs', null, root);
    const grad = svg('linearGradient', { id: `esc${n}-oro`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: -1000, x2: 0, y2: 350 }, defs);
    const enFoto = !!el.closest('#final');
    for (const [o, c] of (enFoto ? ORO : ORO_HONDO)) svg('stop', { offset: o, 'stop-color': c }, grad);
    const gid = {};
    let gi = 0;
    for (const name in d.glifos) {
      const id = `esc${n}-g${gi++}`;
      svg('path', { id, d: d.glifos[name] }, defs);
      gid[name] = id;
    }
    const top = svg('g', {
      fill: `url(#esc${n}-oro)`, stroke: FILETE.color, 'stroke-width': FILETE.ancho, 'stroke-linejoin': 'round',
      'stroke-opacity': enFoto ? 0.68 : 0.3, 'paint-order': 'stroke',
    }, root);
    this.gid = gid;
    this.words = d.palabras.map((w, wi) => {
      const mask = svg('mask', {
        id: `esc${n}-m${wi}`, maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse',
        x: w.b[0] - 600, y: w.b[1] - 600, width: w.b[2] - w.b[0] + 1200, height: w.b[3] - w.b[1] + 1200, style: 'mask-type:alpha',
      }, defs);
      const mg = svg('g', { fill: 'none', stroke: '#fff', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, mask);
      const strokes = w.k.map((k, ki) => {
        const N = k.p.length >> 1;
        const P = new Float32Array(k.p);
        const cum = new Float32Array(N);
        for (let i = 1; i < N; i++) cum[i] = cum[i - 1] + Math.hypot(P[2 * i] - P[2 * i - 2], P[2 * i + 1] - P[2 * i - 1]);
        const T = new Float32Array(k.t.length);
        let tm = -1e9;
        for (let i = 0; i < k.t.length; i++) { tm = Math.max(tm, k.t[i] / 1000); T[i] = tm; }
        let parent = mg;
        if (k.c) {
          const cid = `esc${n}-c${wi}-${ki}`;
          const cp = svg('clipPath', { id: cid, clipPathUnits: 'userSpaceOnUse' }, defs);
          svg('path', { d: k.c, 'clip-rule': 'evenodd' }, cp);
          parent = svg('g', { 'clip-path': `url(#${cid})` }, mg);
        }
        const chunks = k.w.map(([i0, i1, wd]) => {
          i1 = Math.min(i1, N - 1);
          let dd = `M${P[2 * i0]} ${P[2 * i0 + 1]}`;
          if (i1 === i0) dd += `l0.5 0`;
          for (let i = i0 + 1; i <= i1; i++) dd += `L${P[2 * i]} ${P[2 * i + 1]}`;
          const L = Math.max(0.5, cum[i1] - cum[i0]);
          const pe = svg('path', { d: dd, 'stroke-width': wd, 'stroke-dasharray': `${L.toFixed(2)} ${(L + 4).toFixed(2)}`, 'stroke-dashoffset': L.toFixed(2), display: 'none' }, parent);
          return { el: pe, s0: cum[i0], L, w: wd, v: -1 };
        });
        return { wi, P, cum, T, L: cum[N - 1], t0: T[0], t1: T[T.length - 1], chunks, kind: k.k, st: -1, lastL: 0 };
      });
      const g = svg('g', { class: 'esc-pal' }, top);
      const body = svg('g', { display: 'none' }, g);
      for (const [name, gx] of w.g) {
        const u = svg('use', { x: gx }, body);
        u.setAttribute('href', '#' + gid[name]);
        u.setAttributeNS(XLINK, 'xlink:href', '#' + gid[name]);
      }
      return { w, g, body, mask, strokes, st: -1 };
    });
    this.strokes = this.words.flatMap(w => w.strokes).sort((a, b) => a.t0 - b.t0);
    this.durN = Math.max(this.data.dur || 0, ...this.strokes.map(s => s.t1));
    this.svg = root;
    this.top = top;
    el.appendChild(root);
  }

  /* ---------------------------------------------------------------- medida y colocación */
  layout() {
    const el = this.el;
    if (!el.isConnected || !this.data || !this.svg) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return false;
    if (cs.display === 'inline') el.style.display = 'inline-block';
    if (cs.position === 'static') el.style.position = 'relative';
    const fs = parseFloat(cs.fontSize);
    if (!(fs > 0)) return false;
    // palabras del DOM (texto real) → rangos
    const nodes = [];
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: t => (t.parentElement && t.parentElement.closest('.esc-capa') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let t;
    let full = '';
    const starts = [];
    while ((t = tw.nextNode())) { starts.push(full.length); nodes.push(t); full += t.data; }
    const words = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(full))) words.push([m.index, m.index + m[0].length, m[0]]);
    const want = this.data.palabras.map(w => w.t);
    if (words.length !== want.length || words.some((w, i) => norm(w[2]) !== norm(want[i]))) {
      if (norm(full) !== norm(this.data.texto)) {
        this.fail(new Error(`el texto del DOM («${norm(full)}») no coincide con el horneado («${this.data.texto}»): vuelve a hornear`));
      }
      return false;
    }
    const loc = idx => {
      let k = 0;
      while (k + 1 < starts.length && starts[k + 1] <= idx) k++;
      return [nodes[k], idx - starts[k]];
    };
    const locEnd = idx => {
      let k = 0;
      while (k + 1 < starts.length && starts[k + 1] < idx) k++;
      return [nodes[k], idx - starts[k]];
    };
    const er = el.getBoundingClientRect();
    const sx = el.offsetWidth ? er.width / el.offsetWidth : 1;
    const sy = el.offsetHeight ? er.height / el.offsetHeight : 1;
    if (!er.width && !er.height) return false;
    // línea base: una sonda en línea de 0×0 alineada a la base, justo antes del nodo de texto de la primera palabra
    // (como hermana: no parte el nodo; el blanco previo se colapsa al inicio del renglón)
    const [n0] = loc(words[0][0]);
    const probe = document.createElement('span');
    probe.className = 'esc-sonda';
    let baseOff;
    try {
      n0.parentNode.insertBefore(probe, n0);
      const pr = probe.getBoundingClientRect();
      const r1 = document.createRange();
      const [a0, ao] = loc(words[0][0]);
      const [b0, bo] = locEnd(words[0][1]);
      r1.setStart(a0, ao); r1.setEnd(b0, bo);
      const rr = r1.getClientRects()[0] || r1.getBoundingClientRect();
      baseOff = (pr.top - rr.top) / sy;
    } finally {
      probe.remove();
    }
    const s = fs / (this.data.fuente.upm || 1000);
    // letter-spacing del CSS (p. ej. .story__title −.005em): la palabra se estira/encoge en x lo justo para que cada
    // glifo caiga donde lo pone el navegador (máscaras, celdas y glifos siguen juntos)
    const lsFu = (parseFloat(cs.letterSpacing) || 0) / s;
    const kxOf = pw => {
      const n = pw.g.length, last = n > 1 ? pw.g[n - 1][1] : 0;
      return n > 1 && last > 0 ? 1 + ((n - 1) * lsFu) / last : 1;
    };
    const bl = el.clientLeft || 0, bt = el.clientTop || 0;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const pos = words.map((w, i) => {
      const r = document.createRange();
      const [a, ao] = loc(w[0]);
      const [b, bo] = locEnd(w[1]);
      r.setStart(a, ao); r.setEnd(b, bo);
      const rs = r.getClientRects();
      let box = rs[0] || r.getBoundingClientRect();
      for (const q of rs) if (q.width > box.width) box = q;
      const pw = this.data.palabras[i];
      const left = (box.left - er.left) / sx - bl;
      const width = box.width / sx;
      const kx = kxOf(pw);
      const dx = (width - (pw.a * kx + lsFu) * s) / 2;
      const x = left + (Math.abs(dx) < fs * 0.25 ? dx : 0);
      const y = (box.top - er.top) / sy - bt + baseOff;
      x0 = Math.min(x0, x + pw.b[0] * s * kx); x1 = Math.max(x1, x + pw.b[2] * s * kx);
      y0 = Math.min(y0, y + pw.b[1] * s); y1 = Math.max(y1, y + pw.b[3] * s);
      return { x, y, kx };
    });
    const pad = fs * 0.12;
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    const W = x1 - x0, H = y1 - y0;
    const key = `${fs}|${W}|${H}|${x0}|${y0}|` + pos.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1) + ',' + p.kx.toFixed(4)).join(';');
    this.lay = { fs, s, pos, x0, y0, W, H };
    if (key === this.lastBuildKey) return true;
    this.lastBuildKey = key;
    const st = this.svg.style;
    st.left = x0 + 'px'; st.top = y0 + 'px'; st.width = W + 'px'; st.height = H + 'px';
    this.svg.setAttribute('width', W); this.svg.setAttribute('height', H);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.top.setAttribute('transform', `translate(${-x0} ${-y0})`);
    this.words.forEach((w, i) => w.g.setAttribute('transform', `translate(${pos[i].x.toFixed(2)} ${pos[i].y.toFixed(2)}) scale(${(s * pos[i].kx).toFixed(5)} ${s.toFixed(5)})`));
    if (this.halo) {
      const m = fs * 0.45;
      Object.assign(this.halo.style, { left: (x0 - m) + 'px', top: (y0 - m * 0.6) + 'px', width: (W + 2 * m) + 'px', height: (H + 1.2 * m) + 'px' });
    }
    if (this.brillo) this.maskBrillo();
    if (this.fx) this.fxResize();
    return true;
  }

  /* ---------------------------------------------------------------- estado de la escritura */
  // Revela todo lo escrito hasta el tiempo natural tn (s del horneado). force: reescribe todo el DOM.
  setTime(tn, force = false) {
    this.tn = tn;
    for (const w of this.words) w.any = false, w.done = true;
    for (const s of this.strokes) {
      let l, st;
      if (tn >= s.t1) { l = s.L; st = 2; } else if (tn <= s.t0) { l = 0; st = 0; } else { l = this.arcAt(s, tn); st = 1; }
      const w = this.words[s.wi];
      if (st > 0) w.any = true;
      if (st < 2) w.done = false;
      if (!force && st === s.st && st !== 1) continue;
      s.st = st;
      for (const c of s.chunks) {
        const r = clamp(l - c.s0, 0, c.L);
        const v = r <= 0.01 ? 0 : r >= c.L - 0.01 ? c.L : r;
        if (!force && Math.abs(v - c.v) < 0.05) continue;
        if (v === 0) {
          if (c.v !== 0 || force) c.el.setAttribute('display', 'none');
        } else {
          if (c.v <= 0 || force) c.el.removeAttribute('display');
          c.el.setAttribute('stroke-dashoffset', (c.L - v).toFixed(2));
        }
        c.v = v;
      }
    }
    for (const w of this.words) {
      const st = !w.any ? 0 : w.done ? 2 : 1;
      if (st === w.st && !force) continue;
      w.st = st;
      if (st === 0) w.body.setAttribute('display', 'none');
      else {
        w.body.removeAttribute('display');
        if (st === 2) w.body.removeAttribute('mask');
        else w.body.setAttribute('mask', `url(#${w.mask.id})`);
      }
    }
  }

  arcAt(s, tn) {
    const T = s.T, n = T.length;
    if (tn <= T[0]) return 0;
    if (tn >= T[n - 1]) return s.L;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tn) lo = mid; else hi = mid; }
    const f = (tn - T[lo]) / Math.max(1e-6, T[hi] - T[lo]);
    return lerp(s.cum[lo], s.cum[hi], f);
  }

  // punto de la polilínea (unidades de fuente) a la longitud l
  pointAt(s, l) {
    const c = s.cum, n = c.length, P = s.P;
    if (l <= 0) return [P[0], P[1], 0];
    if (l >= s.L) return [P[2 * n - 2], P[2 * n - 1], n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= l) lo = mid; else hi = mid; }
    const f = (l - c[lo]) / Math.max(1e-6, c[hi] - c[lo]);
    return [lerp(P[2 * lo], P[2 * hi], f), lerp(P[2 * lo + 1], P[2 * hi + 1], f), lo];
  }

  toPx(wi, x, y) {
    const p = this.lay.pos[wi], s = this.lay.s;
    return [p.x + x * s * p.kx, p.y + y * s];
  }

  // pluma en el tiempo tn → { x, y (px del elemento), down, w (px) } | null
  pen(tn) {
    const S = this.strokes;
    if (!S.length || tn < S[0].t0 - 0.25 || tn > S[S.length - 1].t1 + 0.35) return null;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      if (tn >= s.t0 && tn <= s.t1) {
        const [x, y, k] = this.pointAt(s, this.arcAt(s, tn));
        const c = s.chunks.find(ch => this.arcAt(s, tn) <= ch.s0 + ch.L) || s.chunks[s.chunks.length - 1];
        const [px, py] = this.toPx(s.wi, x, y);
        void k;
        return { x: px, y: py, down: true, w: c.w * this.lay.s };
      }
      const nx = S[i + 1];
      if (tn > s.t1 && (!nx || tn < nx.t0)) {
        const [ax, ay] = this.pointAt(s, s.L);
        const A = this.toPx(s.wi, ax, ay);
        if (!nx) return { x: A[0], y: A[1], down: false, w: 0, fin: (tn - s.t1) / 0.35 };
        const [bx, by] = this.pointAt(nx, 0);
        const B = this.toPx(nx.wi, bx, by);
        const f = clamp((tn - s.t1) / Math.max(0.01, nx.t0 - s.t1));
        const e = f * f * (3 - 2 * f);
        const lift = Math.sin(f * Math.PI) * this.lay.fs * 0.08;
        return { x: lerp(A[0], B[0], e), y: lerp(A[1], B[1], e) - lift, down: false, w: 0 };
      }
    }
    const [x, y] = this.pointAt(S[0], 0);
    const P = this.toPx(S[0].wi, x, y);
    return { x: P[0], y: P[1], down: false, w: 0, pre: (S[0].t0 - tn) / 0.25 };
  }

  /* ---------------------------------------------------------------- reproducción */
  start(desde = 0) {
    if (this.estado === 'error') return;
    if (!this.lay) this.layout();
    if (!this.lay) { this.finish(); return; }      // sin caja medible: queda escrito (sin animación)
    neutralizarRevelados(this.el);
    this.halo?.classList.add('is-on');
    this.estado = 'escribiendo';
    this.el.dataset.escrituraEstado = 'escribiendo';
    this.el.dispatchEvent(new CustomEvent('escritura:inicio', { bubbles: true, detail: { id: this.id } }));
    if (reduced()) {
      this.svg.classList.add('esc-fundido');
      this.setTime(this.durN + 1);
      requestAnimationFrame(() => requestAnimationFrame(() => this.svg.classList.add('esc-fundido-in')));
      setTimeout(() => this.finish(), 900);
      return;
    }
    this.svg.classList.remove('esc-fundido', 'esc-fundido-in');
    this.tn = clamp(desde) * this.durN;
    this.setTime(this.tn, true);
    this.fxOpen();
    despertar();
  }

  finish() {
    if (this.estado === 'escrito') return;
    this.setTime(this.durN + 1);
    this.halo?.classList.add('is-on');
    this.estado = 'escrito';
    this.el.dataset.escrituraEstado = 'escrito';
    this.el.dispatchEvent(new CustomEvent('escritura:fin', { bubbles: true, detail: { id: this.id } }));
    const ws = this.waiters.splice(0);
    ws.forEach(f => f());
    if (!reduced()) {
      this.ensureBrillo();
      setTimeout(() => this.shine(), 120);
    }
    planificar();
  }

  cancelarCola() {
    cola.delete(this);
    this._tok = (this._tok || 0) + 1;
    this._esperando = false;
    this._encadenada = false;
  }

  reset() {
    this.cancelarCola();
    this.fxClose(true);
    this.estado = 'armado';
    this.el.dataset.escrituraEstado = 'armado';
    this.svg.classList.remove('esc-fundido', 'esc-fundido-in');
    this.halo?.classList.remove('is-on');
    this.setTime(0, true);
    this.fired = false;
    if (this.visible) this.fired = true, solicitar(this);
  }

  // un cuadro: avanza la escritura y los efectos. Devuelve true si necesita más cuadros.
  frame(now, dt) {
    let need = false;
    if (this.estado === 'escribiendo' && !reduced()) {
      const prev = this.tn;
      this.tn = Math.min(this.durN + 0.4, this.tn + dt * (this.durN / this.dur));
      this.setTime(this.tn);
      this.fxStep(prev, this.tn, now, dt);
      if (this.tn >= this.durN + 0.38) this.finish();
      need = true;
    } else if (this.modo === 'scroll' && this.visible && this.estado !== 'error' && this.lay) {
      const p = this.scrollProgress();
      const tn = p * this.durN;
      if (Math.abs(tn - this.tn) > 1e-4) {
        const prev = this.tn;
        this.setTime(tn);
        if (tn > prev && !reduced()) { this.fxOpen(); this.fxStep(prev, tn, now, dt); }
        if (p >= 1 && this.estado !== 'escrito') this.finish();
        else if (p < 1 && this.estado === 'escrito') { this.estado = 'armado'; this.el.dataset.escrituraEstado = 'armado'; }
      } else if (this.fx) this.fxStep(tn, tn, now, dt);
      need = true;
    } else if (this.fx) {
      need = this.fxStep(this.tn, this.tn, now, dt);
      if (!need) this.fxClose();
    }
    return need;
  }

  scrollProgress() {
    const [a, b] = (this.el.dataset.escrituraScroll || '0.92 0.42').split(/[\s,]+/).map(Number);
    const r = this.el.getBoundingClientRect();
    const vh = innerHeight || 1;
    return clamp((vh * a - r.top) / Math.max(1, vh * (a - b)));
  }

  /* ---------------------------------------------------------------- efectos (lienzo 2D efímero) */
  fxOpen() {
    if (this.fx || reduced() || api.opciones.efectos === false) return;
    const cv = document.createElement('canvas');
    cv.className = 'esc-capa esc-fx';
    cv.setAttribute('aria-hidden', 'true');
    this.el.appendChild(cv);
    this.fx = { cv, ctx: cv.getContext('2d'), trails: [], sparks: [], dpr: 1, ox: 0, oy: 0, star: Math.random() * 6, alive: 0, glow: 0 };
    this.fxResize();
  }

  fxResize() {
    const f = this.fx, L = this.lay;
    if (!f || !L) return;
    const m = Math.round(L.fs * 0.35);
    f.ox = L.x0 - m; f.oy = L.y0 - m;
    const W = L.W + 2 * m, H = L.H + 2 * m;
    f.dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (W * H > 1.2e6 ? 0.75 : 1);
    f.cv.width = Math.max(1, Math.round(W * f.dpr));
    f.cv.height = Math.max(1, Math.round(H * f.dpr));
    Object.assign(f.cv.style, { left: f.ox + 'px', top: f.oy + 'px', width: W + 'px', height: H + 'px' });
  }

  fxClose(now = false) {
    const f = this.fx;
    if (!f) return;
    this.fx = null;
    if (now) { f.cv.remove(); return; }
    f.cv.remove();
  }

  // avanza efectos entre tA→tB (tiempo natural); devuelve true mientras quede algo vivo
  fxStep(tA, tB, now, dt) {
    const f = this.fx, L = this.lay;
    if (!f || !L) return false;
    const ctx = f.ctx, d = f.dpr, s = L.s, fs = L.fs;
    // tinta fresca: lo revelado en este cuadro
    if (tB > tA) {
      for (const st of this.strokes) {
        if (st.t1 < tA || st.t0 > tB) continue;
        const l0 = this.arcAt(st, tA), l1 = this.arcAt(st, tB);
        if (l1 - l0 < 0.5) continue;
        const pts = [];
        const [ax, ay, ka] = this.pointAt(st, l0);
        const [bx, by, kb] = this.pointAt(st, l1);
        pts.push(this.toPx(st.wi, ax, ay));
        for (let k = ka + 1; k <= kb; k++) pts.push(this.toPx(st.wi, st.P[2 * k], st.P[2 * k + 1]));
        pts.push(this.toPx(st.wi, bx, by));
        const ch = st.chunks.find(c => l1 <= c.s0 + c.L) || st.chunks[st.chunks.length - 1];
        const p2 = new Path2D();
        p2.moveTo((pts[0][0] - f.ox) * d, (pts[0][1] - f.oy) * d);
        for (let i = 1; i < pts.length; i++) p2.lineTo((pts[i][0] - f.ox) * d, (pts[i][1] - f.oy) * d);
        // ancho de la estela: el del trazo, acotado (la máscara se ensancha en remates y cruces)
        f.trails.push({ p: p2, w: Math.max(1.5, Math.min(ch.w * s, fs * 0.085) * d), born: now });
      }
    }
    const pen = this.pen(tB);
    // chispas desde la punta mientras escribe
    if (pen && pen.down && tB > tA) {
      const rate = 150 * Math.min(2, (tB - tA) / Math.max(dt, 1e-3) / Math.max(0.2, this.durN / this.dur));
      f.acc = (f.acc || 0) + rate * dt;
      while (f.acc > 1 && f.sparks.length < 140) {
        f.acc -= 1;
        const a = Math.random() * Math.PI * 2, v = fs * (0.25 + Math.random() * 1.1);
        f.sparks.push({ x: pen.x, y: pen.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - fs * 0.5, life: 0, max: 0.35 + Math.random() * 0.55, r: 0.5 + Math.random() * 1.3 });
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, f.cv.width, f.cv.height);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // 1) brillo de tinta fresca que se asienta
    const LIFE = 0.75;
    f.trails = f.trails.filter(tr => now - tr.born < LIFE);
    for (const tr of f.trails) {
      const a = 1 - (now - tr.born) / LIFE;
      const k = a * a;
      ctx.lineWidth = tr.w;
      ctx.strokeStyle = `rgba(255,214,140,${(0.1 * k).toFixed(3)})`;
      ctx.stroke(tr.p);
      ctx.lineWidth = tr.w * 0.55;
      ctx.strokeStyle = `rgba(255,232,178,${(0.22 * k).toFixed(3)})`;
      ctx.stroke(tr.p);
      ctx.lineWidth = Math.max(1, tr.w * 0.2);
      ctx.strokeStyle = `rgba(255,252,236,${(0.5 * k * k).toFixed(3)})`;
      ctx.stroke(tr.p);
    }
    // 2) chispas
    const g = fs * 2.2;
    f.sparks = f.sparks.filter(p => p.life < p.max);
    for (const p of f.sparks) {
      p.life += dt; p.vy += g * dt; p.vx *= 0.985; p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - p.life / p.max;
      ctx.fillStyle = `rgba(255,${Math.round(200 + 50 * a)},${Math.round(120 + 110 * a * a)},${(0.9 * a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc((p.x - f.ox) * d, (p.y - f.oy) * d, p.r * d * (0.6 + 0.6 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    // 3) punta de pluma luminosa
    let alive = f.trails.length + f.sparks.length;
    if (pen) {
      const quieta = !(tB > tA) && this.estado !== 'escribiendo';      // modo scroll sin avanzar: la punta reposa tenue
      let k = pen.down ? (quieta ? 0.45 : 1) : 0.42;
      if (pen.pre != null) k *= clamp(1 - pen.pre);
      if (pen.fin != null) k *= clamp(1 - pen.fin);
      f.glow = lerp(f.glow, k, Math.min(1, dt * 14));
      const fl = 0.85 + 0.15 * Math.sin(now * 37) * Math.sin(now * 23);
      const R = fs * (0.11 + 0.05 * f.glow) * d;
      const x = (pen.x - f.ox) * d, y = (pen.y - f.oy) * d;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R * 2.6);
      const A = f.glow * fl;
      gr.addColorStop(0, `rgba(255,255,248,${(0.95 * A).toFixed(3)})`);
      gr.addColorStop(0.16, `rgba(255,240,196,${(0.75 * A).toFixed(3)})`);
      gr.addColorStop(0.42, `rgba(255,196,96,${(0.26 * A).toFixed(3)})`);
      gr.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(x, y, R * 2.6, 0, Math.PI * 2); ctx.fill();
      // destello en estrella
      f.star += dt * 1.6;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(f.star);
      for (let i = 0; i < 2; i++) {
        const len = R * (i ? 3.2 : 4.4) * (0.8 + 0.2 * fl);
        const lg = ctx.createLinearGradient(-len, 0, len, 0);
        lg.addColorStop(0, 'rgba(255,230,170,0)');
        lg.addColorStop(0.5, `rgba(255,250,232,${(0.8 * A).toFixed(3)})`);
        lg.addColorStop(1, 'rgba(255,230,170,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(-len, -Math.max(0.6, d * 0.7), 2 * len, Math.max(1.2, d * 1.4));
        ctx.rotate(Math.PI / 2);
      }
      ctx.restore();
      alive += f.glow > 0.02 ? 1 : 0;
    } else {
      f.glow = Math.max(0, f.glow - dt * 4);
    }
    ctx.globalCompositeOperation = 'source-over';
    return alive > 0 || (this.estado === 'escribiendo');
  }

  /* ---------------------------------------------------------------- brillo que recorre las letras */
  ensureBrillo() {
    if (this.brillo || !this.lay) return;
    const b = document.createElement('div');
    b.className = 'esc-capa esc-brillo';
    b.setAttribute('aria-hidden', 'true');
    b.appendChild(document.createElement('i'));
    this.el.appendChild(b);
    this.brillo = b;
    this.maskBrillo();
  }

  maskBrillo() {
    const L = this.lay, b = this.brillo;
    if (!L || !b) return;
    let s = `<svg xmlns="${SVGNS}" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}"><g transform="translate(${-L.x0} ${-L.y0})">`;
    this.data.palabras.forEach((w, i) => {
      const p = L.pos[i];
      s += `<g transform="translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) scale(${(L.s * p.kx).toFixed(5)} ${L.s.toFixed(5)})">`;
      for (const [name, gx] of w.g) s += `<path transform="translate(${gx} 0)" d="${this.data.glifos[name]}"/>`;
      s += '</g>';
    });
    s += '</g></svg>';
    const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}")`;
    Object.assign(b.style, { left: L.x0 + 'px', top: L.y0 + 'px', width: L.W + 'px', height: L.H + 'px' });
    b.style.webkitMaskImage = url;
    b.style.maskImage = url;
  }

  shine() {
    if (!this.brillo || reduced() || !this.visible) return;
    this.shineAt = performance.now();
    const i = this.brillo.firstChild;
    try {
      i.animate([{ transform: 'translateX(-110%)', opacity: 1 }, { transform: 'translateX(110%)', opacity: 1 }],
        { duration: 1700, easing: 'cubic-bezier(.45,.05,.25,1)' });
    } catch { /* sin WAAPI: sin brillo */ }
  }
}

/* ====================================================================================================== */
/* Bucle único                                                                                             */
let raf = 0, last = 0, frames = 0, fpsT = 0;
const api = {};
function tick(t) {
  raf = 0;
  const dt = Math.min(0.05, Math.max(0.001, (t - last) / 1000));
  last = t;
  let any = false;
  for (const p of piezas.values()) if (p.estado !== 'error' && p.estado !== 'cargando') any = p.frame(t / 1000, dt) || any;
  frames++;
  if (t - fpsT > 1000) { api.fps = Math.round(frames * 1000 / (t - fpsT)); frames = 0; fpsT = t; }
  if (any) raf = requestAnimationFrame(tick);
}
function despertar() {
  if (!raf) { last = performance.now(); if (!fpsT) fpsT = last; raf = requestAnimationFrame(tick); }
}

/* ====================================================================================================== */
/* Disparo por vista y cola por sección                                                                     */
let io = null;
const ioDentro = new WeakMap();
function observar(p) {
  if (!io) {
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const pz = piezas.get(e.target);
        if (!pz) continue;
        pz.visible = e.isIntersecting;
        ioDentro.set(e.target, e.intersectionRatio);
        if (pz.modo === 'scroll') { if (e.isIntersecting) despertar(); continue; }
        if (pz.modo === 'vista' && !pz.fired && e.isIntersecting && (e.intersectionRatio >= 0.35 || e.intersectionRect.height >= innerHeight * 0.3)) {
          pz.fired = true;
          solicitar(pz);
        }
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: [0, 0.35, 0.6, 1] });
  }
  io.observe(p.el);
  if (!roRef) roRef = new ResizeObserver(es => { for (const e of es) piezas.get(e.target)?.relayoutPronto(); });
  roRef.observe(p.el);
}
let roRef = null;
Pieza.prototype.relayoutPronto = function () {
  if (this._rl || !this.svg || !this.data) return;          // aún cargando: init() medirá al terminar
  this._rl = requestAnimationFrame(() => { this._rl = 0; if (this.estado !== 'error' && this.svg) this.layout(); });
};

const cola = new Set();
function grupoDe(el) { return el.closest('[data-escritura-grupo], section, article, header, footer, main') || document.body; }
function solicitar(p) {
  if (p.estado === 'escribiendo' || p.estado === 'escrito' || p.estado === 'error') return;
  p.estado = 'pendiente';
  p.el.dataset.escrituraEstado = 'pendiente';
  cola.add(p);
  planificar();
}
function bloqueada(p) {
  if (reduced()) return false;               // con movimiento reducido todo aparece a la vez (fundido)
  const tras = p.el.dataset.escrituraTras;
  for (const q of piezas.values()) {
    if (q === p || q.estado === 'error') continue;
    if (tras) {
      if (q.id === tras && (q.estado === 'escribiendo' || q.estado === 'pendiente' || (q.estado === 'armado' && q.visible && q.modo === 'vista'))) return true;
      continue;
    }
    if (grupoDe(q.el) !== grupoDe(p.el)) continue;
    const antes = q.el.compareDocumentPosition(p.el) & Node.DOCUMENT_POSITION_FOLLOWING;
    if (antes && (q.estado === 'escribiendo' || q.estado === 'pendiente')) return true;
  }
  return false;
}
function planificar() {
  for (const p of [...cola]) {
    if (p.estado !== 'pendiente' || p._esperando) continue;
    if (bloqueada(p)) { p._encadenada = true; continue; }
    const ret = Math.max(0, parseFloat(p.el.dataset.escrituraRetraso) || 0) + (p._encadenada ? 0.1 : 0);
    p._esperando = true;
    const tok = p._tok = (p._tok || 0) + 1;
    setTimeout(() => {
      if (tok !== p._tok) return;            // se reinició o se pidió play() entretanto
      p._esperando = false;
      if (p.estado !== 'pendiente') return;
      if (bloqueada(p)) { p._encadenada = true; return; }   // otra pieza previa arrancó mientras esperaba: sigue en cola
      cola.delete(p);
      p.start(0);
    }, ret * 1000);
  }
}

/* ====================================================================================================== */
/* Música: brillo en tiempos fuertes (o cada ~9 s sin música) mientras la pieza escrita se ve               */
let beatOff = null;
function engancharMusica() {
  const m = window.__inv?.music;
  if (beatOff || !m?.onBeat) return;
  try {
    beatOff = m.onBeat((i, t, info) => {
      if (!(info?.downbeat || (info?.strength || 0) > 0.8)) return;
      const ahora = performance.now();
      for (const p of piezas.values()) if (p.estado === 'escrito' && p.visible && ahora - p.shineAt > 7000) p.shine();
    });
  } catch { beatOff = null; }
}
setInterval(() => {
  engancharMusica();
  const sonando = !!window.__inv?.music?.playing && !!beatOff;
  if (sonando || document.hidden) return;
  const ahora = performance.now();
  for (const p of piezas.values()) if (p.estado === 'escrito' && p.visible && ahora - p.shineAt > 9000) p.shine();
}, 1500);

/* ====================================================================================================== */
/* Utilidades de montaje                                                                                    */
async function fuentesListas(el, texto) {
  if (!document.fonts?.load) return;
  const cs = getComputedStyle(el);
  const f = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) || 16}px ${cs.fontFamily}`;
  await Promise.race([document.fonts.load(f, texto).catch(() => null), new Promise(r => setTimeout(r, 3000))]);
}

// Los revelados de otros módulos (shell-reveal data-reveal, kinetic data-kinetic) se pisarían con la escritura.
function neutralizarRevelados(el) {
  if (el.hasAttribute('data-reveal')) {
    el.removeAttribute('data-reveal');
    try { window.gsap?.killTweensOf?.(el); window.gsap?.set?.(el, { clearProps: 'clipPath,filter,opacity,transform' }); } catch { /* nada */ }
  }
  const k = el.getAttribute('data-kinetic');
  if (k === 'title' || k === 'letters') el.removeAttribute('data-kinetic');
  // revelado de respaldo de historia3d.js (máscara de tinta + desenfoque) para cuando NO hay escritura.js
  el.classList.remove('h3d-ink');
}

function montar(el) {
  if (!(el instanceof Element) || !el.dataset.escritura) return Promise.resolve(null);
  const ex = piezas.get(el);
  if (ex) {
    if (ex.id === el.dataset.escritura) return ex.ready;
    desmontar(el);
  }
  const p = new Pieza(el);
  piezas.set(el, p);
  p.ready = p.init();
  return p.ready;
}

function desmontar(el) {
  const p = piezas.get(el);
  if (!p) return;
  p.fxClose(true);
  p.svg?.remove();
  p.brillo?.remove();
  p.halo?.remove();
  io?.unobserve(el);
  roRef?.unobserve(el);
  p.cancelarCola();
  el.classList.remove('esc-on');
  delete el.dataset.escrituraEstado;
  piezas.delete(el);
}

function montarTodo(root = document) {
  const els = [...root.querySelectorAll('[data-escritura]')];
  if (root instanceof Element && root.matches('[data-escritura]')) els.unshift(root);
  return Promise.all(els.map(montar));
}

/* ====================================================================================================== */
/* API                                                                                                      */
Object.assign(api, {
  version: 1,
  fps: 0,
  opciones: { efectos: true },        // efectos: false → sin lienzo de pluma/chispas (pruebas de rendimiento)
  mount: el => montar(el),
  async play(el, opts = {}) {
    const p = piezas.get(el) ? await piezas.get(el).ready : await montar(el);
    if (!p) return;
    p.cancelarCola();
    p.fired = true;
    if (opts.duracion > 0) p.el.dataset.escrituraDuracion = String(opts.duracion);
    const fin = new Promise(r => p.waiters.push(r));
    p.estado = 'armado';
    p.start(opts.desde || 0);
    return fin;
  },
  reset(el) { const p = piezas.get(el); if (p && p.estado !== 'error' && p.estado !== 'cargando') p.reset(); },
  seek(el, v) {
    const p = piezas.get(el);
    if (!p || !p.lay) return;
    p.fxClose(true);
    p.fired = true;
    p.cancelarCola();
    p.estado = clamp(v) >= 1 ? 'escrito' : 'armado';
    p.el.dataset.escrituraEstado = p.estado;
    p.setTime(clamp(v) * p.durN, true);
    p.halo?.classList.toggle('is-on', clamp(v) > 0);
    if (clamp(v) >= 1) p.ensureBrillo();
  },
  complete(el) { const p = piezas.get(el); if (p && p.lay) { p.fxClose(true); p.fired = true; p.cancelarCola(); p.finish(); } },
  list: () => [...piezas.values()].map(p => ({ id: p.id, estado: p.estado, avance: p.durN ? +(p.tn / p.durN).toFixed(3) : 0, duracion: p.data ? p.dur : null })),
  get ready() { return montarTodo().then(() => undefined); },
  _piezas: piezas,
});

// window.__inv puede crearlo main.js después de este módulo: se engancha en cuanto exista.
function engancharInv() {
  const inv = window.__inv;
  if (inv && typeof inv === 'object' && inv.escritura !== api) inv.escritura = api;
}
window.__escritura = api;
engancharInv();
if (!window.__inv) {
  try {
    let v;
    Object.defineProperty(window, '__inv', {
      configurable: true, enumerable: true,
      get: () => v,
      set: nv => { v = nv; if (nv && typeof nv === 'object' && !nv.escritura) nv.escritura = api; },
    });
  } catch { /* sin defineProperty: queda window.__escritura */ }
}

function arrancar() {
  // FIX (carga de la puerta en móvil medio): antes se montaban las 6 piezas al arrancar (163 KB de JSON, ~1 200 nodos SVG con
  // 126 clipPath y un layout forzado por pieza: ~3 s de hilo con CPU ×4 mientras cargaba la puerta, el hilo dorado se trababa).
  // Ahora cada pieza se monta al acercarse (1.5 pantallas antes) o, si no, en ratos ociosos cuando la invitación ya cargó lo
  // pesado (__inv.whenReady). Hasta entonces queda el respaldo dorado de css/escritura.css.
  const cerca = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { cerca.unobserve(e.target); montar(e.target); } }, { rootMargin: '150% 0px' })
    : null;
  const vigilar = (root = document) => {
    const els = [...root.querySelectorAll('[data-escritura]')];
    if (root instanceof Element && root.matches('[data-escritura]')) els.unshift(root);
    for (const el of els) { if (piezas.has(el)) continue; if (cerca) cerca.observe(el); else montar(el); }
  };
  vigilar();
  (async () => {
    try { await Promise.race([window.__inv?.whenReady, new Promise(r => setTimeout(r, 60000))]); } catch { /* */ }
    const ocio = () => new Promise(r => (typeof requestIdleCallback === 'function' ? requestIdleCallback(r, { timeout: 2500 }) : setTimeout(r, 250)));
    for (const el of [...document.querySelectorAll('[data-escritura]')]) {
      if (piezas.has(el)) continue;
      await ocio();
      if (!piezas.has(el)) { cerca?.unobserve(el); await montar(el)?.catch?.(() => null); }
    }
  })();
  const mo = new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'attributes') { if (m.target.dataset?.escritura) montar(m.target); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || n.classList?.contains('esc-capa') || n.classList?.contains('esc-sonda')) continue;
        if (n.matches?.('[data-escritura]') || n.querySelector?.('[data-escritura]')) vigilar(n);
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-escritura'] });
  addEventListener('resize', () => { for (const p of piezas.values()) p.relayoutPronto(); }, { passive: true });
  addEventListener('scroll', () => { for (const p of piezas.values()) if (p.modo === 'scroll' && p.visible) { despertar(); break; } }, { passive: true });
  document.fonts?.addEventListener?.('loadingdone', () => { for (const p of piezas.values()) p.relayoutPronto(); });
  MQ.addEventListener?.('change', () => { for (const p of piezas.values()) if (reduced() && p.estado === 'escribiendo') p.finish(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar, { once: true });
else arrancar();

export default api;
export { api as escritura, montar as mount };
