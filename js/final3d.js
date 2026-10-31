// FINAL · Ahuayro al atardecer (SPEC, decisión del usuario n.º 6). Módulo auto-montable: no lo llama main.js.
//
// La foto del usuario (assets/photos/ahuayro.jpg, preparada por tools/final/preparar_ahuayro.py) llena la sección como un
// paisaje vivo en WebGL:
//   · PARALLAX DE PROFUNDIDAD con el mapa de profundidad (cielo lejos, montañas, valle y primer plano): mouse o giroscopio y
//     el scroll (acercamiento suave + las capas cercanas suben más rápido). Dos pasadas de punto fijo → sin desgarros.
//   · Cielo vivo: la franja de cielo "rellenada" detrás de las montañas se desliza despacio (nubes que se mueven SOLO en el
//     cielo, detrás de las crestas) y respira con un flujo leve. Arriba de la foto el cielo se extiende (espejo + degradado).
//   · Transición mágica desde el fondo oscuro de la página: el paisaje se revela de lejos hacia cerca (primero el cielo,
//     luego las montañas, el valle y el primer plano) con un filo de luz dorada.
//   · LA SORPRESA: al quedar la sección en pantalla, el día pasa a un ATARDECER DORADO (cielo en degradado oro→rosa→violeta→
//     índigo, nubes encendidas desde abajo, sol que baja tras la cresta, luz rasante en las crestas, valle en penumbra azul,
//     lecho del río con reflejos de oro) y las LUCES DEL PUEBLO (posiciones de techos detectadas en la foto) se encienden una a
//     una y titilan; luciérnagas y polvo de oro.
// El progreso del atardecer = máx(tiempo desde que se ve la sección, scroll dentro de la sección), con velocidad acotada.
// Al salir de la sección hacia arriba vuelve al día y la sorpresa se repite al volver.
// Sin WebGL / ?nogl=1 / render por software → la <img> con degradados CSS (.finale.is-img). Movimiento reducido → sin parallax,
// sin deriva de nubes ni partículas; el atardecer llega con un fundido corto.
// Solo dibuja cuando la sección es visible y la pestaña también; calidad automática (DPR) si baja el fps.
//
// API: window.__inv.final = { mode, fps, quality, k, reveal, ready, replay(), dispose(),
//                             debug: { setK(v|null), setReveal(v|null), time(), state() } }
// Parámetros: ?nogl=1 · ?reduced=1 · ?sw=1 (permite render por software) · ?final=off (fuerza la imagen) ·
//             ?fk=0..1 (fija el atardecer) · ?fr=0..1 (fija el revelado) · ?fq=0..2 (fija la calidad)

const QS = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
const REDUCED = QS.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const NO_GL = QS.has('nogl') || QS.get('final') === 'off';
const ALLOW_SW = QS.get('sw') === '1';
const COARSE = matchMedia('(pointer: coarse)').matches;
const FIX_K = QS.has('fk') ? +QS.get('fk') : null;
const FIX_R = QS.has('fr') ? +QS.get('fr') : null;
const FIX_Q = QS.has('fq') ? +QS.get('fq') : null;
const ROOT = new URL('../', import.meta.url);
const asset = p => new URL(p, ROOT).href;
const META_URL = 'assets/photos/ahuayro.json';

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const hexLin = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  if (!m) return [0.12, 0.3, 0.7];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
};

// Calidad: DPR máximo por nivel (escritorio / móvil)
const TIERS = [
  { dpr: 1.0, dust: 0.6 },
  { dpr: 1.25, dust: 0.85 },
  { dpr: COARSE ? 1.5 : 1.75, dust: 1 },
];

/* ======================================================================================================================== */
/* Encuadre: dónde va la foto en la pantalla (px CSS, origen arriba a la izquierda)                                           */
/* ======================================================================================================================== */
/** La foto ocupa todo el ancho (con 4 % de margen para el parallax) y se apoya abajo; en vertical cubre al menos el 60 % del
 *  alto, centrada en el encuadre del pueblo y el río (meta.foco). Arriba de la foto el cielo se extiende. */
export function photoRect(W, H, aspect, focusX = 0.5, zoom = 1, anchorY = 0.75) {
  const portrait = H > W * 1.05;
  const minFrac = portrait ? 0.6 : 0.5;
  let w = W * 1.04, h = w / aspect;
  if (h < H * minFrac) { h = H * minFrac; w = h * aspect; }
  let x = W / 2 - focusX * w;
  x = Math.min(-W * 0.02, Math.max(W * 1.02 - w, x));
  let y = H - h + H * 0.012;
  if (zoom !== 1) {                     // acercamiento anclado al encuadre (pueblo)
    const ax = x + focusX * w, ay = y + anchorY * h;
    w *= zoom; h *= zoom; x = ax - focusX * w; y = ay - anchorY * h;
    x = Math.min(-W * 0.02, Math.max(W * 1.02 - w, x));
    y = Math.max(H * 1.012 - h, y);
  }
  return { x, y, w, h, portrait };
}

