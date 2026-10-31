// js/ribbon.js — WEB-RIBBON · Lazo de satén vino atado al pergamino cerrado + desatado con física de tela.
//
// Coordenadas LOCALES del pergamino (SPEC "Geometría compartida"): hoja en z = 0, cara de texto +Z, rollos ∥ X.
// Cerrado: dos rollos de radio R con centros (0, y±, zC) (por defecto R = 0.0135, (0, ±0.0135, 0.0135); pasar
// opts.closed = CLOSED de parchment.js). Cima del "estadio": zTop = zC + R.
//
// La cinta es UNA sola tira continua (material σ ∈ [0, L], L ≈ 0.53 m):
//   cola A (corte en V, σ = 0) → oreja A → banda alrededor del estadio → envoltura del nudo → oreja B → cola B (σ = L).
// Atada: trayectoria Catmull-Rom centrípeta con marcos de torsión controlados (normal explícita por punto), ancho
// fruncido, copa transversal, pliegues y colas tendidas sobre el rollo delantero (−Y) hasta la mesa en "V invertida".
// Desatado (untie): una mano invisible pellizca la cola A, tira hacia arriba/afuera (la oreja A se encoge y pasa por el
// nudo: el material se desliza por la trayectoria), el nudo se abre, la banda se afloja, el lado B resbala por encima
// del pergamino hacia atrás y la mano deposita la cola A sobre la mesa. La pose cinemática se mezcla de forma continua
// (posiciones + velocidades) con una simulación verlet/PBD de 121 estaciones × 3 partículas (bordes + centro: torsión y
// curvatura transversal): estiramiento, cizalla, flexión, arrastre aerodinámico, colisión con los rollos/varillas/hoja,
// con la mesa, autocolisión entre capas, fricción estática/dinámica y asentamiento.
//
// API (contrato del SPEC):
//   const rb = createRibbon({ THREE, color?, sheenColor?, closed?, width?, renderer? });
//   rb.group                       → THREE.Group en coords locales del pergamino (añádelo al grupo del pergamino)
//   rb.knot.position / .normal     → centro de la cara trasera del sello: (0, yK, zTop + 0.0036), normal +Z
//   rb.untie({ duration = 2.2 })   → Promise: resuelve cuando la cinta ya soltó el pergamino (≈ duration … duration+1.4 s);
//                                    la física sigue asentándose en update() y luego duerme (rb.state === 'settled')
//   rb.reset()                     → vuelve a atado (resuelve una promesa pendiente)
//   rb.update(dt, time, env?)      → llamar cada cuadro. env: { gravityLocal?: Vector3 (m/s², def. (0,0,−9.81)),
//                                    groundPlaneLocal?: Plane (def. ⟂ gravedad, tangente al estadio), collideRolls?: bool }
//   rb.dispose()
//   PERF: opts.idle (función → Promise, opcionalmente con IdleDeadline) trocea el cálculo de las texturas de raso;
//   rb.ready (Promise) resuelve cuando están completas (sin idle, ya resuelta).
// Extras: rb.detach(parent) (re-cuelga la cinta de la mesa al levantar el pergamino), rb.wake(), rb.state
// ('tied'|'untying'|'falling'|'settled'), rb.progress, rb.settled, rb.mesh, rb.material, rb.length, rb.fps.
// Opciones extra: anisotropy, anisotropyRotation, roughness, sheen, sheenRoughness, pullDirection [x,y,z], handReach,
// gravityScale (0.55: caída "de cine"), bendStiffness, springLift, parchmentWidth, rodRadius.

const DEF_CLOSED = { R: 0.0135, topCenter: [0, 0.0135, 0.0135], bottomCenter: [0, -0.0135, 0.0135] };

const hypot = (a, b, c = 0) => Math.sqrt(a * a + b * b + c * c); // más rápido que Math.hypot
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ---------------------------------------------------------------------------------------------------------------------
// Pequeñas utilidades vectoriales sobre arrays [x,y,z]
const v3 = (x = 0, y = 0, z = 0) => [x, y, z];
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = a => hypot(a[0], a[1], a[2]);
const vnorm = a => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// rota v alrededor del eje unitario k un ángulo th (Rodrigues)
const vrot = (v, k, th) => {
  const c = Math.cos(th), s = Math.sin(th), d = vdot(k, v), x = vcross(k, v);
  return [v[0] * c + x[0] * s + k[0] * d * (1 - c), v[1] * c + x[1] * s + k[1] * d * (1 - c), v[2] * c + x[2] * s + k[2] * d * (1 - c)];
};

// ---------------------------------------------------------------------------------------------------------------------
// Texturas de satén generadas en canvas: normal map del tejido (urdimbre flotante de raso 8 + orillo) y detalle de color.
// PERF: el cálculo (≈158 ms seguidos en escritorio, ~600 ms con CPU ×4) se trocea por filas: con opts.idle (función que
// resuelve en un rato ocioso, opcionalmente con su IdleDeadline) avanza en tramos de pocos ms y el resultado llega por la
// promesa `ready`; sin idle se hace de una vez como antes. Los lienzos y las CanvasTexture existen desde el principio, así
// el material (y su programa) no cambian cuando las texturas se completan.
function makeSatinTextures(THREE, renderer, idle) {
  const NX = 1024, NY = 512; // x = a lo largo de la cinta (repite), y = a lo ancho (0..1, sin repetir)
  const nc = document.createElement('canvas'); nc.width = NX; nc.height = NY;
  const ac = document.createElement('canvas'); ac.width = NX; ac.height = NY;
  const normalMap = new THREE.CanvasTexture(nc);
  const detailMap = new THREE.CanvasTexture(ac);
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;
  for (const t of [normalMap, detailMap]) {
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.flipY = false; t.anisotropy = Math.min(16, maxAniso); t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  }
  detailMap.colorSpace = THREE.SRGBColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  const work = satinWork(NX, NY, nc, ac, () => { normalMap.needsUpdate = true; detailMap.needsUpdate = true; });
  let ready;
  if (typeof idle !== 'function') { for (let r = work.next(); !r.done; r = work.next()); ready = Promise.resolve(); }
  else {
    // plazo de cada tramo: lo que el IdleDeadline deja (menos 2 ms de margen) o 5 ms si no hay plazo (didTimeout / null)
    // (máx. 10 ms por tramo aunque el plazo ocioso sea mayor: un frame de animación puede llegar antes de lo estimado)
    const until = dl => performance.now() + (dl && typeof dl.timeRemaining === 'function' ? Math.min(10, Math.max(4, dl.timeRemaining() - 2)) : 5);
    ready = (async () => {
      let end = until(await idle());
      for (let r = work.next(); !r.done; r = work.next()) if (performance.now() > end) end = until(await idle());
    })();
  }
  return { normalMap, detailMap, ready };
}
function* satinWork(NX, NY, nc, ac, done) {
  const H = new Float32Array(NX * NY);
  const ALB = new Float32Array(NX * NY);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const threads = 118;              // hilos de urdimbre visibles a lo ancho
  const picks = 256;                // pasadas de trama por baldosa (periódico en x)
  const harness = 8, move = 3;      // raso de 8 con avance 3
  // ruido periódico por hilo (suma de senos con frecuencias enteras → baldosa sin costura)
  const tw = [];
  for (let t = 0; t < threads + 2; t++) {
    const f = [];
    for (let k = 0; k < 4; k++) f.push([1 + Math.floor(rnd() * 9), rnd() * Math.PI * 2, (0.5 + rnd()) / (k + 1)]);
    tw.push({ f, off: Math.floor(rnd() * harness), tone: (rnd() - 0.5), thick: 0.85 + rnd() * 0.3 });
  }
  const selv = 0.045; // ancho del orillo (fracción del ancho)
  for (let y = 0; y < NY; y++) {
    const v = (y + 0.5) / NY;
    const inner = (v - selv) / (1 - 2 * selv);
    const isSelv = v < selv || v > 1 - selv;
    const tf = isSelv ? (v < selv ? v / selv * 7 : (v - (1 - selv)) / selv * 7) : inner * threads;
    const ti = Math.floor(tf), tl = tf - ti;
    const T = tw[(ti % (threads + 2) + threads + 2) % (threads + 2)];
    const across = Math.pow(Math.sin(Math.PI * tl), 0.55);
    for (let x = 0; x < NX; x++) {
      const u = x / NX;
      const pf = u * picks, pi = Math.floor(pf), pl = pf - pi;
      let slub = 0;
      for (const [fr, ph, am] of T.f) slub += Math.sin(u * Math.PI * 2 * fr + ph) * am;
      slub *= 0.08;
      let h;
      if (!isSelv) {
        // la urdimbre baja bajo la trama una vez cada 8 pasadas (con avance de raso)
        const under = ((pi + T.off + ti * move) % harness) === 0;
        const dip = under ? Math.sin(Math.PI * pl) : 0;
        h = across * T.thick * (1 + slub) * (1 - 0.22 * dip);
      } else {
        // orillo en tafetán (más granulado) + cordón del borde
        const alt = ((pi + ti) & 1) === 0;
        h = across * (alt ? 1 : 0.55) * (1 + slub * 0.5);
        if (v < 0.012 || v > 0.988) h += 0.35;
      }
      H[y * NX + x] = h;
      ALB[y * NX + x] = (isSelv ? 0.86 : 0.965) + T.tone * 0.05 + slub * 0.35 + (h - 0.6) * 0.035;
    }
    if ((y & 3) === 3) yield;
  }
  const nctx = nc.getContext('2d'), actx = ac.getContext('2d');
  const nimg = nctx.createImageData(NX, NY), aimg = actx.createImageData(NX, NY);
  const strength = 1.6;
  for (let y = 0; y < NY; y++) {
    if ((y & 7) === 7) yield;
    const y0 = Math.max(0, y - 1), y1 = Math.min(NY - 1, y + 1);
    for (let x = 0; x < NX; x++) {
      const x0 = (x - 1 + NX) % NX, x1 = (x + 1) % NX;
      const dx = (H[y * NX + x1] - H[y * NX + x0]) * 0.5 * strength;
      const dy = (H[y1 * NX + x] - H[y0 * NX + x]) * 0.5 * strength; // píxeles cuadrados (0.043 mm)
      const l = hypot(dx, dy, 1);
      const i = (y * NX + x) * 4;
      nimg.data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      nimg.data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255); // +V de la textura = +B (ancho) ; flipY=false
      nimg.data[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      nimg.data[i + 3] = 255;
      const a = clamp(ALB[y * NX + x], 0, 1);
      aimg.data[i] = Math.round(a * 255); aimg.data[i + 1] = Math.round(a * 252); aimg.data[i + 2] = Math.round(a * 252); aimg.data[i + 3] = 255;
    }
  }
  yield;
  nctx.putImageData(nimg, 0, 0);
  yield;
  actx.putImageData(aimg, 0, 0);
  done();
}