/* ======================================================================================================================== */
/* Shaders                                                                                                                   */
/* ======================================================================================================================== */
const VERT_BG = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FRAG_BG = /* glsl */`
precision highp float;
uniform sampler2D uPhoto, uSkyTex, uMaps, uExtra;
uniform vec2 uView;          // px CSS del lienzo
uniform vec4 uRect;          // foto en px CSS: x, y (arriba-izq), ancho, alto
uniform float uBand;         // fracción del alto de la foto que cubre la franja de cielo
uniform float uHasSky, uHasExtra, uHorizon;
uniform vec2 uPar;           // desplazamiento de parallax (unidades de la foto) para profundidad 0 (lo más cercano)
uniform float uTime, uK, uDusk, uReveal, uDrift, uSunAmt, uFlow, uStars, uGlow;
uniform vec2 uSun;           // centro del sol (coords de la foto, y hacia abajo)
uniform vec3 uSkyTop, uBg;   // color del cielo arriba (lineal) · fondo de la página (lineal)
uniform vec4 uShoot;         // estrella fugaz: cabeza (x, y) y vector cabeza→cola (coords de la foto)
uniform float uShootA;       // brillo de la estrella fugaz (0 = apagada)
uniform float uDebug;        // ?fdbg=1 cielo · 2 profundidad · 3 crestas · 4 río · 5 nube (cielo) · 6 sombra que sube
varying vec2 vUv;

vec2 tuv(vec2 p) { return vec2(p.x, 1.0 - p.y); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
float depthAt(vec2 p) { return p.y < 0.0 ? 1.0 : texture2D(uMaps, tuv(clamp(p, 0.0, 1.0))).r; }
vec3 toSRGB(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// cielo de día. En la foto: la franja de cielo se desliza (detrás de las montañas está rellenada; pegado a las crestas casi no
// se mueve). Arriba de la foto (pantallas verticales): el cielo SIGUE hacia el cenit (azul más hondo) con nubes suaves que
// derivan; en el borde se funde con la foto (sin espejo visible).
vec3 daySky(vec2 q) {
  float hh = (uHorizon - q.y) / max(uHorizon, 0.08);
  float drift = uDrift * smoothstep(0.02, 0.6, hh);
  float band = max(uBand, 0.02);
  float e = max(-q.y, 0.0);                                  // altura sobre la foto (en altos de la foto)
  vec3 c;
  if (e <= 0.0) {
    vec2 st = vec2(q.x + drift, 1.0 - clamp(q.y / band, 0.0, 0.995));
    vec2 fl = q * vec2(2.6, 5.0);
    st += (vec2(vnoise(fl + uTime * 0.035), vnoise(fl + 17.3 - uTime * 0.03)) - 0.5) * 0.007 * uFlow;
    c = texture2D(uSkyTex, st).rgb;
  } else {
    // pegado al borde: espejo (continuo con la foto); más arriba, el mismo cielo AMPLIADO (nubes más grandes y cercanas,
    // sin llegar a la parte rellenada) que se funde con el azul del cenit
    vec3 m = texture2D(uSkyTex, vec2(q.x + drift, 1.0 - min(e / band, 0.5)), clamp(e * 28.0, 0.0, 2.5)).rgb;
    vec2 st2 = vec2(0.5 + (q.x - 0.5) * 0.58 + 0.19 + drift * 0.8, 1.0 - min(e / band * 0.5, 0.6));
    vec3 s2 = texture2D(uSkyTex, st2, clamp(0.6 + e * 5.0, 0.0, 3.5)).rgb;
    c = mix(m, s2, smoothstep(0.0, 0.09, e));
    vec3 zen = uSkyTop * vec3(0.36, 0.56, 1.0);
    c = mix(c, zen, smoothstep(0.06, 0.75, e) * 0.92);
  }
  return c;
}

// degradado del atardecer: h = 0 en el horizonte, 1 arriba de la foto, > 1 en la extensión
vec3 sunsetGrad(float h) {
  vec3 c0 = vec3(1.00, 0.55, 0.18);   // oro del horizonte
  vec3 c1 = vec3(0.99, 0.32, 0.12);   // durazno
  vec3 c2 = vec3(0.66, 0.16, 0.26);   // rosa
  vec3 c3 = vec3(0.19, 0.10, 0.36);   // violeta
  vec3 c4 = vec3(0.035, 0.04, 0.17);  // índigo
  vec3 c = mix(c0, c1, smoothstep(0.0, 0.16, h));
  c = mix(c, c2, smoothstep(0.12, 0.4, h));
  c = mix(c, c3, smoothstep(0.36, 0.85, h));
  c = mix(c, c4, smoothstep(0.85, 1.75, h));
  return c;
}

// estrellas (primeras de la noche) en el cielo alto: rejilla en px de la foto, titilan
float stars(vec2 q) {
  vec2 g = q * uRect.zw / 23.0;
  vec2 id = floor(g), f = fract(g);
  float h = hash(id);
  vec2 c = vec2(hash(id + 7.13), hash(id + 3.71)) * 0.76 + 0.12;
  float d = length(f - c) * 23.0;                            // px CSS
  float big = step(0.93, h);
  float tw = 0.55 + 0.45 * sin(uTime * (1.3 + fract(h * 31.0) * 2.6) + h * 40.0);
  return step(0.8, h) * exp(-d * d / (0.6 + big * 1.1)) * (0.3 + 0.7 * fract(h * 13.7) + big * 0.8) * tw;
}

void main() {
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y) * uView;
  vec2 pp = (sp - uRect.xy) / uRect.zw;                     // coords de la foto (0..1, y hacia abajo)
  // parallax por profundidad (punto fijo, 2 pasadas)
  float d = depthAt(pp);
  vec2 q = pp - uPar * (1.0 - d);
  d = depthAt(q);
  q = pp - uPar * (1.0 - d);
  vec2 qc = clamp(q, vec2(0.0), vec2(1.0));
  vec3 maps = q.y < 0.0 ? vec3(1.0, 1.0, 0.0) : texture2D(uMaps, tuv(qc)).rgb;
  float depth = maps.r, skyA = maps.g * uHasSky, crest = maps.b;
  if (q.y < 0.0) skyA = 1.0;
  vec3 photo = texture2D(uPhoto, tuv(qc)).rgb;
  vec3 ex = (uHasExtra > 0.5 && q.y >= 0.0) ? texture2D(uExtra, tuv(qc)).rgb : vec3(0.0);

  // ---------- día
  vec3 sky = daySky(q);
  vec3 day = mix(photo, sky, skyA);

  // ---------- atardecer
  float hz = max(uHorizon, 0.08);
  float h = (hz - q.y) / hz;                                // 0 en el horizonte, 1 arriba
  vec2 sd = (q - uSun) * vec2(uRect.z / uRect.w, 1.0);
  float sr = length(sd);
  // el atardecer se extiende desde el sol hacia afuera (el oro llega primero cerca del sol)
  float kk = clamp(uK * 1.5 - sr * 0.22 - 0.04, 0.0, 1.0);
  // nubes del cielo (blancas/grises) → encendidas en rosa y oro desde abajo, sombras violetas
  float mx = max(sky.r, max(sky.g, sky.b)), mn = min(sky.r, min(sky.g, sky.b));
  float sat = (mx - mn) / max(mx, 1e-3);
  float lum = luma(sky);
  float cloud = max(smoothstep(0.5, 0.12, sat) * smoothstep(0.12, 0.5, lum), smoothstep(0.58, 0.86, lum));
  // nubes con volumen: partes iluminadas en oro y rosa (oro blanco junto al sol), cuerpo en sombra violeta; así se leen
  // sobre el degradado (antes, junto al horizonte, quedaban del mismo naranja que el fondo y desaparecían)
  vec3 cLit = mix(vec3(1.0, 0.64, 0.34), vec3(0.98, 0.42, 0.44), smoothstep(0.12, 0.85, h));
  cLit = mix(cLit, vec3(0.7, 0.42, 0.66), smoothstep(0.8, 1.5, h));
  cLit = mix(cLit, vec3(1.0, 0.88, 0.62), exp(-sr * 4.5) * 0.9);
  vec3 cDark = mix(vec3(0.46, 0.25, 0.42), vec3(0.17, 0.1, 0.3), smoothstep(0.3, 1.3, h));
  float litA = smoothstep(0.22, 0.92, lum);
  vec3 cloudCol = mix(cDark, cLit, litA) * (0.56 + 0.62 * lum);
  vec3 gradC = sunsetGrad(max(h, 0.0));
  vec3 skyS = mix(gradC, cloudCol, cloud * (1.0 - smoothstep(0.9, 1.5, h) * 0.85));
  // primeras estrellas (cielo alto, entre nubes)
  if (uStars > 0.001) skyS += vec3(1.0, 0.95, 0.86) * stars(q) * uStars * smoothstep(0.75, 1.45, h) * (1.0 - cloud * 0.95);
  // sol que baja tras la cresta + halo + rayos
  float core = smoothstep(0.042, 0.016, sr);
  float halo = exp(-sr * 11.0) * 0.9 + exp(-sr * 3.2) * 0.42 + exp(-sr * 1.1) * 0.06;
  float ang = atan(sd.y, sd.x);
  float rays = pow(vnoise(vec2(cos(ang), sin(ang)) * 7.0 + uTime * 0.04), 3.0) * exp(-sr * 2.9) * smoothstep(0.03, 0.12, sr) * 0.5;
  vec3 sunC = vec3(1.0, 0.8, 0.5);
  skyS += vec3(1.0, 0.95, 0.82) * core * 1.6 * skyA * uSunAmt;
  skyS += sunC * (halo + rays * skyA) * uSunAmt;

  // terreno: las sombras de nubes junto a las crestas se igualan; balance cálido con sombras violetas (no cian)
  vec3 pl = photo * (1.0 + ex.g * 1.5);
  float tl = luma(pl);
  vec3 t = pl * vec3(1.14, 0.9, 0.7);
  t *= mix(vec3(0.7, 0.58, 1.0), vec3(1.18, 1.0, 0.8), smoothstep(0.02, 0.32, tl));
  float side = 0.55 + 0.45 * exp(-abs(q.x - uSun.x) * 1.6);
  // luz rasante en las crestas, más intensa cerca del sol (contraluz)
  t += vec3(1.0, 0.55, 0.2) * crest * (0.55 + 0.6 * exp(-sr * 2.4)) * side * (1.0 - 0.35 * uDusk);
  // capas lejanas: bruma luminosa lavanda-durazno (separa las cordilleras como en una foto de atardecer)
  vec3 hazeC = mix(vec3(0.56, 0.34, 0.56), vec3(1.0, 0.56, 0.34), 0.25 + 0.6 * side);
  float skyNear = max(texture2D(uMaps, tuv(clamp(qc - vec2(0.0, 0.035), 0.0, 1.0))).g, texture2D(uMaps, tuv(clamp(qc - vec2(0.0, 0.075), 0.0, 1.0))).g * 0.75);
  float hzA = max(smoothstep(0.55, 0.97, depth) * 0.5, skyNear * 0.42) * (1.0 - skyA);
  t = mix(t, hazeC * (0.7 + 0.45 * tl), hzA);
  t *= mix(0.72, 1.0, smoothstep(0.12, 0.75, depth));
  // sin cian: lo verde-azulado (bruma azul de la foto) pasa a azul lavanda
  float teal = smoothstep(0.0, 0.08, min(t.g, t.b) - t.r);
  t = mix(t, vec3(luma(t)) * vec3(0.92, 0.86, 1.2), teal * 0.75);
  t += sunC * halo * 0.22 * uSunAmt;
  // crepúsculo: la sombra SUBE desde el fondo del valle; las alturas guardan la última luz dorada
  float line = uDusk * 1.18 - 0.08;
  float shd = smoothstep(line + 0.1, line - 0.1, depth);
  t *= mix(1.0, mix(0.5, 0.82, smoothstep(0.35, 0.95, depth)), shd);
  t = mix(t, t * vec3(0.86, 0.84, 1.12), shd * 0.7);
  float last = exp(-pow((depth - line - 0.09) / 0.08, 2.0)) * smoothstep(0.02, 0.15, uDusk) * (1.0 - smoothstep(0.9, 1.1, line));
  t += vec3(1.0, 0.6, 0.26) * last * (0.05 + 0.3 * tl) * (1.0 - skyA);
  // lecho del río: refleja el oro y el rosa del cielo (sigue luminoso en el valle en penumbra), con brillos que corren
  float rv = ex.r;
  if (rv > 0.004) {
    vec3 refl = mix(vec3(1.0, 0.48, 0.42), vec3(1.0, 0.68, 0.34), side) * mix(0.55, 0.8, uDusk);
    float sh = 0.62 + 0.38 * vnoise(vec2(q.x * 70.0 - uTime * 0.45, q.y * 260.0));
    // destellos alargados (ondas que reflejan el sol), lentos aguas abajo
    float gl = smoothstep(0.74, 1.0, vnoise(vec2(q.x * 46.0 - uTime * 0.35, q.y * 900.0))) * smoothstep(0.3, 0.9, vnoise(vec2(q.x * 9.0 + uTime * 0.1, q.y * 40.0)));
    vec3 rc = refl * (0.5 + 0.55 * tl) * sh + vec3(1.0, 0.88, 0.62) * gl * (0.5 + 0.7 * side);
    t = mix(t, rc, rv * 0.7);
  }
  // resplandor cálido del pueblo cuando se encienden sus luces
  t += vec3(1.0, 0.56, 0.24) * ex.b * uGlow * (0.075 + 0.02 * sin(uTime * 1.7));
  skyS *= mix(1.0, 0.9, uDusk);
  vec3 sunset = mix(t, skyS, skyA);

  vec3 col = mix(day, sunset, smoothstep(0.0, 1.0, kk));
  // estrella fugaz (una vez, cuando ya brillan las luces del pueblo)
  if (uShootA > 0.001) {
    vec2 asp = vec2(uRect.z / uRect.w, 1.0);
    vec2 pa = (q - uShoot.xy) * asp, ba = uShoot.zw * asp;
    float u = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float dd = length(pa - ba * u) * uRect.w;
    float s = exp(-dd * dd / 1.6) * pow(1.0 - u, 2.2) + exp(-dot(pa, pa) * uRect.w * uRect.w / 9.0) * 0.8;
    col += vec3(1.0, 0.93, 0.8) * s * uShootA * skyA;
  }
  if (uDebug > 0.5) {
    float v = uDebug < 1.5 ? skyA : uDebug < 2.5 ? depth : uDebug < 3.5 ? crest : uDebug < 4.5 ? rv : uDebug < 5.5 ? cloud : shd;
    gl_FragColor = vec4(vec3(v), 1.0); return;
  }

  // ---------- revelado mágico desde el fondo oscuro: de lejos (cielo) hacia cerca, con filo de luz dorada
  if (uReveal < 0.999) {
    float m = (1.0 - depth) * 0.8 + fbm(pp * vec2(3.2, 2.4) + 4.1) * 0.24 - 0.08;
    float R = uReveal * 1.2 - 0.06;
    float vis = smoothstep(m - 0.03, m + 0.03, R);
    float edge = exp(-pow((R - m) / 0.022, 2.0)) * (1.0 - smoothstep(0.82, 1.0, uReveal)) * step(0.001, uReveal);
    float spark = smoothstep(0.82, 1.0, vnoise(sp * 0.35 + uTime * 3.0)) * 1.6;
    col = mix(uBg, col, vis) + vec3(1.0, 0.72, 0.32) * edge * (0.75 + spark);
  }

  vec3 o = toSRGB(col);
  o += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;   // tramado: sin bandas en los degradados
  gl_FragColor = vec4(o, 1.0);
}`;

// Luces del pueblo (sprites aditivos): posición en coords de la foto, parallax con la misma profundidad
const VERT_LIGHTS = /* glsl */`
attribute vec4 aInfo;        // tamaño, orden de encendido 0..1, fase, calidez
uniform vec2 uView; uniform vec4 uRect; uniform vec2 uPar; uniform float uDpr, uTime, uLights, uScale, uReveal, uBeat;
uniform sampler2D uMaps;
varying float vA; varying vec3 vCol;
void main() {
  vec2 p = position.xy;
  float d = texture2D(uMaps, vec2(p.x, 1.0 - p.y)).r;
  vec2 q = p + uPar * (1.0 - d);
  vec2 sp = uRect.xy + q * uRect.zw;
  gl_Position = vec4(sp.x / uView.x * 2.0 - 1.0, 1.0 - sp.y / uView.y * 2.0, 0.0, 1.0);
  float on = smoothstep(aInfo.y, aInfo.y + 0.03, uLights);
  float x = (uLights - aInfo.y - 0.035) / 0.03;
  float pop = exp(-x * x);
  float tw = 0.8 + 0.2 * sin(uTime * (1.3 + aInfo.w * 2.1) + aInfo.z) * sin(uTime * 0.71 + aInfo.z * 2.3);
  tw *= 0.92 + 0.08 * sin(uTime * 9.0 + aInfo.z * 11.0);
  vA = on * tw * (1.0 + pop * 1.1 + uBeat * 0.3) * smoothstep(0.85, 1.0, uReveal);
  gl_PointSize = max(1.0, aInfo.x * uScale * uDpr * (1.0 + pop * 0.6));
  vCol = mix(vec3(1.0, 0.66, 0.28), vec3(1.0, 0.84, 0.52), aInfo.w);
}`;
const FRAG_LIGHTS = /* glsl */`
precision highp float;
varying float vA; varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);
  if (r2 > 1.0 || vA < 0.002) discard;
  float a = (exp(-r2 * 30.0) * 1.6 + exp(-r2 * 6.0) * 0.42 + exp(-r2 * 1.8) * 0.14) * vA;
  gl_FragColor = vec4(mix(vCol, vec3(1.0, 0.97, 0.9), exp(-r2 * 60.0)), a);
}`;