// ---------------------------------------------------------------------------------------------------------------------
export function createRibbon(opts = {}) {
  const THREE = opts.THREE;
  if (!THREE) throw new Error('createRibbon: falta opts.THREE');
  const closed = opts.closed || DEF_CLOSED;
  const W = opts.width || 0.022;
  const R = closed.R;
  const yT = closed.topCenter[1], yB = closed.bottomCenter[1];
  const zC = (closed.topCenter[2] + closed.bottomCenter[2]) * 0.5;
  const yK = (yT + yB) * 0.5;
  const zTop = zC + R, zBot = zC - R;
  const TH = 0.00034;               // grosor de la cinta (doble cara)
  const E = 0.0002;                 // separación línea media ↔ superficie del rollo
  const zG = zBot - E - TH * 0.5;   // mesa supuesta en la pose atada (la banda pasa por debajo del rollo)
  const sheetHalf = (opts.parchmentWidth || 0.30) / 2;
  const ROD_R = opts.rodRadius || 0.011, ROLL_HALF = sheetHalf, ROD_HALF = sheetHalf + 0.015 + 0.024;
  const K = [0, yK, zTop];          // punto del nudo (encima del estadio, al frente)
  const HALF_GAP = (yT - yB) * 0.5; // mitad de la separación entre ejes de los rollos
  const GROOVE_FLOOR = zC + 0.45 * R; // fondo de la ranura superior entre rollos (la cinta no pasa entre ellos)
  const kp = (x, y, z) => [x, yK + y, zTop + z]; // coordenadas relativas al nudo

  // ============================== perfil de caída de las colas (hacia −Y: sobre el rollo inferior y a la mesa)
  const RHO = 0.0042;
  const pS0 = yK - yB;
  const pS1 = pS0 + Math.PI * R / 2;
  const pS2 = pS1 + (zC - (zG + RHO));
  const pS3 = pS2 + Math.PI * RHO / 2;
  const prof = [0, 0, 0, 0, 0];
  function profile(s) { // → [y, z, ny, nz, curvatura(+convexa)]
    const o = prof;
    if (s < pS0) { o[0] = yK - s; o[1] = zTop; o[2] = 0; o[3] = 1; o[4] = 0; }
    else if (s < pS1) { const f = (s - pS0) / R; o[0] = yB - R * Math.sin(f); o[1] = zC + R * Math.cos(f); o[2] = -Math.sin(f); o[3] = Math.cos(f); o[4] = 1 / R; }
    else if (s < pS2) { o[0] = yB - R; o[1] = zC - (s - pS1); o[2] = -1; o[3] = 0; o[4] = 0; }
    else if (s < pS3) { const f = (s - pS2) / RHO, cy = yB - R - RHO, cz = zG + RHO; o[0] = cy + RHO * Math.cos(f); o[1] = cz - RHO * Math.sin(f); o[2] = -Math.cos(f); o[3] = Math.sin(f); o[4] = -1 / RHO; }
    else { o[0] = yB - R - RHO - (s - pS3); o[1] = zG; o[2] = 0; o[3] = 1; o[4] = 0; }
    return o;
  }

  // ============================== definición del moño (valores en metros, relativos al nudo)
  const TAIL_A = { side: -1, x0: -0.0045, s0: 0.0035, th: 0.62, len: 0.080, bow: 0.0034, n: 22 };
  const TAIL_B = { side: +1, x0: +0.0045, s0: 0.0035, th: 0.46, len: 0.071, bow: -0.0022, n: 20 };
  // orejas: [a (hacia fuera), h (altura en el plano del lazo), w (fruncido)] ; origen a la altura del haz del nudo
  const LOOP_A = { o: [-0.0044, 0.0003, 0.0030], side: -1, yaw: 0.13, tilt: -0.22, tw0: 0.42, tw1: -0.34, bend: 0.0042, tipTw: 0.26, pts: [
    [0.0000, 0.0004, 0.16], [0.0040, 0.0005, 0.38], [0.0085, 0.0003, 0.62], [0.0130, 0.0002, 0.84],
    [0.0180, 0.0028, 0.96], [0.0240, 0.0072, 1.00], [0.0300, 0.0101, 1.00], [0.0356, 0.0110, 1.00],
    [0.0405, 0.0094, 1.00], [0.0440, 0.0062, 0.98], [0.0451, 0.0025, 0.97], [0.0426, -0.0006, 0.98],
    [0.0366, -0.0021, 1.00], [0.0290, -0.0026, 1.00], [0.0215, -0.0027, 1.00], [0.0145, -0.0022, 0.92],
    [0.0085, -0.0018, 0.72], [0.0038, -0.0017, 0.46], [0.0006, -0.0012, 0.20]] };
  const LOOP_B = { o: [0.0044, -0.0003, 0.0030], side: +1, yaw: 0.07, tilt: -0.12, tw0: -0.36, tw1: 0.3, bend: -0.0034, tipTw: -0.2, pts: [
    [0.0000, 0.0004, 0.16], [0.0040, 0.0005, 0.40], [0.0085, 0.0003, 0.64], [0.0130, 0.0002, 0.86],
    [0.0178, 0.0030, 0.96], [0.0232, 0.0076, 1.00], [0.0285, 0.0105, 1.00], [0.0335, 0.0113, 1.00],
    [0.0380, 0.0099, 1.00], [0.0412, 0.0067, 0.98], [0.0423, 0.0029, 0.97], [0.0401, -0.0004, 0.98],
    [0.0345, -0.0020, 1.00], [0.0275, -0.0026, 1.00], [0.0205, -0.0027, 1.00], [0.0140, -0.0022, 0.92],
    [0.0082, -0.0018, 0.72], [0.0036, -0.0017, 0.46], [0.0005, -0.0012, 0.20]] };
  // envoltura (nudo central): elipse en el plano YZ alrededor del haz; su base queda 1 mm sobre la banda para que
  // las colas salgan por debajo de su borde delantero.
  const WRAP = { c: 0.0034, ry: 0.0052, rz: 0.0024, w: 0.82 };
  const SEAL_LIFT = 0.0036; // cara trasera del sello sobre la cima del estadio (el nudo queda dentro del lacre)

  // punto de la cola en la pose drapeada
  function tailDraped(d, f) {
    const ell = f * d.len;
    const s = d.s0 + ell * Math.cos(d.th);
    const x = d.x0 + d.side * (ell * Math.sin(d.th) + d.bow * Math.sin(Math.PI * f));
    const o = profile(s);
    const w0 = lerp(d.w0 ?? 0.42, 1, smooth(0, 0.24, f));
    let h = E + 0.0001 * (1 - smooth(0, 0.16, f));
    const inner = Math.abs(x) - (W * w0 / 2) * Math.cos(d.th);   // borde interior de la cola respecto a la banda
    if (s < pS1 + 0.004) h += 0.00048 * (1 - smooth(W / 2 + 0.0003, W / 2 + 0.0035, inner));
    h += 0.0017 * Math.pow(smooth(0.84, 1, f), 1.6);     // la punta del satén se curva un poco
    const k = Math.max(0, o[4]), st = Math.sin(d.th);
    const w = w0;
    const half = W * w / 2;
    return { p: [x, o[0] + h * o[2], o[1] + h * o[3]], n: [0, o[2], o[3]], w, cup: -k * st * st * half * half * 0.5, pleat: (1 - w) * 0.0009, x, s: -s, h };
  }
  // perfil con signo: s < 0 → hacia delante (rollo inferior, −Y) ; s > 0 → hacia atrás (rollo superior, +Y)
  function profileSigned(ss) {
    const o = profile(Math.abs(ss));
    if (ss >= 0) { o[0] = 2 * yK - o[0]; o[2] = -o[2]; }
    return o;
  }
  function onProfile(x, ss, h) {
    const o = profileSigned(ss);
    return { p: [x, o[0] + h * o[2], o[1] + h * o[3]], n: [0, o[2], o[3]], k: Math.max(0, o[4]) };
  }

  // marco local de una oreja
  function loopFrame(L, tiltExtra = 0) {
    const a = vnorm([L.side * Math.cos(L.yaw), Math.sin(L.yaw), 0]);
    const Y = [0, 1, 0];
    const lean = vnorm(vsub(Y, vscale(a, vdot(Y, a))));
    const t = L.tilt + tiltExtra;
    const h = vnorm(vadd(vscale([0, 0, 1], Math.cos(t)), vscale(lean, Math.sin(t))));
    return { a, h, w: vcross(a, h) };
  }
  // puntos de una oreja; sc: escala (1 atada → 0 desaparecida), open: 0..1 aflojada
  function loopPoints(L, sc, open, lift, out) {
    const sa = sc * (1 + 0.32 * open), sh = sc * (1 + 0.55 * open);
    const P = L.pts, n = P.length;
    const o = vadd(kp(L.o[0], L.o[1], L.o[2]), [0, 0, lift]);
    const a0 = vnorm([L.side * Math.cos(L.yaw), Math.sin(L.yaw), 0]);
    const lean = vnorm(vsub([0, 1, 0], vscale(a0, a0[1])));
    for (let i = 0; i < n; i++) {
      const [a, h, w] = P[i];
      // bajo el sello (a < ~0.012) la oreja va plana y sin torsión: así no asoma por el borde del lacre;
      // fuera del sello se inclina y se tuerce (volumen, asimetría natural)
      const tilt = L.tilt * smooth(0.010, 0.026, a) - open * 0.95;
      const hh = vnorm(vadd(vscale([0, 0, 1], Math.cos(tilt)), vscale(lean, Math.sin(tilt))));
      const ww3 = vcross(a0, hh);
      const ip = P[Math.max(0, i - 1)], inx = P[Math.min(n - 1, i + 1)];
      let ta = inx[0] - ip[0], th = inx[1] - ip[1];
      const tl = hypot(ta, th) || 1; ta /= tl; th /= tl;
      const n2a = -th, n2h = ta; // normal exterior (recorrido horario en el plano a-h)
      const upper = i < n * 0.55;
      const lat = (upper ? L.bend : -0.6 * L.bend) * Math.sin(Math.PI * clamp(a / 0.045, 0, 1)) * sc;
      const p = vadd(o, vadd(vadd(vscale(a0, a * sa), vscale(hh, h * sh)), vscale(ww3, lat)));
      let N = vnorm(vadd(vscale(a0, n2a), vscale(hh, n2h)));
      const T3 = vnorm(vadd(vscale(a0, ta), vscale(hh, th)));
      const tw0 = upper ? L.tw0 : L.tw1;
      const tw = (tw0 * (1 - smooth(0.0, 0.007, a)) + 0.65 * tw0 * Math.sin(Math.PI * clamp((a - 0.017) / 0.03, 0, 1))) * (1 - open * 0.5)
        + L.tipTw * smooth(0.025, 0.045, a);
      N = vrot(N, T3, tw);
      if (!upper && h < -0.0008) N = vnorm(vlerp(N, [0, 0, -1], 0.85 * smooth(-0.0008, -0.0016, h)));
      const ww = w * lerp(0.45, 1, sc) * lerp(1, 0.9, open);
      const pu = smooth(0.006, 0.02, a);
      out.push({ p, n: N, w: ww, cup: -0.0011 * pu * (1 - 0.5 * open), pleat: (1 - ww) * 0.0022 });
    }
  }

  // ============================== constructor de puntos de control según los parámetros de animación
  // P = { pull, hand:[x,y,z]|null, loopA, wrapOpen, loopBOpen, loosen }
  const tailAFree = tailDraped(TAIL_A, 1).p;   // punta de la cola A atada
  const tailAExit = tailDraped(TAIL_A, 0).p;
  function buildControls(P) {
    const C = [];
    const push = (p, n, w = 1, cup = 0, pleat = 0) => C.push({ p, n: vnorm(n), w, cup, pleat });
    const loose = P.loosen;
    const dl = loose * 0.0009;                 // la banda se afloja (centro sube igual: la base queda en la mesa)
    const lift = 2 * dl + P.wrapOpen * 0.0015; // el nudo sube al aflojarse
    // ---- cola A (desde la punta libre, σ = 0, hacia el nudo)
    {
      const d = TAIL_A, n = d.n;
      const exit = vadd(tailAExit, [0, 0, lift * 0.8]);
      const H = P.hand || tailAFree;
      const dir = vsub(H, exit);
      const dlen = vlen(dir) || 1;
      const dn = vscale(dir, 1 / dlen);
      let up = vsub([0, 0, 1], vscale(dn, dn[2])); up = vnorm(up);
      const Hd = vsub(H, tailAFree);
      for (let j = n; j >= 0; j--) {
        const f = j / n;
        const dr = tailDraped(d, f);
        dr.p = vadd(dr.p, [0, 0, lift * (1 - f) * 0.8]);
        if (P.hand) {
          // la mano arrastra la punta (influencia local que decae hacia el nudo)
          const infl = Math.pow(smooth(0.3, 1, f), 2);
          let p = vadd(dr.p, vscale(Hd, infl));
          // tira entre el nudo y la mano: cuelga en catenaria con la longitud de material que le toca
          const want = P.tailLen || dlen;
          const sagAmt = dlen * Math.sqrt(0.375 * Math.max(0, want / dlen - 1)) + 0.004 * (1 - smooth(0.25, 1, P.pull));
          const gdn = vnorm(envState.g);
          const lp = vadd(vadd(exit, vscale(dir, f)), vscale(gdn, sagAmt * 4 * f * (1 - f) * (1 - 0.25 * f)));
          const pl = envState.plane; // no atravesar la mesa
          if (pl) { const dd = pl[0] * lp[0] + pl[1] * lp[1] + pl[2] * lp[2] + pl[3] - (E + 0.0002); if (dd < 0) { lp[0] -= pl[0] * dd; lp[1] -= pl[1] * dd; lp[2] -= pl[2] * dd; } }
          const b = smoother(0, 1, clamp(P.pull * (0.8 + 0.4 * f), 0, 1));
          p = vlerp(p, lp, b);
          if (j === n) p = H.slice();
          dr.p = p;
          dr.n = vnorm(vlerp(dr.n, up, b));
          dr.w = lerp(dr.w, Math.max(dr.w, 0.92), b * f);
          dr.cup *= 1 - b;
        }
        push(dr.p, dr.n, dr.w, dr.cup, dr.pleat);
      }
    }
    // ---- interior del nudo: cola A pasa bajo la base de la envoltura y sube al haz → oreja A
    const kl = [0, 0, lift];
    const aStart = C.length;
    push(vadd(kp(-0.0031, -0.0013, 0.0009), kl), [0.2, 0, 1], 0.2, 0, 0.0008);
    push(vadd(kp(-0.0026, 0.0003, 0.0024), kl), [0.4, -0.3, 0.85], 0.1, 0, 0.0004);
    // ---- oreja A (se encoge al tirar)
    loopPoints(LOOP_A, P.loopA, 0, lift, C);
    // ---- oreja A → banda: baja por dentro del haz y sale por debajo del borde trasero
    push(vadd(kp(-0.0012, 0.0012, 0.0013), kl), [-1, 0, 0], 0.1, 0, 0.0004);
    push(vadd(kp(0.0000, 0.0030, 0.0002 + dl), kl), [0, 0, 1], 0.5, 0, 0.001);
    // cuando la oreja A ya pasó por el nudo, el interior se relaja: la cinta va lisa de la cola A al arranque de la banda
    const relaxA = smoother(0.45, 1, 1 - P.loopA);
    if (relaxA > 0) {
      const a0 = C[aStart - 1].p, a1 = C[C.length - 1].p, nA = C.length - 1 - aStart;
      for (let i = aStart; i < C.length - 1; i++) {
        const u = (i - aStart + 1) / (nA + 1);
        const q = vadd(vlerp(a0, a1, u), [0, 0, 0.0002 * Math.sin(Math.PI * u)]);
        const c = C[i];
        c.p = vlerp(c.p, q, relaxA); c.n = slerpN(c.n, [0, 0, 1], relaxA);
        c.w = lerp(c.w, 0.9, relaxA); c.cup *= 1 - relaxA; c.pleat *= 1 - relaxA;
      }
      const c = C[C.length - 1]; c.w = lerp(c.w, 0.95, relaxA); c.pleat *= 1 - relaxA;
    }
    // ---- banda alrededor del estadio (sale hacia +Y, rodea por detrás, por debajo, por delante y vuelve al nudo)
    if (!bLay.frac) bLay.bandStart = C.length;
    {
      const r = R + E + dl, zc = zC + dl;
      const skew = 0.0006;
      const topZ = zc + r;
      push([0, yK + 0.0068, topZ + lift * 0.35], [0, 0, 1], 0.86, 0, 0.0003);
      push([0.0001, yT - 0.0012, topZ], [0, 0, 1], 1, 0, 0);
      for (let k = 1; k <= 11; k++) {
        const f = k / 12 * Math.PI;
        push([skew * Math.sin(f), yT + r * Math.sin(f), zc + r * Math.cos(f)], [0, Math.sin(f), Math.cos(f)], 1, 0, 0);
      }
      const zb = zc - r;
      push([skew * 0.2, yT, zb], [0, 0, -1], 1, 0, 0);
      push([0, yK, zb], [0, 0, -1], 1, 0, 0);
      push([-skew * 0.2, yB, zb], [0, 0, -1], 1, 0, 0);
      for (let k = 1; k <= 11; k++) {
        const f = Math.PI + k / 12 * Math.PI;
        push([-skew * Math.sin(f - Math.PI), yB + r * Math.sin(f), zc + r * Math.cos(f)], [0, Math.sin(f), Math.cos(f)], 1, 0, 0);
      }
      push([0, yB + 0.0012, topZ], [0, 0, 1], 1, 0, 0);
      push([0, yK - 0.0078, topZ + lift * 0.35], [0, 0, 1], 0.94, 0, 0.0002);
      // pasa plana bajo las colas y la base del nudo, se monta sobre el arranque de la banda
      push(vadd(kp(0, -0.0030, 0.0002 + dl), kl), [0, 0, 1], 0.84, 0, 0.0006);
      push(vadd(kp(0, 0.0008, 0.0006 + dl), kl), [0, 0, 1], 0.74, 0, 0.0008);
    }
    // ---- envoltura del nudo: sube por detrás, pasa por encima, baja por delante y entra por la base (se abre al desatar)
    const bStart = C.length;
    {
      const o = P.wrapOpen;
      const ry = WRAP.ry * (1 + 1.5 * o), rz = WRAP.rz * (1 + 1.4 * o), cz = WRAP.c + 0.003 * o;
      const a0 = -0.75, a1 = 3 * Math.PI / 2 - 0.22, nA = 16;
      for (let k = 0; k <= nA; k++) {
        const al = lerp(a0, a1, k / nA);
        const sa = Math.sin(al), ca = Math.cos(al);
        const sz = sa < 0 ? -Math.pow(-sa, 0.4) : sa;            // base más plana: cubre la salida de las colas
        const y = ry * ca - 0.004 * o, z = cz + rz * sz;
        const fd = sa < 0 ? Math.min(4, 0.4 * Math.pow(Math.max(1e-4, -sa), -0.6)) : 1; // derivada de la base aplanada
        // normal hacia DENTRO de la envoltura: es la misma cara que miraba hacia arriba en la banda (sin giros bruscos)
        const N = [0, -rz * fd * ca, -ry * sa];
        const x = 0.0004 * Math.sin(al) + o * 0.006 * (k / nA);
        const edge = smooth(0, 0.25, k / nA) * smooth(0, 0.25, 1 - k / nA);
        const waist = 1 - 0.07 * Math.max(0, sa); // cintura: la envoltura aprieta un poco más arriba
        push(vadd(kp(x, y, z), kl), N, WRAP.w * waist * lerp(0.9, 1, edge) * lerp(1, 1.25, o), 0.0016 * edge * (1 - o * 0.6), -0.0005 * (1 - o));
      }
    }
    // ---- envoltura → oreja B (pliegue interno)
    push(vadd(kp(0.0010 + 0.004 * P.wrapOpen, -0.0002, 0.0026 + 0.002 * P.wrapOpen), kl), [-0.3, 0, 1], 0.1, 0, 0.0004);
    // ---- oreja B
    loopPoints(LOOP_B, 1, P.loopBOpen, lift, C);
    // ---- oreja B → cola B (baja por el haz y sale bajo el borde delantero de la envoltura)
    push(vadd(kp(0.0014, -0.0006, 0.0018), kl), [-1, 0, 0], 0.1, 0, 0.0004);
    push(vadd(kp(0.0030, -0.0014, 0.0009), kl), [0.2, 0, 1], 0.2, 0, 0.0008);
    // ---- cola B (hasta su punta, σ = L)
    {
      const d = TAIL_B, n = d.n;
      for (let j = 0; j <= n; j++) {
        const f = j / n;
        const dr = tailDraped(d, f);
        dr.p = vadd(dr.p, [0, 0, lift * (1 - f) * 0.8]);
        push(dr.p, dr.n, dr.w, dr.cup, dr.pleat);
        C[C.length - 1].prof = { x: dr.x, s: dr.s, h: dr.h };
      }
    }
    // ---- lado B se despliega: el nudo suelto se abre en una curva y la cinta queda tendida sobre el rollo hacia la mesa
    // (la cola B se desliza por encima del pergamino hacia atrás: equilibra el tirón de la cola A y la banda no se cae)
    if (P.bOpen > 0 && bLay.frac) {
      const lay = bLayout(dl, lift);
      const tb0 = C.length - (TAIL_B.n + 1);
      for (let i = bStart; i < C.length; i++) {
        const k = i - bStart, fr = bLay.frac[k];
        const bo = smoother(0, 1, clamp(P.bOpen * 1.42 - fr * 0.42, 0, 1));
        if (bo <= 0) continue;
        const o = layoutAt(lay, fr);
        const c = C[i];
        if (i >= tb0 && c.prof) {
          // interpolación sobre la superficie (coordenadas desenrolladas): resbala sobre el rollo, sin atravesarlo
          const ss = lerp(c.prof.s, o.s, bo), xx = lerp(c.prof.x, o.x, bo);
          const hh = lerp(c.prof.h, o.h, bo) + 0.0035 * Math.sin(Math.PI * bo);
          const q = onProfile(xx, ss, hh);
          c.p = q.p; c.n = q.n;
        } else {
          c.p = vlerp(c.p, o.p, bo);
          c.n = slerpN(c.n, o.n, bo);
        }
        c.w = lerp(c.w, o.w, bo); c.cup = lerp(c.cup, o.cup, bo); c.pleat = lerp(c.pleat, 0, bo);
      }
    }
    if (!bLay.frac) bLay.start = bStart;
    // mantener los puntos de control fuera de los rollos (durante la animación cinemática)
    if (P.pull > 0 || loose > 0) for (const c of C) pushOutOfRolls(c.p, R + E + 0.0002);
    return C;
  }

  // ---- disposición abierta del lado B (rizo suelto sobre el nudo + cinta tendida en diagonal sobre el rollo delantero)
  const bLay = { frac: null, len: 0, start: 0 };
  const B_SPRING = opts.springLift ?? 0.004;
  function bLayout(dl, lift) {
    // la cinta del lado B sigue su camino natural (+Y): pasa en diagonal sobre la banda, cruza la cima del rollo
    // superior, baja por detrás y descansa sobre la mesa con una ligera onda
    const pts = [];
    const n = 44, Lb = bLay.len;
    let x = 0.0015, ss = 0.0012, ell = 0;
    const step = Lb / n;
    for (let j = 0; j <= n; j++) {
      const f = j / n;
      const head = 0.62 * (1 - smooth(0.012, 0.05, ell)) + 0.16 + 0.12 * Math.sin(Math.PI * 2 * clamp((ell - 0.06) / 0.12, 0, 1)) * smooth(0.05, 0.08, ell);
      if (j > 0) { x += Math.sin(head) * step; ss += Math.cos(head) * step; }
      ell = j * step;
      let h = E + 0.0002;
      const over = 1 - smooth(W / 2 + 0.0004, W / 2 + 0.006, x - W * 0.5 * Math.cos(head)); // sobre la banda (cerca del nudo)
      if (ss < pS1 + 0.004) h += (TH + 0.0003) * over;
      h += 0.0015 * Math.pow(smooth(0.86, 1, f), 1.6);
      h += B_SPRING * Math.sin(Math.PI * Math.min(1, f * 1.4)) * (0.5 + 0.5 * f);
      const q = onProfile(x, ss, h + lift * (1 - smooth(0, 0.3, f)) * 0.5);
      const w = lerp(0.8, 1, smooth(0, 0.02, ell));
      const half = W * w / 2, sh = Math.sin(head);
      pts.push({ p: q.p, n: q.n, w, cup: -q.k * sh * sh * half * half * 0.5, x, s: ss, h });
    }
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + vlen(vsub(pts[i].p, pts[i - 1].p)));
    return { pts, acc, total: acc[acc.length - 1] };
  }
  function layoutAt(lay, fr) {
    const s = clamp(fr, 0, 1) * lay.total;
    let i = 1; while (i < lay.acc.length - 1 && lay.acc[i] < s) i++;
    const a = lay.pts[i - 1], b = lay.pts[i], u = clamp((s - lay.acc[i - 1]) / Math.max(1e-9, lay.acc[i] - lay.acc[i - 1]), 0, 1);
    return { p: vlerp(a.p, b.p, u), n: vnorm(vlerp(a.n, b.n, u)), w: lerp(a.w, b.w, u), cup: lerp(a.cup, b.cup, u),
      x: lerp(a.x, b.x, u), s: lerp(a.s, b.s, u), h: lerp(a.h, b.h, u) };
  }
  // interpolación esférica de normales (sirve también para giros de casi 180°)
  function slerpN(a, b, t) {
    const d = clamp(vdot(a, b), -1, 1);
    if (d > 0.9995) return vnorm(vlerp(a, b, t));
    let ax = vcross(a, b);
    if (vlen(ax) < 1e-4) ax = vcross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    return vnorm(vrot(a, vnorm(ax), Math.acos(d) * t));
  }
  function initBLayout() {
    const C = buildControls({ pull: 0, hand: null, loopA: 1, wrapOpen: 0, loopBOpen: 0, loosen: 0, bOpen: 0 });
    const B = C.slice(bLay.start);
    const acc = [0];
    for (let i = 1; i < B.length; i++) acc.push(acc[i - 1] + vlen(vsub(B[i].p, B[i - 1].p)));
    bLay.len = acc[acc.length - 1] * 1.04; // la curva real es algo más larga que el polígono de control
    bLay.frac = acc.map(v => v / acc[acc.length - 1]);
  }

  function pushOutOfRolls(p, rr) {
    if (Math.abs(p[0]) > ROLL_HALF) return;
    for (const yc of [yT, yB]) {
      const dy = p[1] - yc, dz = p[2] - zC, d = hypot(dy, dz);
      if (d < rr && d > 1e-9) { p[1] = yc + dy / d * rr; p[2] = zC + dz / d * rr; }
    }
  }

  // ============================== muestreo de la trayectoria (Catmull-Rom centrípeta) con atributos
  const SUB = 8;
  const path = { n: 0, pos: null, nrm: null, w: null, cup: null, pleat: null, s: null, tan: null, total: 0 };
  function samplePath(C) {
    const nc = C.length, ns = (nc - 1) * SUB + 1;
    if (!path.pos || path.pos.length < ns * 3) {
      path.pos = new Float64Array(ns * 3); path.nrm = new Float64Array(ns * 3); path.tan = new Float64Array(ns * 3);
      path.w = new Float64Array(ns); path.cup = new Float64Array(ns); path.pleat = new Float64Array(ns); path.s = new Float64Array(ns);
    }
    path.n = ns;
    const px = i => (i < 0 ? 2 * C[0].p[0] - C[1].p[0] : i >= nc ? 2 * C[nc - 1].p[0] - C[nc - 2].p[0] : C[i].p[0]);
    const py = i => (i < 0 ? 2 * C[0].p[1] - C[1].p[1] : i >= nc ? 2 * C[nc - 1].p[1] - C[nc - 2].p[1] : C[i].p[1]);
    const pz = i => (i < 0 ? 2 * C[0].p[2] - C[1].p[2] : i >= nc ? 2 * C[nc - 1].p[2] - C[nc - 2].p[2] : C[i].p[2]);
    let k = 0;
    for (let i = 0; i < nc - 1; i++) {
      const x0 = px(i - 1), y0 = py(i - 1), z0 = pz(i - 1), x1 = px(i), y1 = py(i), z1 = pz(i);
      const x2 = px(i + 1), y2 = py(i + 1), z2 = pz(i + 1), x3 = px(i + 2), y3 = py(i + 2), z3 = pz(i + 2);
      const t0 = 0, t1 = Math.max(Math.sqrt(hypot(x1 - x0, y1 - y0, z1 - z0)), 1e-4);
      const t2 = t1 + Math.max(Math.sqrt(hypot(x2 - x1, y2 - y1, z2 - z1)), 1e-4);
      const t3 = t2 + Math.max(Math.sqrt(hypot(x3 - x2, y3 - y2, z3 - z2)), 1e-4);
      const c1 = C[i], c2 = C[i + 1];
      const na = c1.n;
      let b0 = c2.n[0], b1 = c2.n[1], b2 = c2.n[2];
      if (na[0] * b0 + na[1] * b1 + na[2] * b2 < -0.98) { b0 += 1e-3; b1 += 2e-3; b2 += 1e-3; } // evita antiparalelas
      const jmax = i === nc - 2 ? SUB : SUB - 1;
      for (let j = 0; j <= jmax; j++) {
        const u = j / SUB, t = t1 + (t2 - t1) * u;
        const a10 = (t1 - t) / (t1 - t0), a11 = (t - t0) / (t1 - t0), a20 = (t2 - t) / (t2 - t1), a21 = (t - t1) / (t2 - t1);
        const a30 = (t3 - t) / (t3 - t2), a31 = (t - t2) / (t3 - t2), b10 = (t2 - t) / (t2 - t0), b11 = (t - t0) / (t2 - t0);
        const b20 = (t3 - t) / (t3 - t1), b21 = (t - t1) / (t3 - t1), w0 = (t2 - t) / (t2 - t1), w1 = (t - t1) / (t2 - t1);
        const A1x = a10 * x0 + a11 * x1, A1y = a10 * y0 + a11 * y1, A1z = a10 * z0 + a11 * z1;
        const A2x = a20 * x1 + a21 * x2, A2y = a20 * y1 + a21 * y2, A2z = a20 * z1 + a21 * z2;
        const A3x = a30 * x2 + a31 * x3, A3y = a30 * y2 + a31 * y3, A3z = a30 * z2 + a31 * z3;
        const B1x = b10 * A1x + b11 * A2x, B1y = b10 * A1y + b11 * A2y, B1z = b10 * A1z + b11 * A2z;
        const B2x = b20 * A2x + b21 * A3x, B2y = b20 * A2y + b21 * A3y, B2z = b20 * A2z + b21 * A3z;
        const us = u * u * (3 - 2 * u);
        const nx = na[0] + (b0 - na[0]) * us, ny = na[1] + (b1 - na[1]) * us, nz = na[2] + (b2 - na[2]) * us;
        const nl = hypot(nx, ny, nz) || 1;
        const k3 = k * 3;
        path.pos[k3] = w0 * B1x + w1 * B2x; path.pos[k3 + 1] = w0 * B1y + w1 * B2y; path.pos[k3 + 2] = w0 * B1z + w1 * B2z;
        path.nrm[k3] = nx / nl; path.nrm[k3 + 1] = ny / nl; path.nrm[k3 + 2] = nz / nl;
        path.w[k] = c1.w + (c2.w - c1.w) * us; path.cup[k] = c1.cup + (c2.cup - c1.cup) * us; path.pleat[k] = c1.pleat + (c2.pleat - c1.pleat) * us;
        k++;
      }
    }
    path.n = k;
    // longitud de arco y tangentes (diferencias centrales)
    path.s[0] = 0;
    for (let i = 1; i < k; i++) {
      const dx = path.pos[i * 3] - path.pos[i * 3 - 3], dy = path.pos[i * 3 + 1] - path.pos[i * 3 - 2], dz = path.pos[i * 3 + 2] - path.pos[i * 3 - 1];
      path.s[i] = path.s[i - 1] + hypot(dx, dy, dz);
    }
    path.total = path.s[k - 1];
    let lx = 1, ly = 0, lz = 0;
    for (let i = 0; i < k; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(k - 1, i + 1) * 3;
      let tx = path.pos[b] - path.pos[a], ty = path.pos[b + 1] - path.pos[a + 1], tz = path.pos[b + 2] - path.pos[a + 2];
      const l = hypot(tx, ty, tz);
      if (l > 1e-9) { tx /= l; ty /= l; tz /= l; lx = tx; ly = ty; lz = tz; } else { tx = lx; ty = ly; tz = lz; }
      path.tan[i * 3] = tx; path.tan[i * 3 + 1] = ty; path.tan[i * 3 + 2] = tz;
    }
  }

  // marco en el material σ (sobre la trayectoria actual, longitud normalizada a L)
  let L = 0; // longitud material (la de la pose atada)
  function framePath(sig, F) {
    const s = clamp(sig / L, 0, 1) * path.total;
    let lo = 0, hi = path.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path.s[m] <= s) lo = m; else hi = m; }
    const ds = path.s[hi] - path.s[lo];
    const u = ds > 1e-12 ? clamp((s - path.s[lo]) / ds, 0, 1) : 0;
    for (let c = 0; c < 3; c++) {
      F.C[c] = lerp(path.pos[lo * 3 + c], path.pos[hi * 3 + c], u);
      F.T[c] = lerp(path.tan[lo * 3 + c], path.tan[hi * 3 + c], u);
      F.N[c] = lerp(path.nrm[lo * 3 + c], path.nrm[hi * 3 + c], u);
    }
    F.w = lerp(path.w[lo], path.w[hi], u); F.cup = lerp(path.cup[lo], path.cup[hi], u); F.pleat = lerp(path.pleat[lo], path.pleat[hi], u);
    orthoFrame(F);
    return F;
  }
  function orthoFrame(F) {
    const T = F.T, N = F.N, B = F.B;
    const tl = hypot(T[0], T[1], T[2]) || 1; T[0] /= tl; T[1] /= tl; T[2] /= tl;
    const d = N[0] * T[0] + N[1] * T[1] + N[2] * T[2];
    N[0] -= T[0] * d; N[1] -= T[1] * d; N[2] -= T[2] * d;
    let nl = hypot(N[0], N[1], N[2]);
    if (nl < 1e-6) { // N paralela a T: cualquier perpendicular
      if (Math.abs(T[2]) < 0.9) { N[0] = -T[1]; N[1] = T[0]; N[2] = 0; } else { N[0] = 0; N[1] = -T[2]; N[2] = T[1]; }
      nl = hypot(N[0], N[1], N[2]);
    }
    N[0] /= nl; N[1] /= nl; N[2] /= nl;
    B[0] = T[1] * N[2] - T[2] * N[1]; B[1] = T[2] * N[0] - T[0] * N[2]; B[2] = T[0] * N[1] - T[1] * N[0];
  }
  const newFrame = () => ({ C: [0, 0, 0], T: [1, 0, 0], N: [0, 0, 1], B: [0, 1, 0], w: 1, cup: 0, pleat: 0 });

  // ============================== malla (tira con grosor: cara, dorso, cantos y cortes en V)
  const NS = 120;                    // segmentos de simulación
  const RPS = 5;                     // filas de render por segmento
  const NR = NS * RPS + 1;           // filas
  const NC = 5;                      // vértices a lo ancho
  const VPR = NC * 2 + 4;            // por fila: 5 cara + 5 dorso + 2 canto izq + 2 canto der
  const CAPV = NC * 2;               // por corte: 5 + 5
  const NV = NR * VPR + CAPV * 2;
  const VDEPTH = 0.0105, VREG = 0.016; // profundidad del corte en V (cola de golondrina) y zona de remapeo
  const UVL = 0.044;                 // metros por repetición de la textura del tejido

  const posA = new Float32Array(NV * 3), nrmA = new Float32Array(NV * 3), uvA = new Float32Array(NV * 2), tanA = new Float32Array(NV * 4);
  const idx = [];
  const vF = (r, c) => r * VPR + c, vK = (r, c) => r * VPR + NC + c;
  const vSL = (r, k) => r * VPR + 2 * NC + k, vSR = (r, k) => r * VPR + 2 * NC + 2 + k;
  const cap0 = NR * VPR, cap1 = NR * VPR + CAPV;
  for (let r = 0; r < NR - 1; r++) {
    for (let c = 0; c < NC - 1; c++) {
      const a = vF(r, c), b = vF(r, c + 1), d = vF(r + 1, c), e = vF(r + 1, c + 1);
      idx.push(a, b, d, b, e, d);
      const a2 = vK(r, c), b2 = vK(r, c + 1), d2 = vK(r + 1, c), e2 = vK(r + 1, c + 1);
      idx.push(a2, d2, b2, b2, d2, e2);
    }
    { const f0 = vSL(r, 0), b0 = vSL(r, 1), f1 = vSL(r + 1, 0), b1 = vSL(r + 1, 1); idx.push(f0, f1, b0, f1, b1, b0); }
    { const f0 = vSR(r, 0), b0 = vSR(r, 1), f1 = vSR(r + 1, 0), b1 = vSR(r + 1, 1); idx.push(f0, b0, f1, f1, b0, b1); }
  }
  for (let c = 0; c < NC - 1; c++) {
    const f0 = cap0 + c, f1 = cap0 + c + 1, b0 = cap0 + NC + c, b1 = cap0 + NC + c + 1;
    idx.push(f0, b0, f1, f1, b0, b1);
    const g0 = cap1 + c, g1 = cap1 + c + 1, h0 = cap1 + NC + c, h1 = cap1 + NC + c + 1;
    idx.push(g0, g1, h0, g1, h1, h0);
  }
  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posA, 3).setUsage(THREE.DynamicDrawUsage);
  const nrmAttr = new THREE.BufferAttribute(nrmA, 3).setUsage(THREE.DynamicDrawUsage);
  const tanAttr = new THREE.BufferAttribute(tanA, 4).setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(uvA, 2).setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr); geom.setAttribute('normal', nrmAttr);
  geom.setAttribute('uv', uvAttr); geom.setAttribute('tangent', tanAttr);
  geom.setIndex(idx);

  // ============================== material de satén
  const tex = makeSatinTextures(THREE, opts.renderer, opts.idle);
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(opts.color || '#5a0f1d'),
    map: tex.detailMap,
    roughness: opts.roughness ?? 0.33,
    metalness: 0,
    sheen: opts.sheen ?? 0.55,
    sheenColor: new THREE.Color(opts.sheenColor || '#d99aa0'),
    sheenRoughness: opts.sheenRoughness ?? 0.32,
    anisotropy: opts.anisotropy ?? 0.6,
    anisotropyRotation: opts.anisotropyRotation ?? Math.PI / 2, // brillo estirado a lo ancho (hilos a lo largo)
    normalMap: tex.normalMap,
    normalScale: new THREE.Vector2(0.2, 0.2),
    specularIntensity: 0.9,
    specularColor: new THREE.Color('#ffe9ec'),
    envMapIntensity: 1.0,
  });
  material.name = 'raso_vino';
  const mesh = new THREE.Mesh(geom, material);
  mesh.name = 'lazo_saten';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'Lazo';
  group.add(mesh);

  // escritura de una columna de vértices de una fila
  // pliegue de fruncido: cresta central que nunca baja de la base (los flancos solo inclinan la normal → sombreado del pliegue)
  const g = v => Math.max(0, Math.cos(1.5 * Math.PI * v)), gd = v => -1.5 * Math.PI * Math.sin(1.5 * Math.PI * v) * (Math.abs(v) < 0.75 ? 1 : 0.25);
  const colPos = new Float64Array(NC * 3), colN = new Float64Array(NC * 3);
  let renderCollide = false;
  function writeColumn(r, c, F, sig) {
    const v = -1 + 2 * c / (NC - 1);
    const half = Math.max(0.0015, W * F.w * 0.5);
    const f = F.cup * v * v + F.pleat * g(v);
    const fd = 2 * F.cup * v + F.pleat * gd(v);
    const k = -fd / half;
    let nx = F.N[0] + k * F.B[0], ny = F.N[1] + k * F.B[1], nz = F.N[2] + k * F.B[2];
    const nl = hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    let mx = F.C[0] + F.B[0] * v * half + F.N[0] * f, my = F.C[1] + F.B[1] * v * half + F.N[1] * f, mz = F.C[2] + F.B[2] * v * half + F.N[2] * f;
    if (renderCollide) {
      // la superficie interpolada entre partículas no debe entrar en los rollos ni en la mesa
      if (envState.collideRolls && Math.abs(mx) < ROLL_HALF) {
        const rr = R + TH * 0.5 + 0.00006;
        for (let q = 0; q < 2; q++) {
          const yc = q === 0 ? yT : yB, dy = my - yc, dz = mz - zC, d = hypot(dy, dz);
          if (d < rr && d > 1e-9) { my = yc + dy / d * rr; mz = zC + dz / d * rr; }
        }
        if (Math.abs(my - yK) < HALF_GAP && mz > zBot + 0.0015 && mz < GROOVE_FLOOR && hypot(my - yT, mz - zC) > R && hypot(my - yB, mz - zC) > R) mz = mz < zC ? zBot : GROOVE_FLOOR;
      }
      const pl = envState.plane;
      if (pl) { const dd = pl[0] * mx + pl[1] * my + pl[2] * mz + pl[3] - (TH * 0.5 + 0.00002); if (dd < 0) { mx -= pl[0] * dd; my -= pl[1] * dd; mz -= pl[2] * dd; } }
    }
    const ht = TH * 0.5;
    let i = vF(r, c);
    posA[i * 3] = mx + nx * ht; posA[i * 3 + 1] = my + ny * ht; posA[i * 3 + 2] = mz + nz * ht;
    nrmA[i * 3] = nx; nrmA[i * 3 + 1] = ny; nrmA[i * 3 + 2] = nz;
    uvA[i * 2] = sig / UVL; uvA[i * 2 + 1] = c / (NC - 1);
    tanA[i * 4] = F.T[0]; tanA[i * 4 + 1] = F.T[1]; tanA[i * 4 + 2] = F.T[2]; tanA[i * 4 + 3] = -1;
    i = vK(r, c);
    posA[i * 3] = mx - nx * ht; posA[i * 3 + 1] = my - ny * ht; posA[i * 3 + 2] = mz - nz * ht;
    nrmA[i * 3] = -nx; nrmA[i * 3 + 1] = -ny; nrmA[i * 3 + 2] = -nz;
    uvA[i * 2] = sig / UVL; uvA[i * 2 + 1] = c / (NC - 1);
    tanA[i * 4] = F.T[0]; tanA[i * 4 + 1] = F.T[1]; tanA[i * 4 + 2] = F.T[2]; tanA[i * 4 + 3] = 1;
    if (c === 0 || c === NC - 1) {
      const s = c === 0 ? -1 : 1;
      const ex = F.B[0] * s, ey = F.B[1] * s, ez = F.B[2] * s;
      for (let kk = 0; kk < 2; kk++) {
        const j = c === 0 ? vSL(r, kk) : vSR(r, kk);
        const sg = kk === 0 ? 1 : -1;
        posA[j * 3] = mx + nx * ht * sg; posA[j * 3 + 1] = my + ny * ht * sg; posA[j * 3 + 2] = mz + nz * ht * sg;
        nrmA[j * 3] = ex; nrmA[j * 3 + 1] = ey; nrmA[j * 3 + 2] = ez;
        uvA[j * 2] = sig / UVL; uvA[j * 2 + 1] = c === 0 ? 0.002 : 0.998;
        tanA[j * 4] = F.T[0]; tanA[j * 4 + 1] = F.T[1]; tanA[j * 4 + 2] = F.T[2]; tanA[j * 4 + 3] = 1;
      }
    }
    colPos[c * 3] = mx; colPos[c * 3 + 1] = my; colPos[c * 3 + 2] = mz;
    colN[c * 3] = nx; colN[c * 3 + 1] = ny; colN[c * 3 + 2] = nz;
  }
  function writeCap(base, F, sign) {
    for (let c = 0; c < NC; c++) {
      const mx = colPos[c * 3], my = colPos[c * 3 + 1], mz = colPos[c * 3 + 2];
      const nx = colN[c * 3], ny = colN[c * 3 + 1], nz = colN[c * 3 + 2];
      const ht = TH * 0.5;
      for (let kk = 0; kk < 2; kk++) {
        const j = base + kk * NC + c, sg = kk === 0 ? 1 : -1;
        posA[j * 3] = mx + nx * ht * sg; posA[j * 3 + 1] = my + ny * ht * sg; posA[j * 3 + 2] = mz + nz * ht * sg;
        nrmA[j * 3] = F.T[0] * sign; nrmA[j * 3 + 1] = F.T[1] * sign; nrmA[j * 3 + 2] = F.T[2] * sign;
        uvA[j * 2] = 0; uvA[j * 2 + 1] = c / (NC - 1);
        tanA[j * 4] = F.B[0]; tanA[j * 4 + 1] = F.B[1]; tanA[j * 4 + 2] = F.B[2]; tanA[j * 4 + 3] = 1;
      }
    }
  }
  // σ por columna en las zonas del corte en V
  function colSigma(sig, c) {
    const v = -1 + 2 * c / (NC - 1);
    const dc = VDEPTH * (1 - Math.abs(v));
    if (sig < VREG) return dc + sig * (VREG - dc) / VREG;
    if (sig > L - VREG) { const s0 = L - VREG; return s0 + (sig - s0) * (VREG - dc) / VREG; }
    return sig;
  }
  const Fr = newFrame(), Fc = newFrame();
  function writeMesh(frameFn) {
    for (let r = 0; r < NR; r++) {
      const sig = r / (NR - 1) * L;
      const inV = sig < VREG || sig > L - VREG;
      if (!inV) frameFn(sig, Fr);
      for (let c = 0; c < NC; c++) {
        if (inV) { const sc = colSigma(sig, c); frameFn(sc, Fc); writeColumn(r, c, Fc, sc); }
        else writeColumn(r, c, Fr, sig);
      }
      if (r === 0) { frameFn(colSigma(0, 2), Fc); writeCap(cap0, Fc, -1); }
      if (r === NR - 1) { frameFn(colSigma(L, 2), Fc); writeCap(cap1, Fc, 1); }
    }
    posAttr.needsUpdate = true; nrmAttr.needsUpdate = true; uvAttr.needsUpdate = true; tanAttr.needsUpdate = true;
  }

  // ============================== simulación (verlet + restricciones de posición)
  const NST = NS + 1, NP = NST * 3;
  const X = new Float64Array(NP * 3), Xp = new Float64Array(NP * 3);
  const TG0 = new Float64Array(NP * 3), TG1 = new Float64Array(NP * 3); // objetivos cinemáticos (inicio/fin de cuadro)
  const PLE = new Float64Array(NST);   // pliegue residual por estación (se relaja)
  const inv = new Float64Array(NP).fill(1);
  const pid = (i, j) => i * 3 + j;     // j: 0 borde −B, 1 centro, 2 borde +B
  let ds = 0;
  const cons = []; // [a, b, rest, stiffness] (se compacta en arrays tipados)
  let cA, cB, cR, cS, nCons = 0;
  const BEND = opts.bendStiffness ?? 0.4;
  const ITER = 3;
  function buildConstraints() {
    cons.length = 0;
    const hw = W / 2, diag = hypot(ds, hw);
    for (let i = 0; i < NST; i++) {
      cons.push([pid(i, 0), pid(i, 1), hw, 1], [pid(i, 1), pid(i, 2), hw, 1], [pid(i, 0), pid(i, 2), W, 0.8]);
      if (i < NS) {
        for (let j = 0; j < 3; j++) cons.push([pid(i, j), pid(i + 1, j), ds, 1]);
        cons.push([pid(i, 0), pid(i + 1, 1), diag, 0.55], [pid(i, 1), pid(i + 1, 0), diag, 0.55],
          [pid(i, 1), pid(i + 1, 2), diag, 0.55], [pid(i, 2), pid(i + 1, 1), diag, 0.55]);
      }
      if (i < NS - 1) for (let j = 0; j < 3; j++) cons.push([pid(i, j), pid(i + 2, j), 2 * ds, BEND]);
      if (i < NS - 2) cons.push([pid(i, 1), pid(i + 3, 1), 3 * ds, BEND * 0.5]);
    }
    nCons = cons.length;
    cA = new Int32Array(nCons); cB = new Int32Array(nCons); cR = new Float64Array(nCons); cS = new Float64Array(nCons);
    for (let c = 0; c < nCons; c++) {
      const cc = cons[c]; cA[c] = cc[0]; cB[c] = cc[1]; cR[c] = cc[2];
      cS[c] = cc[3] >= 1 ? 1 : 1 - Math.pow(1 - cc[3], 1 / ITER); // rigidez por iteración
    }
  }

  // muestrea los objetivos cinemáticos de las partículas desde la trayectoria
  const Ft = newFrame();
  function sampleTargets(out, withPleat) {
    for (let i = 0; i < NST; i++) {
      const sig = i * ds;
      framePath(sig, Ft);
      const half = W * Math.max(Ft.w, 0.62) * 0.5;
      for (let j = 0; j < 3; j++) {
        const v = j - 1;
        const f = j === 1 ? 0 : Ft.cup;
        const k = pid(i, j) * 3;
        out[k] = Ft.C[0] + Ft.B[0] * v * half + Ft.N[0] * f;
        out[k + 1] = Ft.C[1] + Ft.B[1] * v * half + Ft.N[1] * f;
        out[k + 2] = Ft.C[2] + Ft.B[2] * v * half + Ft.N[2] * f;
      }
      if (withPleat) PLE[i] = Ft.pleat;
    }
  }

  // marco en σ desde las partículas (Catmull-Rom uniforme sobre los centros)
  const stB = new Float64Array(NST * 3), stN = new Float64Array(NST * 3), stW = new Float64Array(NST), stCup = new Float64Array(NST);
  function computeStations() {
    for (let i = 0; i < NST; i++) {
      const a = pid(i, 0) * 3, m = pid(i, 1) * 3, b = pid(i, 2) * 3;
      let bx = X[b] - X[a], by = X[b + 1] - X[a + 1], bz = X[b + 2] - X[a + 2];
      const bl = hypot(bx, by, bz) || 1e-9;
      stW[i] = bl / W; bx /= bl; by /= bl; bz /= bl;
      const i0 = Math.max(0, i - 1), i1 = Math.min(NS, i + 1);
      const m0 = pid(i0, 1) * 3, m1 = pid(i1, 1) * 3;
      let tx = X[m1] - X[m0], ty = X[m1 + 1] - X[m0 + 1], tz = X[m1 + 2] - X[m0 + 2];
      const tl = hypot(tx, ty, tz) || 1e-9; tx /= tl; ty /= tl; tz /= tl;
      // N = B × T
      let nx = by * tz - bz * ty, ny = bz * tx - bx * tz, nz = bx * ty - by * tx;
      const nl = hypot(nx, ny, nz) || 1e-9; nx /= nl; ny /= nl; nz /= nl;
      stB[i * 3] = bx; stB[i * 3 + 1] = by; stB[i * 3 + 2] = bz;
      stN[i * 3] = nx; stN[i * 3 + 1] = ny; stN[i * 3 + 2] = nz;
      const ex = (X[a] + X[b]) * 0.5 - X[m], ey = (X[a + 1] + X[b + 1]) * 0.5 - X[m + 1], ez = (X[a + 2] + X[b + 2]) * 0.5 - X[m + 2];
      stCup[i] = ex * nx + ey * ny + ez * nz;
    }
  }
  function frameSim(sig, F) {
    const f = clamp(sig / ds, 0, NS - 1e-9), i = Math.floor(f), u = f - i;
    const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(NS, i + 1), i3 = Math.min(NS, i + 2);
    const u2 = u * u, u3 = u2 * u;
    for (let c = 0; c < 3; c++) {
      const p0 = X[pid(i0, 1) * 3 + c], p1 = X[pid(i1, 1) * 3 + c], p2 = X[pid(i2, 1) * 3 + c], p3 = X[pid(i3, 1) * 3 + c];
      F.C[c] = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
      F.T[c] = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u2);
      F.B[c] = lerp(stB[i1 * 3 + c], stB[i2 * 3 + c], u);
      F.N[c] = lerp(stN[i1 * 3 + c], stN[i2 * 3 + c], u);
    }
    const T = F.T, Bv = F.B, Nv = F.N;
    let tl = hypot(T[0], T[1], T[2]);
    if (tl < 1e-9) { T[0] = Nv[1] * Bv[2] - Nv[2] * Bv[1]; T[1] = Nv[2] * Bv[0] - Nv[0] * Bv[2]; T[2] = Nv[0] * Bv[1] - Nv[1] * Bv[0]; tl = hypot(T[0], T[1], T[2]) || 1; }
    const tx = T[0] / tl, ty = T[1] / tl, tz = T[2] / tl;
    // N desde B (más estable para la torsión): N = B × T (+ un poco de la normal de estación)
    const nx = Bv[1] * tz - Bv[2] * ty, ny = Bv[2] * tx - Bv[0] * tz, nz = Bv[0] * ty - Bv[1] * tx;
    Nv[0] = nx + Nv[0] * 0.15; Nv[1] = ny + Nv[1] * 0.15; Nv[2] = nz + Nv[2] * 0.15;
    F.w = clamp(lerp(stW[i1], stW[i2], u), 0.15, 1.04);
    F.cup = clamp(lerp(stCup[i1], stCup[i2], u), -0.006, 0.006);
    F.pleat = lerp(PLE[i1], PLE[i2], u);
    orthoFrame(F);
    return F;
  }
  const Fa = newFrame(), Fb = newFrame();
  let blendK = 1;
  function frameBlend(sig, F) {
    if (blendK >= 0.999) return framePath(sig, F);
    if (blendK <= 0.001) return frameSim(sig, F);
    framePath(sig, Fa); frameSim(sig, Fb);
    const k = blendK;
    for (let c = 0; c < 3; c++) {
      F.C[c] = lerp(Fb.C[c], Fa.C[c], k); F.T[c] = lerp(Fb.T[c], Fa.T[c], k);
      F.N[c] = lerp(Fb.N[c], Fa.N[c], k);
    }
    F.w = lerp(Fb.w, Fa.w, k); F.cup = lerp(Fb.cup, Fa.cup, k); F.pleat = lerp(Fb.pleat, Fa.pleat, k);
    orthoFrame(F);
    return F;
  }

  // ============================== estado inicial atado
  const TIED = { pull: 0, hand: null, loopA: 1, wrapOpen: 0, loopBOpen: 0, loosen: 0, bOpen: 0 };
  initBLayout();
  samplePath(buildControls(TIED));
  L = path.total;
  bLay.len = path.total - path.s[bLay.start * SUB]; // longitud exacta del lado B (envoltura + oreja B + cola B)
  bLay.bandS0 = path.s[bLay.bandStart * SUB] + 0.012; bLay.bandS1 = path.s[bLay.start * SUB] - 0.012; // tramo de la banda
  ds = L / NS;
  buildConstraints();
  writeMesh(framePath);
  geom.computeBoundingSphere();

  const knot = {
    position: new THREE.Vector3(0, yK, zTop + SEAL_LIFT),
    normal: new THREE.Vector3(0, 0, 1),
  };

  // ============================== línea de tiempo del desatado
  let state = 'tied';
  let t = 0, D = 2.2, pending = null, settleT = 0, simTime = 0, lastH = 1 / 240;
  let lenCorr = 0;
  const perf = { kin: 0, tgt: 0, sim: 0, mesh: 0, n: 0 };
  let settleFx = 0; // 0→1: amortiguación de asentamiento al final (la cinta 'se resuelve' sin congelarse de golpe)
  let handActive = false;
  const pullDir = vnorm(opts.pullDirection || [-0.5, -0.5, 0.71]);
  const tailALen = TAIL_A.len, loopALen = (() => { // longitud aproximada de la oreja A
    const fr = loopFrame(LOOP_A); let l = 0;
    for (let i = 1; i < LOOP_A.pts.length; i++) {
      const a = LOOP_A.pts[i - 1], b = LOOP_A.pts[i];
      l += vlen(vadd(vscale(fr.a, b[0] - a[0]), vscale(fr.h, b[1] - a[1])));
    }
    return l;
  })();
  const TS = s => s * D / 2.2; // escala de tiempos
  const HAND_REACH = opts.handReach ?? 0.115; // la mano se aleja ~11 cm del nudo; el resto de la cola cuelga
  function params(time) {
    const tg = TS(0.2), tp = TS(0.98);
    const pull = 0.14 * smooth(0, tg, time) + 0.86 * easeInOut(clamp((time - tg) / (tp - tg), 0, 1));
    const la = 1 - Math.pow(smooth(TS(0.16), TS(1.0), time), 1.35);
    const wrapOpen = 0.35 * smooth(TS(0.55), TS(0.95), time);
    const loopBOpen = 0.3 * smooth(TS(0.58), TS(0.95), time);
    const bOpen = smoother(TS(0.68), TS(1.42), time);
    const loosen = smooth(TS(0.84), TS(1.28), time);
    // mano: de la punta atada (se levanta un poco) hacia la dirección de tirón, conservando longitud
    const exit = vadd(tailAExit, [0, 0, (2 * loosen * 0.0009) * 0.8]);
    const want = tailALen * 0.97 + loopALen * (1 - la) * 0.95 + 0.012 * smooth(TS(0.8), TS(1.3), time);
    // trayectoria de la mano (Hermite por tramos): pellizca y levanta la punta → tira hacia arriba y afuera mientras
    // la oreja A pasa por el nudo → barre hacia afuera y baja a depositar la cola sobre la mesa → suelta.
    const tr = RELEASE();
    const k0 = tailAFree;
    const k1 = vadd(tailAFree, [0, -0.002, 0.009]);
    const k2 = vadd(exit, vscale(pullDir, HAND_REACH));
    const hz = vnorm([pullDir[0], pullDir[1], 0]);
    const k3 = [exit[0] + hz[0] * 0.15, exit[1] + hz[1] * 0.15, zG + 0.011];
    let hand;
    if (time <= tg) hand = hermite(k0, k1, [0, 0, 0], vscale(vsub(k2, k0), 0.25), time / tg);
    else if (time <= tp) hand = hermite(k1, k2, vscale(vsub(k2, k0), 0.25), vscale(vsub(k3, k1), 0.5), easeInOut(clamp((time - tg) / (tp - tg), 0, 1)) * 0.82 + clamp((time - tg) / (tp - tg), 0, 1) * 0.18);
    else hand = hermite(k2, k3, vscale(vsub(k3, k1), 0.5), [0, 0, -0.004], 1 - Math.pow(1 - clamp((time - tp) / (tr - tp), 0, 1), 2));
    return { pull, hand, tailLen: want, loopA: Math.max(0, la), wrapOpen, loopBOpen, loosen, bOpen };
  }
  const K0 = () => TS(0.98), K1 = () => TS(1.42), RELEASE = () => TS(1.72);
  function hermite(p0, p1, m0, m1, u) {
    const u2 = u * u, u3 = u2 * u, h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return [0, 1, 2].map(c => h00 * p0[c] + h10 * m0[c] + h01 * p1[c] + h11 * m1[c]);
  }

  // ============================== entorno de colisiones
  const g0 = new THREE.Vector3(0, 0, -9.81);
  const envState = { g: [0, 0, -9.81], plane: null, collideRolls: true };
  let detached = false; // tras detach(): marco congelado, sin rollos (el pergamino se fue)
  function applyEnv(env) {
    if (detached) { envState.collideRolls = false; return; }
    const gv = env?.gravityLocal || g0;
    envState.g = [gv.x, gv.y, gv.z];
    envState.collideRolls = env?.collideRolls !== false;
    if (env?.groundPlaneLocal) {
      const p = env.groundPlaneLocal; envState.plane = [p.normal.x, p.normal.y, p.normal.z, p.constant];
    } else {
      // plano por defecto: perpendicular a la gravedad, tangente al punto más bajo del estadio
      const gn = vnorm(envState.g);
      const sup = Math.max(vdot(gn, [0, yT, zC]), vdot(gn, [0, yB, zC])) + R + E + TH * 0.5;
      const n = vscale(gn, -1);
      envState.plane = [n[0], n[1], n[2], sup];
    }
  }
  applyEnv(null);

  const GRAV_SCALE = opts.gravityScale ?? 0.55; // caída "de cine" (escala de mesa → se siente más grande)
  const contactN = new Float64Array(NP * 3), contactF = new Float64Array(NP);
  const bandFric = new Uint8Array(NST), underSt = new Uint8Array(NST); const STICK = 0.006; // m/s
  function collide(i, j) {
    const k = pid(i, j) * 3;
    // la banda que pasa bajo el pergamino (estaciones marcadas) cabe justo entre rollo y mesa; el resto de la cinta
    // lleva un margen por capas (según σ) que además le impide colarse por debajo del pergamino
    const under = underSt[i] === 1;
    const layer = under ? TH * 0.5 + 0.00002 : TH * 0.5 + 0.00004 + 0.00026 * (i / NS);
    let x = X[k], y = X[k + 1], z = X[k + 2];
    let hit = 0;
    if (envState.collideRolls) {
      const ax = Math.abs(x);
      if (ax < ROLL_HALF) {
        // pergamino cerrado = unión de los dos rollos + hoja plana. Reglas sin "rendijas":
        //  · mitad inferior: falda vertical hasta la mesa (nada se cuela por debajo, salvo la banda que ya pasa por ahí)
        //  · mitad superior entre ejes: empuje vertical a la envolvente (la cinta puede asentarse en la ranura, sin atravesarla)
        //  · mitad superior por fuera de los ejes: empuje radial del rollo
        const rr = R + (under ? TH * 0.25 : E * 0.5 + layer);
        const dyK = y - yK, ady = Math.abs(dyK), sg = dyK < 0 ? -1 : 1;
        if (z < zC) {
          if (under) {
            for (let q = 0; q < 2; q++) {
              const yc = q === 0 ? yT : yB, dy = y - yc, dz = z - zC, d = hypot(dy, dz);
              if (d < rr && d > 1e-9) { y = yc + dy / d * rr; z = zC + dz / d * rr; contactN[k] = 0; contactN[k + 1] = dy / d; contactN[k + 2] = dz / d; hit = 1; }
            }
          } else {
            const zz = Math.max(z, zBot + 0.0015) - zC;
            const wall = HALF_GAP + Math.sqrt(Math.max(0, rr * rr - zz * zz));
            if (ady < wall && z > zBot - 0.003) {
              y = yK + sg * wall;
              const cz = Math.max(-1, Math.min(0, zz / rr));
              contactN[k] = 0; contactN[k + 1] = sg * Math.sqrt(1 - cz * cz); contactN[k + 2] = cz; hit = 1;
            }
          }
        } else if (ady < HALF_GAP) {
          let zup = GROOVE_FLOOR, ny = 0, nz = 1;
          for (let q = 0; q < 2; q++) {
            const yc = q === 0 ? yT : yB, dy = y - yc;
            if (Math.abs(dy) < rr) { const zt = zC + Math.sqrt(rr * rr - dy * dy); if (zt > zup) { zup = zt; ny = dy / rr; nz = (zt - zC) / rr; } }
          }
          if (z < zup) { z = zup; contactN[k] = 0; contactN[k + 1] = ny; contactN[k + 2] = nz; hit = 1; }
        } else {
          const yc = dyK > 0 ? yT : yB, dy = y - yc, dz = z - zC, d = hypot(dy, dz);
          if (d < rr && d > 1e-9) { y = yc + dy / d * rr; z = zC + dz / d * rr; contactN[k] = 0; contactN[k + 1] = dy / d; contactN[k + 2] = dz / d; hit = 1; }
        }
      } else if (ax < ROD_HALF) {
        const rr = ROD_R + E * 0.5 + layer;
        for (let q = 0; q < 2; q++) {
          const yc = q === 0 ? yT : yB, dy = y - yc, dz = z - zC, d = hypot(dy, dz);
          if (d < rr && d > 1e-9) { y = yc + dy / d * rr; z = zC + dz / d * rr; contactN[k] = 0; contactN[k + 1] = dy / d; contactN[k + 2] = dz / d; hit = 1; }
        }
      }
    }
    const pl = envState.plane;
    if (pl) {
      const dist = pl[0] * x + pl[1] * y + pl[2] * z + pl[3] - layer;
      if (dist < 0) {
        x -= pl[0] * dist; y -= pl[1] * dist; z -= pl[2] * dist;
        contactN[k] = pl[0]; contactN[k + 1] = pl[1]; contactN[k + 2] = pl[2]; hit = 2;
      }
    }
    X[k] = x; X[k + 1] = y; X[k + 2] = z;
    if (hit) contactF[pid(i, j)] = hit;
  }

  // ---- autocolisión: cada partícula contra los "parches" (tramo entre dos estaciones) del resto de la cinta.
  // Mantiene las capas separadas ≥ grosor (sin z-fighting ni cintas que se atraviesan). El lado se decide con la
  // posición al inicio del cuadro (XF) para no dejar pasar nada aunque haya ido rápido.
  const XF = new Float64Array(NP * 3);
  const SC_GAP = TH + 0.00012, CELL = 0.014;
  const patchC = new Float64Array(NS * 3), patchT = new Float64Array(NS * 3), patchB = new Float64Array(NS * 3), patchN = new Float64Array(NS * 3);
  const patchHW = new Float64Array(NS), patchHL = new Float64Array(NS), patchNF = new Float64Array(NS * 3), patchCF = new Float64Array(NS * 3);
  const grid = new Map();
  function buildPatches() {
    grid.clear();
    for (let j = 0; j < NS; j++) {
      const a0 = pid(j, 0) * 3, m0 = pid(j, 1) * 3, b0 = pid(j, 2) * 3, a1 = pid(j + 1, 0) * 3, m1 = pid(j + 1, 1) * 3, b1 = pid(j + 1, 2) * 3;
      const q = j * 3;
      for (let c = 0; c < 3; c++) {
        patchC[q + c] = (X[m0 + c] + X[m1 + c]) * 0.5;
        patchT[q + c] = X[m1 + c] - X[m0 + c];
        patchB[q + c] = ((X[b0 + c] - X[a0 + c]) + (X[b1 + c] - X[a1 + c])) * 0.25;
        patchCF[q + c] = (XF[m0 + c] + XF[m1 + c]) * 0.5;
      }
      let tl = hypot(patchT[q], patchT[q + 1], patchT[q + 2]) || 1e-9;
      patchHL[j] = tl * 0.5;
      patchT[q] /= tl; patchT[q + 1] /= tl; patchT[q + 2] /= tl;
      const bl = hypot(patchB[q], patchB[q + 1], patchB[q + 2]) || 1e-9;
      patchHW[j] = bl;
      patchB[q] /= bl; patchB[q + 1] /= bl; patchB[q + 2] /= bl;
      let nx = patchT[q + 1] * patchB[q + 2] - patchT[q + 2] * patchB[q + 1];
      let ny = patchT[q + 2] * patchB[q] - patchT[q] * patchB[q + 2];
      let nz = patchT[q] * patchB[q + 1] - patchT[q + 1] * patchB[q];
      const nl = hypot(nx, ny, nz) || 1e-9; nx /= nl; ny /= nl; nz /= nl;
      patchN[q] = nx; patchN[q + 1] = ny; patchN[q + 2] = nz;
      // normal al inicio del cuadro (para saber de qué lado estaba cada partícula)
      let tfx = XF[m1] - XF[m0], tfy = XF[m1 + 1] - XF[m0 + 1], tfz = XF[m1 + 2] - XF[m0 + 2];
      const bfx = (XF[b0] - XF[a0]) + (XF[b1] - XF[a1]), bfy = (XF[b0 + 1] - XF[a0 + 1]) + (XF[b1 + 1] - XF[a1 + 1]), bfz = (XF[b0 + 2] - XF[a0 + 2]) + (XF[b1 + 2] - XF[a1 + 2]);
      let fx = tfy * bfz - tfz * bfy, fy = tfz * bfx - tfx * bfz, fz = tfx * bfy - tfy * bfx;
      const fl = hypot(fx, fy, fz) || 1e-9;
      patchNF[q] = fx / fl; patchNF[q + 1] = fy / fl; patchNF[q + 2] = fz / fl;
      const key = Math.floor(patchC[q] / CELL) * 73856093 ^ Math.floor(patchC[q + 1] / CELL) * 19349663 ^ Math.floor(patchC[q + 2] / CELL) * 83492791;
      let arr = grid.get(key); if (!arr) { arr = []; grid.set(key, arr); } arr.push(j);
    }
  }
  function selfCollide() {
    buildPatches();
    for (let i = 0; i < NST; i++) {
      for (let jj = 0; jj < 3; jj++) {
        const p = pid(i, jj); if (inv[p] === 0) continue;
        const k = p * 3;
        const cx = Math.floor(X[k] / CELL), cy = Math.floor(X[k + 1] / CELL), cz = Math.floor(X[k + 2] / CELL);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          const arr = grid.get((cx + ox) * 73856093 ^ (cy + oy) * 19349663 ^ (cz + oz) * 83492791);
          if (!arr) continue;
          for (let a = 0; a < arr.length; a++) {
            const j = arr[a];
            if (j >= i - 2 && j <= i + 1) continue; // vecinos de la propia tira
            const q = j * 3;
            const dx = X[k] - patchC[q], dy = X[k + 1] - patchC[q + 1], dz = X[k + 2] - patchC[q + 2];
            const u = dx * patchT[q] + dy * patchT[q + 1] + dz * patchT[q + 2];
            if (Math.abs(u) > patchHL[j] + 0.0006) continue;
            const v = dx * patchB[q] + dy * patchB[q + 1] + dz * patchB[q + 2];
            if (Math.abs(v) > patchHW[j] + 0.0004) continue;
            const w = dx * patchN[q] + dy * patchN[q + 1] + dz * patchN[q + 2];
            if (Math.abs(w) >= SC_GAP) continue;
            // lado: el de la posición al inicio del cuadro
            const wf = (XF[k] - patchCF[q]) * patchNF[q] + (XF[k + 1] - patchCF[q + 1]) * patchNF[q + 1] + (XF[k + 2] - patchCF[q + 2]) * patchNF[q + 2];
            const side = (wf !== 0 ? Math.sign(wf) : Math.sign(w)) || 1;
            const push = side * SC_GAP - w; // corrección total a lo largo de la normal
            // reparto: 60 % a la partícula, 40 % al parche (sus 6 partículas)
            const pp = push * 0.6, pq = -push * 0.4 / 6;
            // (se desplaza también la posición previa: separa sin inyectar velocidad → sin temblores)
            const ex = patchN[q] * pp, ey = patchN[q + 1] * pp, ez = patchN[q + 2] * pp;
            X[k] += ex; X[k + 1] += ey; X[k + 2] += ez; Xp[k] += ex * 0.85; Xp[k + 1] += ey * 0.85; Xp[k + 2] += ez * 0.85;
            for (let s2 = 0; s2 < 2; s2++) for (let c2 = 0; c2 < 3; c2++) {
              const pi = pid(j + s2, c2); if (inv[pi] === 0) continue;
              const r3 = pi * 3, fx = patchN[q] * pq, fy = patchN[q + 1] * pq, fz = patchN[q + 2] * pq;
              X[r3] += fx; X[r3 + 1] += fy; X[r3 + 2] += fz; Xp[r3] += fx * 0.85; Xp[r3 + 1] += fy * 0.85; Xp[r3 + 2] += fz * 0.85;
            }
          }
        }
      }
    }
  }

  let doSelf = false;
  function substep(h, hPrev, k, alphaT) {
    const gx = envState.g[0] * GRAV_SCALE, gy = envState.g[1] * GRAV_SCALE, gz = envState.g[2] * GRAV_SCALE;
    const damp = Math.exp(-(0.9 + settleFx * 7) * h);
    const vr = h / hPrev;
    contactF.fill(0);
    for (let p = 0; p < NP; p++) {
      const q = p * 3;
      if (inv[p] === 0) { Xp[q] = X[q]; Xp[q + 1] = X[q + 1]; Xp[q + 2] = X[q + 2]; continue; }
      let vx = (X[q] - Xp[q]) * vr * damp, vy = (X[q + 1] - Xp[q + 1]) * vr * damp, vz = (X[q + 2] - Xp[q + 2]) * vr * damp;
      const vl = hypot(vx, vy, vz), vmax = 0.02;
      if (vl > vmax) { vx *= vmax / vl; vy *= vmax / vl; vz *= vmax / vl; }
      Xp[q] = X[q]; Xp[q + 1] = X[q + 1]; Xp[q + 2] = X[q + 2];
      X[q] += vx + gx * h * h; X[q + 1] += vy + gy * h * h; X[q + 2] += vz + gz * h * h;
    }
    // arrastre aerodinámico: frena la componente normal de la velocidad (la cinta "planea")
    const cn = 1 - Math.exp(-16 * h);
    for (let i = 0; i < NST; i++) {
      const a = pid(i, 0) * 3, b = pid(i, 2) * 3;
      const i0 = pid(Math.max(0, i - 1), 1) * 3, i1 = pid(Math.min(NS, i + 1), 1) * 3;
      const bx = X[b] - X[a], by = X[b + 1] - X[a + 1], bz = X[b + 2] - X[a + 2];
      const tx = X[i1] - X[i0], ty = X[i1 + 1] - X[i0 + 1], tz = X[i1 + 2] - X[i0 + 2];
      let nx = by * tz - bz * ty, ny = bz * tx - bx * tz, nz = bx * ty - by * tx;
      const nl = hypot(nx, ny, nz); if (nl < 1e-12) continue;
      nx /= nl; ny /= nl; nz /= nl;
      for (let j = 0; j < 3; j++) {
        const p = pid(i, j); if (inv[p] === 0) continue;
        const q = p * 3;
        const vn = (X[q] - Xp[q]) * nx + (X[q + 1] - Xp[q + 1]) * ny + (X[q + 2] - Xp[q + 2]) * nz;
        Xp[q] += nx * vn * cn; Xp[q + 1] += ny * vn * cn; Xp[q + 2] += nz * vn * cn;
      }
    }
    for (let it = 0; it < ITER; it++) {
      for (let c = 0; c < nCons; c++) {
        const a = cA[c], b = cB[c];
        const wa = inv[a], wb = inv[b], ws = wa + wb; if (ws === 0) continue;
        const ia = a * 3, ib = b * 3;
        const dx = X[ib] - X[ia], dy = X[ib + 1] - X[ia + 1], dz = X[ib + 2] - X[ia + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz); if (d < 1e-12) continue;
        const corr = (d - cR[c]) / d * cS[c] / ws;
        X[ia] += dx * corr * wa; X[ia + 1] += dy * corr * wa; X[ia + 2] += dz * corr * wa;
        X[ib] -= dx * corr * wb; X[ib + 1] -= dy * corr * wb; X[ib + 2] -= dz * corr * wb;
      }
      if (it >= ITER - 2) for (let i = 0; i < NST; i++) for (let j = 0; j < 3; j++) if (inv[pid(i, j)] !== 0) collide(i, j);
    }
    if (doSelf) { selfCollide(); for (let i = 0; i < NST; i++) for (let j = 0; j < 3; j++) if (inv[pid(i, j)] !== 0) collide(i, j); }
    // fricción en contacto (satén sobre papel: desliza; sobre la mesa: agarra más)
    for (let p = 0; p < NP; p++) {
      const hit = contactF[p]; if (!hit || inv[p] === 0) continue;
      // la banda abraza el rollo ~300° (efecto cabrestante): casi no resbala; el resto desliza como satén
      const st = (p / 3) | 0;
      let mu = hit === 2 ? 0.6 : (bandFric[st] ? 1 : 0.62);
      mu = Math.min(0.97, mu + settleFx * 0.3);
      const q = p * 3;
      const dx = X[q] - Xp[q], dy = X[q + 1] - Xp[q + 1], dz = X[q + 2] - Xp[q + 2];
      const nx = contactN[q], ny = contactN[q + 1], nz = contactN[q + 2];
      const dn = dx * nx + dy * ny + dz * nz;
      const tx = dx - dn * nx, ty = dy - dn * ny, tz = dz - dn * nz;
      if (hypot(tx, ty, tz) < STICK * h) mu = 1; // fricción estática: sin reptación lenta
      Xp[q] += tx * mu; Xp[q + 1] += ty * mu; Xp[q + 2] += tz * mu;
    }
    // mezcla con la pose cinemática (transición continua)
    if (k > 0) {
      for (let p = 0; p < NP; p++) {
        const q = p * 3;
        for (let c = 0; c < 3; c++) {
          const tg = lerp(TG0[q + c], TG1[q + c], alphaT);
          X[q + c] = lerp(X[q + c], tg, k);
        }
      }
    }
    // mano: la punta σ=0 sigue a la mano hasta soltarla
    if (handActive) for (let j = 0; j < 3; j++) {
      const q = pid(0, j) * 3;
      for (let c = 0; c < 3; c++) X[q + c] = lerp(TG0[q + c], TG1[q + c], alphaT);
    }
  }

  // ============================== API
  let fpsFrames = 0, fpsT = 0;
  const api = {
    group, mesh, material, knot,
    /** PERF: resuelve cuando las texturas de raso están completas (con opts.idle se calculan por tramos ociosos). */
    ready: tex.ready,
    get state() { return state; },
    get settled() { return state === 'settled'; },
    get length() { return L; },
    get progress() { return state === 'tied' ? 0 : clamp(t / D, 0, 1); },
    fps: 0,

    untie({ duration = 2.2 } = {}) {
      if (state !== 'tied') api.reset();
      D = Math.max(0.6, duration);
      t = 0; simTime = 0; settleT = 0; state = 'untying'; blendK = 1; lenCorr = 0;
      handActive = true;
      // partículas en la pose atada, sin velocidad
      samplePath(buildControls(TIED));
      sampleTargets(TG0, true);
      TG1.set(TG0); X.set(TG0); Xp.set(TG0);
      inv.fill(1);
      for (let j = 0; j < 3; j++) inv[pid(0, j)] = 0;
      for (let i = 0; i < NST; i++) {
        const sg = i * ds; bandFric[i] = sg > bLay.bandS0 && sg < bLay.bandS1 ? 1 : 0;
        const m = pid(i, 1) * 3; // ¿empieza bajo el pergamino? (tramo inferior de la banda)
        underSt[i] = bandFric[i] && TG0[m + 2] < zBot + 0.001 && Math.abs(TG0[m + 1] - yK) < HALF_GAP + R * 0.9 ? 1 : 0;
      }
      return new Promise(res => { pending = res; });
    },

    reset() {
      state = 'tied'; t = 0; blendK = 1; handActive = false; inv.fill(1); renderCollide = false; settleFx = 0; detached = false; envState.collideRolls = true;
      samplePath(buildControls(TIED));
      writeMesh(framePath);
      if (pending) { const p = pending; pending = null; p(); }
    },

    update(dt = 1 / 60, time = 0, env) {
      if (state === 'tied') { if (env) applyEnv(env); return; }
      if (state === 'settled') {
        // despierta si cambia el entorno (p. ej. se levanta el pergamino: collideRolls=false, otra gravedad/plano)
        const before = JSON.stringify([envState.g, envState.plane, envState.collideRolls]);
        if (env) applyEnv(env);
        if (JSON.stringify([envState.g, envState.plane, envState.collideRolls]) === before) return;
        state = 'falling'; settleT = 0;
      }
      applyEnv(env);
      dt = clamp(dt || 1 / 60, 0, 1 / 15);
      if (dt <= 0) return;
      fpsFrames++; fpsT += dt; if (fpsT > 0.5) { api.fps = Math.round(fpsFrames / fpsT); fpsFrames = 0; fpsT = 0; }
      const t0 = t;
      t += dt;
      // objetivos cinemáticos del cuadro
      TG0.set(TG1);
      const kinematicAlive = t0 < K1() + 0.02 || handActive;
      const _t0 = performance.now();
      if (kinematicAlive) {
        const P = params(Math.min(t, RELEASE()));
        samplePath(buildControls(P));
        // conserva la longitud: la cola A (que cuelga de la mano) absorbe la diferencia → sin compresión ni estiramiento
        if (t > TS(0.3)) {
          P.tailLen = Math.max(0.02, P.tailLen + lenCorr);
          samplePath(buildControls(P));
          const err = L - path.total;
          if (Math.abs(err) > 0.004) { // corrección grande: una pasada más en este cuadro
            lenCorr += err * 1.05; P.tailLen = Math.max(0.02, P.tailLen + err * 1.05);
            samplePath(buildControls(P));
          } else lenCorr += err * 0.9; // el resto se corrige en los cuadros siguientes
        }
        const _t1 = performance.now(); perf.kin += _t1 - _t0;
        sampleTargets(TG1, t < K0());
        perf.tgt += performance.now() - _t1;
      }
      const kNow = 1 - smoother(K0(), K1(), t), kPrev = 1 - smoother(K0(), K1(), t0);
      settleFx = smooth(D * 1.05, D * 1.05 + 1.6, t);
      if (handActive && t > RELEASE()) {
        handActive = false;
        for (let j = 0; j < 3; j++) inv[pid(0, j)] = 1;
      }
      const _t2 = performance.now();
      // sub-pasos
      const n = clamp(Math.ceil(dt / (1 / 300)), 2, 8); // con dt grandes el sub-paso crece (PBD es estable)
      const h = dt / n;
      if (kPrev >= 0.9999 && kNow >= 0.9999) {
        // fase puramente cinemática: las partículas siguen la trayectoria (posición y velocidad), sin resolver nada
        const hf = 1 / n;
        for (let q = 0; q < NP * 3; q++) { X[q] = TG1[q]; Xp[q] = TG1[q] - (TG1[q] - TG0[q]) * hf; }
      } else {
        XF.set(X);
        for (let s = 0; s < n; s++) {
          const a = (s + 1) / n;
          doSelf = kNow < 0.85 && s >= n - 2; // autocolisión en los dos últimos sub-pasos (cuando ya manda la física)
          substep(h, s === 0 ? lastH : h, lerp(kPrev, kNow, a), a);
        }
        doSelf = false;
      }
      lastH = h;
      const _t3 = performance.now(); perf.sim += _t3 - _t2;
      simTime += dt;
      // pliegues residuales se relajan
      if (t > K0()) for (let i = 0; i < NST; i++) PLE[i] *= Math.exp(-dt * 3);
      blendK = kNow;
      renderCollide = kNow < 0.999;
      computeStations();
      writeMesh(frameBlend);
      perf.mesh += performance.now() - _t3; perf.n++;
      // reposo
      if (t > K1() && !handActive) {
        let maxV = 0;
        for (let p = 0; p < NP; p++) {
          const q = p * 3;
          // lo que queda aprisionado bajo el pergamino (invisible) no impide el reposo
          if (envState.collideRolls && X[q + 2] < zBot + 0.002 && Math.abs(X[q + 1] - yK) < HALF_GAP + R * 0.8 && Math.abs(X[q]) < ROLL_HALF) continue;
          maxV = Math.max(maxV, Math.abs(X[q] - Xp[q]), Math.abs(X[q + 1] - Xp[q + 1]), Math.abs(X[q + 2] - Xp[q + 2]));
        }
        const vel = maxV / h;
        if (vel < 0.003 + settleFx * 0.004) settleT += dt; else settleT = 0;
        if (state === 'untying') state = 'falling';
        const done = t >= D && (settleT > 0.25 || t > D + 0.6);
        if (done && pending) { const p = pending; pending = null; p(); }
        if (settleT > 0.6 || t > D * 1.05 + 3) { state = 'settled'; if (pending) { const p = pending; pending = null; p(); } }
      }
    },

    wake() { if (state === 'settled') { state = 'falling'; settleT = 0; } },

    // Suelta la cinta del pergamino: la re-cuelga de `parent` (p. ej. el grupo de la mesa) conservando su transformación
    // de mundo, congela gravedad/plano de la mesa en ese marco y deja de chocar con los rollos → lo que descansaba sobre
    // el pergamino cae a la mesa mientras este se levanta. Llamar cuando el pergamino empieza a elevarse.
    detach(parent) {
      if (parent && group.parent !== parent) parent.attach(group);
      detached = true; envState.collideRolls = false;
      if (state === 'settled') { state = 'falling'; settleT = 0; }
      if (state === 'falling') t = Math.min(t, D * 1.05 + 0.15); // vuelve a simular (caída libre) antes del reposo forzado
    },
    get detached() { return detached; },

    // depuración / pruebas
    _debug: { perf, params, buildControls, get path() { return path; }, get X() { return X; }, profile, loopALen, tailALen },

    dispose() {
      group.removeFromParent();
      geom.dispose(); material.dispose(); tex.normalMap.dispose(); tex.detailMap.dispose();
      if (pending) { const p = pending; pending = null; p(); }
    },
  };
  return api;
}