// Luciérnagas (abajo, en el valle) y polvo de oro (toda la escena): movimiento procedural en la GPU
const VERT_DUST = /* glsl */`
attribute vec4 aSeed; attribute float aType;
uniform vec2 uView; uniform vec4 uRect; uniform vec2 uPar; uniform float uDpr, uTime, uK, uReveal, uScale, uDust, uBeat, uEntry;
varying float vA; varying vec3 vCol; varying float vType;
void main() {
  float t = uTime;
  vec2 sp; float size; float a;
  if (aType < 0.5) {               // polvo de oro: sube lento por todo el lienzo
    float y = fract(aSeed.y - t * (0.006 + aSeed.w * 0.012));
    float x = fract(aSeed.x + sin(t * 0.21 + aSeed.z * 6.3) * 0.012 + t * 0.002);
    // al entrar desde la página oscura: chispas que suben desde el cielo hacia la oscuridad, en la franja del borde
    float ye = fract(aSeed.y - t * (0.05 + aSeed.w * 0.06));
    float yb = mix(y, 0.2 + ye * 0.42, uEntry);
    sp = vec2(x, yb) * uView;
    sp += uPar * uRect.zw * 0.6;
    size = (1.6 + aSeed.z * 3.2) * uScale * (1.0 + uEntry * 1.3);
    float tw = 0.5 + 0.5 * sin(t * (1.0 + aSeed.w * 2.5) + aSeed.x * 40.0);
    a = (0.18 + 0.55 * tw * tw) * smoothstep(0.0, 0.12, yb) * smoothstep(1.0, 0.85, yb);
    float aDay = (0.35 + 0.65 * uK) * smoothstep(0.3, 1.0, uReveal);
    float aIn = smoothstep(0.0, 0.25, ye) * smoothstep(1.0, 0.55, ye) * 2.8;
    a *= mix(aDay, aIn, uEntry) * uDust * (1.0 + uBeat * 0.5);
    vCol = mix(mix(vec3(1.0, 0.84, 0.5), vec3(1.0, 0.95, 0.8), aSeed.w), vec3(1.0, 0.72, 0.3), uEntry * 0.7);
  } else {                          // luciérnagas: en el valle cercano, deriva errática y parpadeo
    // en pantalla: franja baja del paisaje (valle cercano), con deriva errática
    float y0 = max(uRect.y + uRect.w * 0.6, uView.y * 0.55);
    sp = vec2(aSeed.x * uView.x, mix(y0, uView.y * 1.02, aSeed.y));
    sp.x += (sin(t * (0.16 + aSeed.z * 0.22) + aSeed.w * 6.3) * 0.035 + sin(t * 0.53 + aSeed.y * 9.0) * 0.01) * uView.x;
    sp.y += cos(t * (0.13 + aSeed.w * 0.2) + aSeed.z * 5.1) * 0.03 * uView.y;
    sp += uPar * uRect.zw;
    float b = pow(max(0.0, sin(t * (0.55 + aSeed.z * 0.8) + aSeed.w * 12.0)), 5.0);
    size = (6.0 + aSeed.z * 9.0) * uScale;
    a = (0.08 + 0.92 * b) * smoothstep(0.62, 0.92, uK) * uDust;
    vCol = mix(vec3(1.0, 0.86, 0.38), vec3(0.85, 1.0, 0.48), aSeed.y);
  }
  vA = a; vType = aType;
  gl_Position = vec4(sp.x / uView.x * 2.0 - 1.0, 1.0 - sp.y / uView.y * 2.0, 0.0, 1.0);
  gl_PointSize = max(1.0, size * uDpr);
}`;
const FRAG_DUST = /* glsl */`
precision highp float;
varying float vA; varying vec3 vCol; varying float vType;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c);
  if (r2 > 1.0 || vA < 0.003) discard;
  float a = vType < 0.5 ? exp(-r2 * 7.0) : (exp(-r2 * 26.0) * 1.3 + exp(-r2 * 4.0) * 0.32);
  gl_FragColor = vec4(vCol, a * vA);
}`;

/* ======================================================================================================================== */
/* Montaje                                                                                                                   */
/* ======================================================================================================================== */
function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
    im.onerror = () => rej(new Error('no se pudo cargar ' + src));
    im.src = src;
  });
}

function publish(api) { try { (window.__inv ||= {}).final = api; } catch { /* sin ganchos */ } }

export async function mountFinal(section, opts = {}) {
  const reduced = opts.reducedMotion ?? REDUCED;
  const bg = section.querySelector('.finale__bg');
  const stage = section.querySelector('.finale__stage');
  const img = section.querySelector('.finale__photo');
  let resolveReady;
  const api = {
    mode: 'init', fps: 0, quality: 0, k: 0, reveal: 0,
    ready: new Promise(r => { resolveReady = r; }),
    replay() {}, dispose() {},
    debug: { setK() {}, setReveal() {}, time: () => 0, state: () => ({}) },
  };
  publish(api);
  if (reduced) section.classList.add('is-rm');

  let meta = null;
  try {
    const r = await fetch(asset(META_URL), { cache: 'no-cache' });
    if (r.ok) meta = await r.json();
  } catch { meta = null; }
  const aspect = meta?.aspecto || (img?.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 2000 / 921);
  const focusX = meta?.foco?.x ?? 0.5;
  if (meta?.colores?.cielo) section.style.setProperty('--fin-sky', meta.colores.cielo);
  if (meta?.colores?.cieloArriba) section.style.setProperty('--fin-sky-top', meta.colores.cieloArriba);

  // ---------- encuadre compartido (la <img> de respaldo usa el mismo que el WebGL)
  let vw = 0, vh = 0, secTop = 0, secH = 0;
  const measure = () => {
    const r = bg.getBoundingClientRect();
    vw = Math.max(1, Math.round(r.width)); vh = Math.max(1, Math.round(r.height));
    const s = section.getBoundingClientRect();
    secTop = s.top + scrollY; secH = s.height;
    if (img) {
      const R = photoRect(vw, vh, aspect, focusX);
      img.style.cssText = `left:${R.x.toFixed(1)}px;top:${R.y.toFixed(1)}px;width:${R.w.toFixed(1)}px;height:${R.h.toFixed(1)}px`;
      section.style.setProperty('--fin-photo-top', Math.max(0, R.y).toFixed(1) + 'px');
      section.style.setProperty('--fin-hz', (R.y + (meta?.horizonte ?? 0.35) * R.h).toFixed(1) + 'px');
    }
  };
  measure();

  // ---------- modo imagen (sin WebGL): la foto con degradados CSS; el atardecer CSS llega al entrar
  const useImg = (why) => {
    if (why) console.info('[final] imagen:', why);
    section.classList.add('is-img'); section.classList.remove('is-gl');
    api.mode = 'img';
    let t0 = 0, raf = 0;
    const tick = (now) => {
      raf = 0;
      if (!t0) t0 = now;
      const k = reduced ? 1 : sstep(0, 1, (now - t0) / 6500);
      section.style.setProperty('--fk', k.toFixed(3));
      api.k = k;
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        if (e.isIntersecting && e.intersectionRatio > 0.35 && !t0 && !raf) raf = requestAnimationFrame(tick);
        if (!e.isIntersecting && e.boundingClientRect.top > 0) { if (raf) cancelAnimationFrame(raf); raf = 0; t0 = 0; section.style.setProperty('--fk', '0'); }
      }
    }, { threshold: [0, 0.35] });
    io.observe(section);
    addEventListener('resize', measure, { passive: true });
    api.dispose = () => io.disconnect();
    resolveReady(api);
    return api;
  };
  if (NO_GL || !meta || !stage) return useImg(NO_GL ? 'parámetro' : !meta ? 'sin ahuayro.json' : 'sin escenario');

  // ---------- WebGL
  let THREE;
  try { THREE = await import('three'); } catch (e) { return useImg('three.js no disponible'); }
  const canvas = document.createElement('canvas');
  canvas.className = 'finale__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !ALLOW_SW,
    });
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    if (!ALLOW_SW && /SwiftShader|llvmpipe|softpipe|Basic Render|Software Rasterizer/i.test(name)) throw new Error('render por software (' + name + ')');
  } catch (e) {
    try { renderer?.dispose(); } catch {}
    return useImg(e?.message || 'sin WebGL');
  }
  renderer.setClearColor(0x120c09, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // texturas: escritorio o móvil según los píxeles que de verdad se ven
  const files = meta.archivos || {};
  const need = () => photoRect(vw, vh, aspect, focusX).w * Math.min(devicePixelRatio || 1, 2);
  const big = need() > (meta.tam?.sm?.[0] || 1280) * 1.05;
  const pick = (lg, sm) => asset('assets/photos/' + (big ? files[lg] : files[sm]));
  const texOf = (im, srgb, mip, wrapS) => {
    const t = new THREE.Texture(im);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = !!mip;
    t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = wrapS || THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  let tPhoto, tSky, tMaps, tExtra;
  try {
    const [iPhoto, iMaps, iSky, iExtra] = await Promise.all([
      loadImage(pick('lg', 'sm')),
      loadImage(asset('assets/photos/' + files.mapas)),
      files.cieloLg ? loadImage(pick('cieloLg', 'cieloSm')) : Promise.resolve(null),
      files.extra ? loadImage(asset('assets/photos/' + files.extra)).catch(() => null) : Promise.resolve(null),
    ]);
    tPhoto = texOf(iPhoto, true, true);
    tMaps = texOf(iMaps, false, false);
    tSky = iSky ? texOf(iSky, true, true, THREE.MirroredRepeatWrapping) : tPhoto;
    tExtra = iExtra ? texOf(iExtra, false, false) : null;
  } catch (e) {
    try { renderer.dispose(); } catch {}
    return useImg(e?.message);
  }
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const skyTop = hexLin(meta.colores?.cieloArriba || meta.colores?.cielo || '#4f86c8');
  const U = {
    uPhoto: { value: tPhoto }, uSkyTex: { value: tSky }, uMaps: { value: tMaps }, uExtra: { value: tExtra || black },
    uView: { value: new THREE.Vector2(1, 1) }, uRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uBand: { value: meta.franjaCielo || 0.4 }, uHasSky: { value: files.cieloLg ? 1 : 0 }, uHasExtra: { value: tExtra ? 1 : 0 },
    uHorizon: { value: meta.horizonte || 0.35 },
    uPar: { value: new THREE.Vector2(0, 0) }, uTime: { value: 0 }, uK: { value: 0 }, uDusk: { value: 0 },
    uReveal: { value: 0 }, uDrift: { value: 0 }, uSunAmt: { value: 0 }, uFlow: { value: reduced ? 0 : 1 },
    uSun: { value: new THREE.Vector2(0.75, 0.3) }, uStars: { value: 0 }, uGlow: { value: 0 },
    uShoot: { value: new THREE.Vector4(0, 0, 0, 0) }, uShootA: { value: 0 },
    uSkyTop: { value: new THREE.Vector3(...skyTop) }, uBg: { value: new THREE.Vector3(...hexLin('#120c09')) },
    uDebug: { value: +(QS.get('fdbg') || 0) },
  };
  const bgMat = new THREE.ShaderMaterial({ vertexShader: VERT_BG, fragmentShader: FRAG_BG, uniforms: U, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  quad.frustumCulled = false;
  scene.add(quad);

  // luces del pueblo
  const L = (meta.luces || []).slice(0, 140);
  const lg = new THREE.BufferGeometry();
  const lp = new Float32Array(L.length * 3), li = new Float32Array(L.length * 4);
  L.forEach((o, i) => { lp[i * 3] = o.x; lp[i * 3 + 1] = o.y; li[i * 4] = o.s; li[i * 4 + 1] = o.o * 0.94; li[i * 4 + 2] = o.p; li[i * 4 + 3] = o.w; });
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lg.setAttribute('aInfo', new THREE.BufferAttribute(li, 4));
  const LU = { uView: U.uView, uRect: U.uRect, uPar: U.uPar, uTime: U.uTime, uReveal: U.uReveal, uMaps: U.uMaps,
    uDpr: { value: 1 }, uLights: { value: 0 }, uScale: { value: 20 }, uBeat: { value: 0 } };
  const lMat = new THREE.ShaderMaterial({ vertexShader: VERT_LIGHTS, fragmentShader: FRAG_LIGHTS, uniforms: LU,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const lights = new THREE.Points(lg, lMat);
  lights.frustumCulled = false;
  if (L.length) scene.add(lights);

  // luciérnagas + polvo de oro
  const nDust = reduced ? 0 : COARSE ? 54 : 96, nFly = reduced ? 0 : COARSE ? 26 : 44;
  const dg = new THREE.BufferGeometry();
  const N = nDust + nFly;
  const dpos = new Float32Array(Math.max(1, N) * 3), dseed = new Float32Array(Math.max(1, N) * 4), dtype = new Float32Array(Math.max(1, N));
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < N; i++) { for (let j = 0; j < 4; j++) dseed[i * 4 + j] = rnd(); dtype[i] = i < nDust ? 0 : 1; }
  dg.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  dg.setAttribute('aSeed', new THREE.BufferAttribute(dseed, 4));
  dg.setAttribute('aType', new THREE.BufferAttribute(dtype, 1));
  const DU = { uView: U.uView, uRect: U.uRect, uPar: U.uPar, uTime: U.uTime, uK: U.uK, uReveal: U.uReveal,
    uDpr: LU.uDpr, uScale: { value: 1 }, uDust: { value: 1 }, uBeat: LU.uBeat, uEntry: { value: 0 } };
  const dMat = new THREE.ShaderMaterial({ vertexShader: VERT_DUST, fragmentShader: FRAG_DUST, uniforms: DU,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dg, dMat);
  dust.frustumCulled = false;
  if (N) scene.add(dust);

  stage.append(canvas);

  // ---------- calidad y tamaño
  let tier = FIX_Q != null ? clamp(Math.round(FIX_Q), 0, TIERS.length - 1) : TIERS.length - 1;
  let dpr = 1;
  const resize = () => {
    measure();
    dpr = Math.min(devicePixelRatio || 1, TIERS[tier].dpr);
    renderer.setPixelRatio(dpr);
    renderer.setSize(vw, vh, false);
    U.uView.value.set(vw, vh);
    LU.uDpr.value = dpr;
    DU.uDust.value = TIERS[tier].dust;
    api.quality = tier;
  };
  resize();
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { resize(); kick(); }, 90); };
  addEventListener('resize', onResize, { passive: true });
  let ro = null;
  try { ro = new ResizeObserver(() => { const t = secTop; measureSec(); if (Math.abs(t - secTop) > 1) kick(); }); ro.observe(document.querySelector('main') || document.body); } catch { ro = null; }
  function measureSec() { const s = section.getBoundingClientRect(); secTop = s.top + scrollY; secH = s.height; }

  // compila antes del primer cuadro visible
  try { renderer.compile(scene, camera); } catch {}

  // ---------- entrada del usuario: mouse / giroscopio
  const tgt = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  const onMove = e => { tgt.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1); tgt.y = clamp((e.clientY / innerHeight) * 2 - 1, -1, 1); };
  let beta0 = null;
  const onTilt = e => {
    if (e.gamma == null || e.beta == null) return;
    if (beta0 == null) beta0 = e.beta;
    tgt.x = clamp(e.gamma / 22, -1, 1); tgt.y = clamp((e.beta - beta0) / 22, -1, 1);
  };
  if (!reduced) {
    addEventListener('pointermove', onMove, { passive: true });
    if (COARSE) addEventListener('deviceorientation', onTilt, { passive: true });
  }

  // medición opcional del tiempo de GPU de este lienzo (?fgpu=1, si el navegador expone el temporizador)
  const tq = QS.has('fgpu') ? renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2') : null;
  const tqs = [];
  // ---------- estado de la animación
  // tiempos fuertes de la canción (window.__inv.music.onBeat), si está sonando
  let unBeat = null;
  const hookBeat = () => {
    if (unBeat) return;
    const m = window.__inv?.music;
    if (!m?.onBeat) return;
    try { unBeat = m.onBeat((i, time, info) => { if (info?.downbeat || i % 2 === 0) st.beat = Math.min(1.4, st.beat + (info?.downbeat ? 1 : 0.55)); }) || (() => {}); } catch { unBeat = () => {}; }
  };
  const st = {
    beat: 0,
    gpuMs: 0,
    t: 0, k: 0, reveal: 0, revealT0: -1, sunT0: -1, shootAt: -1, fixK: FIX_K, fixR: FIX_R,
    fpsN: 0, fpsT: 0, lowFor: 0, okFor: 0, ups: 0, warm: 0, lastCssK: -1, lastCssR: -1, lastFe: -1,
  };
  const reset = () => { st.k = 0; st.reveal = 0; st.revealT0 = -1; st.sunT0 = -1; st.shootAt = -1; };

  let running = false, raf = 0, last = 0, inView = false;
  const sunScreenX = () => (vh > vw * 1.05 ? 0.78 : 0.73);
  const skylineAt = x => {
    const a = meta.lineaCielo || [];
    if (!a.length) return meta.horizonte || 0.35;
    const f = clamp(x) * (a.length - 1), i = Math.floor(f), j = Math.min(a.length - 1, i + 1);
    return lerp(a[i], a[j], f - i);
  };

  function frame(now) {
    raf = 0;
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
    last = now;
    st.t += dt;
    const t = st.t;

    // progreso: entrada (0 → la sección asoma abajo, 1 → arriba del todo) y recorrido de la parte fija
    const top = secTop - scrollY;
    const ih = innerHeight || vh;
    const e = clamp(1 - top / ih);
    const s = clamp(-top / Math.max(1, secH - vh));   // vh = alto del fondo fijo (100svh)

    // revelado
    if (st.fixR != null) st.reveal = st.fixR;
    else if (reduced) st.reveal = Math.min(1, st.reveal + dt * (e > 0.05 ? 2.5 : 0));
    else {
      if (e > 0.22 && st.revealT0 < 0) st.revealT0 = t;
      const target = Math.max(sstep(0.04, 0.85, e), st.revealT0 >= 0 ? clamp((t - st.revealT0) / 2.8) : 0);
      st.reveal = st.reveal + (Math.max(st.reveal, target) - st.reveal) * Math.min(1, dt * 5);
      if (st.reveal > 0.997) st.reveal = 1;
    }
    // atardecer: primero un instante de día; luego tiempo o scroll (lo que vaya más adelante), velocidad acotada
    if (st.fixK != null) st.k = st.fixK;
    else {
      if (e > 0.8 && st.sunT0 < 0) st.sunT0 = t + (reduced ? 0 : 1.3);
      const timeK = st.sunT0 >= 0 ? clamp((t - st.sunT0) / (reduced ? 1.2 : 9.5)) : 0;
      const scrollK = clamp(s / 0.72);
      const target = Math.max(timeK, scrollK, st.k);
      const rate = reduced ? 0.9 : 0.24;
      st.k = Math.min(target, st.k + rate * dt);
    }
    const k = st.k;
    api.k = k; api.reveal = st.reveal;

    // cámara: acercamiento con el scroll (anclado al pueblo) + parallax por profundidad
    const zoom = reduced ? 1 : 1 + 0.07 * sstep(0, 1, s);
    const R = photoRect(vw, vh, aspect, focusX, zoom, meta.foco?.y ?? 0.75);
    U.uRect.value.set(R.x, R.y, R.w, R.h);
    const ease = 1 - Math.exp(-dt * 3.2);
    cur.x += (tgt.x - cur.x) * ease; cur.y += (tgt.y - cur.y) * ease;
    const breath = reduced ? 0 : Math.sin(t * 0.11) * 0.25;
    const px = reduced ? 0 : (cur.x + breath * 0.4) * 0.011;
    const py = reduced ? 0 : cur.y * 0.007 - 0.028 * sstep(0, 1, s);
    U.uPar.value.set(px, py);
    U.uTime.value = reduced ? Math.min(t, 2.5) : t;
    U.uDrift.value = reduced ? 0 : t * 0.0021;
    U.uK.value = k;
    U.uDusk.value = sstep(0.5, 1.0, k);
    U.uReveal.value = st.reveal;
    // sol: baja hacia la cresta a medida que avanza el atardecer
    const sx = clamp((sunScreenX() * vw - R.x) / R.w, 0.02, 0.98);
    const ks = sstep(0.05, 1.0, k);
    U.uSun.value.set(sx, skylineAt(sx) - lerp(0.2, 0.012, ks));
    U.uSunAmt.value = sstep(0.06, 0.45, k);
    LU.uLights.value = sstep(0.42, 0.97, k);
    U.uGlow.value = sstep(0.5, 1.0, k);
    U.uStars.value = sstep(0.8, 1.0, k);
    // estrella fugaz: la primera ~2 s después de terminar el atardecer; luego, muy de vez en cuando
    U.uShootA.value = 0;
    if (!reduced && st.fixK == null && k >= 0.999) {
      if (st.shootAt < 0) st.shootAt = t + 2.2;
      const p = (t - st.shootAt) / 1.25;
      if (p >= 0 && p <= 1) {
        // de derecha a izquierda y hacia abajo, por cielo libre (nunca detrás del monograma, la frase ni la cuenta regresiva):
        // en vertical, entre el contenido y las montañas; en horizontal, a la derecha del contenido
        const port = vh > vw * 1.05;
        const ax = vw * (port ? 0.93 : 0.97), ay = vh * (port ? 0.44 : 0.05);
        const bx = vw * (port ? 0.52 : 0.76), by = vh * (port ? 0.53 : 0.21);
        const e2 = 1 - (1 - p) * (1 - p);
        const hx = lerp(ax, bx, e2), hy = lerp(ay, by, e2);
        const tl = Math.min(1, p * 2.4) * Math.hypot(bx - ax, by - ay) * 0.45;
        const L = Math.hypot(bx - ax, by - ay) || 1;
        U.uShoot.value.set((hx - R.x) / R.w, (hy - R.y) / R.h, ((ax - bx) / L * tl) / R.w, ((ay - by) / L * tl) / R.h);
        U.uShootA.value = Math.pow(Math.sin(Math.PI * p), 0.7) * 1.4;
      } else if (p > 1) st.shootAt = t + 16 + ((t * 7.31) % 1) * 12;
    }
    if (!reduced) hookBeat();
    st.beat *= Math.exp(-dt * 3.2);
    LU.uBeat.value = st.beat; DU.uBeat.value = st.beat;
    LU.uScale.value = clamp(R.w / 2000, 0.42, 1.6) * 28;
    DU.uScale.value = clamp(Math.min(vw, vh) / 800, 0.6, 1.4);
    DU.uEntry.value = reduced ? 0 : 1 - sstep(0.55, 0.98, e);

    // variables CSS para los velos del contenido (solo si cambian)
    if (Math.abs(k - st.lastCssK) > 0.01 || (k === 1 && st.lastCssK !== 1)) { st.lastCssK = k; section.style.setProperty('--fk', k.toFixed(3)); }
    if (Math.abs(st.reveal - st.lastCssR) > 0.02 || (st.reveal === 1 && st.lastCssR !== 1)) { st.lastCssR = st.reveal; section.style.setProperty('--fr', st.reveal.toFixed(3)); }
    section.classList.toggle('is-dusk', k > 0.55);

    if (tq) {
      const gl = renderer.getContext(), qq = gl.createQuery();
      gl.beginQuery(tq.TIME_ELAPSED_EXT, qq); renderer.render(scene, camera); gl.endQuery(tq.TIME_ELAPSED_EXT); tqs.push(qq);
      while (tqs.length) {
        const q0 = tqs[0];
        if (!gl.getQueryParameter(q0, gl.QUERY_RESULT_AVAILABLE)) break;
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { const ms = gl.getQueryParameter(q0, gl.QUERY_RESULT) / 1e6; st.gpuMs = st.gpuMs ? st.gpuMs * 0.92 + ms * 0.08 : ms; }
        gl.deleteQuery(q0); tqs.shift();
      }
    } else renderer.render(scene, camera);

    // fps y calidad automática: sin contar el arranque (montajes, escritura, compilación), baja un nivel si sigue lento y
    // vuelve a subir (como mucho 2 veces) si sobra; el vidrio sin desenfoque solo en el nivel mínimo y aún lento
    st.fpsN++; st.fpsT += dt; st.warm += dt;
    if (st.fpsT >= 1) {
      api.fps = Math.round(st.fpsN / st.fpsT);
      if (FIX_Q == null && document.visibilityState === 'visible' && st.warm > 2.5) {
        if (api.fps < 46) { st.lowFor += st.fpsT; st.okFor = 0; } else { st.lowFor = 0; st.okFor = api.fps >= 57 ? st.okFor + st.fpsT : 0; }
        if (st.lowFor >= 2.5) {
          st.lowFor = 0;
          if (tier > 0) { tier--; resize(); } else section.classList.add('is-lowq');
        } else if (st.okFor >= 6 && st.ups < 2 && (tier < TIERS.length - 1 || section.classList.contains('is-lowq'))) {
          st.okFor = 0; st.ups++;
          if (section.classList.contains('is-lowq')) section.classList.remove('is-lowq'); else { tier++; resize(); }
        }
      }
      st.fpsN = 0; st.fpsT = 0;
    }
  }
  function start() { if (running) return; running = true; last = 0; st.warm = 0; st.fpsN = 0; st.fpsT = 0; raf = requestAnimationFrame(frame); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  function kick() { if (inView && !document.hidden) start(); }

  const io = new IntersectionObserver(es => {
    for (const en of es) {
      inView = en.isIntersecting;
      if (inView) { measureSec(); kick(); }
      else {
        stop();
        if (en.boundingClientRect.top > 0 && st.fixK == null) reset();   // se fue hacia arriba: la sorpresa se repite al volver
      }
    }
  }, { threshold: 0 });
  io.observe(section);
  const onVis = () => { if (document.hidden) stop(); else kick(); };
  document.addEventListener('visibilitychange', onVis);
  const onLost = e => { e.preventDefault(); stop(); };
  canvas.addEventListener('webglcontextlost', onLost);

  // primer cuadro: el lienzo aparece sobre la <img> (que queda de respaldo)
  section.classList.add('is-gl');
  api.mode = 'gl';
  renderer.render(scene, camera);

  api.replay = () => { reset(); st.revealT0 = st.t; kick(); };
  api.debug = {
    setK(v) { st.fixK = v == null ? null : clamp(+v); kick(); },
    setReveal(v) { st.fixR = v == null ? null : clamp(+v); kick(); },
    shoot() { st.shootAt = st.t + 0.05; kick(); },
    time: () => st.t,
    state: () => ({ k: st.k, reveal: st.reveal, tier, dpr, fps: api.fps, gpuMs: tq ? +st.gpuMs.toFixed(3) : 'sin temporizador (?fgpu=1)', rect: { ...U.uRect.value }, lights: L.length, files: { photo: tPhoto.image?.src, big } }),
  };
  api.dispose = () => {
    stop(); io.disconnect(); ro?.disconnect(); try { unBeat?.(); } catch {}
    removeEventListener('resize', onResize); removeEventListener('pointermove', onMove); removeEventListener('deviceorientation', onTilt);
    document.removeEventListener('visibilitychange', onVis);
    canvas.removeEventListener('webglcontextlost', onLost);
    [tPhoto, tSky, tMaps, tExtra, black].forEach(x => { try { x?.dispose(); } catch {} });
    [bgMat, lMat, dMat].forEach(m => m.dispose());
    [quad.geometry, lg, dg].forEach(g => g.dispose());
    renderer.dispose();
    canvas.remove();
    section.classList.remove('is-gl');
  };
  resolveReady(api);
  return api;
}

/* ======================================================================================================================== */
/* Auto-montaje: se prepara cuando la sección se acerca (≈ 2.5 pantallas antes)                                              */
/* ======================================================================================================================== */
/** Contenido fijo de la sección: el bloque 1 (monograma + frase) cede al bloque 2 (cuenta regresiva, fecha, botón) según el
 *  scroll dentro de la parte fija; así el texto queda siempre sobre el cielo y el pueblo nunca se tapa. También el velo
 *  superior (transición desde la página oscura). Funciona con o sin WebGL. */
/** Monograma y frase escritos a mano en oro (js/escritura.js, modo manual): se escriben cuando la sección queda fija —no
 *  mientras sube desde abajo— y la frase espera al monograma. Si la sección sale por abajo (el usuario vuelve arriba) se
 *  borran y se escriben otra vez al regresar. Sin la API de escritura, vuelven al modo "vista" (se escriben solas). */
function pluma(section) {
  const els = ['final-mono', 'final-lead'].map(id => section.querySelector(`[data-escritura="${id}"]`)).filter(Boolean);
  if (!els.length) return () => {};
  els.forEach(el => { el.dataset.escrituraModo = 'manual'; });
  const E = () => window.__inv?.escritura || window.__escritura;
  let estado = 'espera', tok = 0;
  const escribir = async () => {
    const api = E();
    if (!api?.play) { els.forEach(el => { el.dataset.escrituraModo = 'vista'; }); estado = 'listo'; return; }
    const my = ++tok;
    estado = 'escribiendo';
    for (let i = 0; i < els.length; i++) {
      const ya = els[i].dataset.escrituraEstado;
      if (ya !== 'escrito' && ya !== 'escribiendo') {
        try { await api.play(els[i]); } catch { /* la pieza queda con su texto dorado de respaldo */ }
      }
      if (my !== tok) return;
      if (i < els.length - 1) await new Promise(r => setTimeout(r, 140));
      if (my !== tok) return;
    }
    estado = 'listo';
  };
  const borrar = () => {
    tok++; estado = 'espera';
    const api = E();
    els.forEach(el => { try { api?.seek?.(el, 0); } catch { /* nada */ } });
  };
  return (e, fuera) => {
    if (estado === 'espera' && e >= 0.96) escribir();
    else if (estado !== 'espera' && fuera) borrar();
  };
}

function scrollStage(section) {
  const info = section.querySelector('.finale__info');
  const escribe = pluma(section);
  let top = 0, h = 0, last = { fe: -1, ho: -1, io: -1, on: null, fin: null }, raf = 0;
  const measure = () => { const r = section.getBoundingClientRect(); top = r.top + scrollY; h = r.height; };
  const progress = () => {
    const vh = innerHeight || 1, t = top - scrollY;
    const pin = Math.max(1, h - (section.querySelector('.finale__bg')?.offsetHeight || vh));
    return { e: clamp(1 - t / vh), s: clamp(-t / pin) };
  };
  const apply = () => {
    raf = 0;
    const { e, s } = progress();
    const fe = 1 - sstep(0.86, 1.0, e);
    const ho = 1 - sstep(0.3, 0.46, s), io = sstep(0.5, 0.66, s);
    const set = (k, v, n) => { if (Math.abs(v - last[n]) > 0.004 || ((v === 0 || v === 1) && last[n] !== v)) { last[n] = v; section.style.setProperty(k, v.toFixed(3)); } };
    set('--fe', fe, 'fe'); set('--fho', ho, 'ho'); set('--fio', io, 'io');
    const on = io > 0.04;
    if (on !== last.on) { last.on = on; section.classList.toggle('is-info', on); }
    const fin = e > 0.6;
    if (fin !== last.fin) { last.fin = fin; document.documentElement.classList.toggle('fin-on', fin); }
    escribe(e, top - scrollY > (innerHeight || 1) * 1.02);
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply); };
  measure(); apply();
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measure(); onScroll(); }, { passive: true });
  try { new ResizeObserver(() => { measure(); onScroll(); }).observe(document.querySelector('main') || document.body); } catch {}
  // teclado: si el foco entra al bloque 2 mientras no se ve, se baja hasta él
  info?.addEventListener('focusin', () => { if (!section.classList.contains('is-info')) scrollTo({ top: top + h - innerHeight, behavior: 'auto' }); });
  return { progress, measure };
}

function auto() {
  const section = document.getElementById('final');
  if (!section || section.dataset.final3d) return;
  section.dataset.final3d = '1';
  section.classList.add('is-sc');                 // diseño fijo (sin este módulo: bloques apilados de respaldo)
  scrollStage(section);
  const go = () => mountFinal(section).catch(e => {
    console.warn('[final] no se pudo montar:', e?.message || e);
    section.classList.add('is-img');
  });
  if (!('IntersectionObserver' in window)) { go(); return; }
  const near = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting)) { near.disconnect(); go(); }
  }, { rootMargin: '250% 0px 250% 0px' });
  near.observe(section);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto, { once: true }); else auto();
