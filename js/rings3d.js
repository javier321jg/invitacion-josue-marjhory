// js/rings3d.js — WEB-RINGS · Pergamino 3D (Josué & Marjhory)
// Hero de anillos en WebGL: anillo de compromiso "ring-halo" + alianza "ring-jonc" (GLB de BL-RINGS, sin Draco).
//  · Oro: MeshPhysicalMaterial con PMREM de un estudio de joyería (softboxes + tiras + bombillas, reflejos largos).
//  · Diamantes: shader propio de brillante (trazado analítico de corona/pabellón con reflexión interna total,
//    refracción por canal RGB con IOR distinto = "fuego", Fresnel exacto, obstrucción del observador).
//  · Terciopelo café, polvo de oro GPU con bokeh por profundidad, estrellas en los centros de gema,
//    onda expansiva + chispas en el "clink", post (bloom HDR → aberración cromática + ACES + viñeta + grano).
//  · Coreografía: vuelo en arcos bezier → aproximación en espiral → enhebrado (el cruce dura < 20 ms y queda bajo
//    el destello del clink, calculado con prueba de colisión real contra la malla) → vaivén amortiguado → reposo.
// Contrato (SPEC): mountRings(container, { reducedMotion, onProgress, onClink }) → { intro, setScroll, sparkle, pause, resume, dispose, fps }
// FIX compatibilidad (iPhone con iOS < 16.4 sin import maps): three y sus addons se piden por URL completa (ESM de jsDelivr con
// versión fija; cada addon importa three desde la MISMA URL /npm/three@0.170.0/+esm → una sola instancia), sin el importmap.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js/+esm';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/RenderPass.js/+esm';
import { ShaderPass } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/ShaderPass.js/+esm';
import { Pass, FullScreenQuad } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/Pass.js/+esm';

const ASSETS = new URL('../assets/', import.meta.url);
const asset = p => new URL(p, ASSETS).href;

/* ------------------------------------------------------------------------ */
/* Utilidades                                                               */
/* ------------------------------------------------------------------------ */
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOutCubic = x => 1 - Math.pow(1 - clamp01(x), 3);
const easeOutQuint = x => 1 - Math.pow(1 - clamp01(x), 5);
const easeInOutSine = x => -(Math.cos(Math.PI * clamp01(x)) - 1) / 2;
const easeInOutCubic = x => { x = clamp01(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
function bezier(p0, p1, p2, p3, t, out) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return out.set(
    a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    a * p0.y + b * p1.y + c * p2.y + d * p3.y,
    a * p0.z + b * p1.z + c * p2.z + d * p3.z);
}

/* ------------------------------------------------------------------------ */
/* Perfil de calidad                                                         */
/* ------------------------------------------------------------------------ */
function detectTier() {
  let q = null;
  try { q = new URLSearchParams(location.search).get('q'); } catch {}
  if (q === 'high' || q === 'mid' || q === 'low') return q;
  const ua = navigator.userAgent || '';
  const coarse = matchMedia?.('(pointer: coarse)').matches;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (coarse && Math.min(screen.width, screen.height) < 900);
  // FIX (iPhone): WebKit informa siempre 4 (o 2) núcleos y no tiene deviceMemory → todo iPhone salía 'low' (DPR 1 en
  // pantallas de 3×, sin bloom, gema simplificada), incluso un 15 Pro. En iOS se parte de 'mid' y la adaptación baja si hace falta.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'mid';
  const cores = navigator.hardwareConcurrency || 4, mem = navigator.deviceMemory || 4;
  if (mobile) return (cores <= 4 || mem <= 3) ? 'low' : 'mid';
  return 'high';
}
const TIERS = {
  high: { dprMax: 1.75, dprMin: 1.0, msaa: 4, dust: 1500, sparks: 720, bloom: true, env: 512, gemFull: true, targetFps: 50 },
  mid: { dprMax: 1.5, dprMin: 0.85, msaa: 4, dust: 700, sparks: 360, bloom: true, env: 256, gemFull: true, targetFps: 40 },
  low: { dprMax: 1.0, dprMin: 0.75, msaa: 2, dust: 380, sparks: 200, bloom: false, env: 256, gemFull: false, targetFps: 32 },
};

/* ------------------------------------------------------------------------ */
/* Shaders                                                                   */
/* ------------------------------------------------------------------------ */
// --- Diamante (brillante redondo; también sirve para princesa/marquesa/esmeralda con otro n.º de facetas) ---
const GEM_VERT = /* glsl */`
attribute vec3 gemC; attribute vec3 gemA; attribute vec3 gemE; attribute vec4 gemP; attribute vec4 gemQ;
varying vec3 vPos; varying vec3 vN; varying vec3 vC; varying vec3 vA; varying vec3 vE; varying vec4 vP; varying vec4 vQ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  mat3 m = mat3(modelMatrix);
  vPos = wp.xyz;
  vN = normalize(m * normal);
  vC = (modelMatrix * vec4(gemC, 1.0)).xyz;
  vA = normalize(m * gemA);
  vE = normalize(m * gemE);
  vP = gemP; vQ = gemQ;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const GEM_FRAG = /* glsl */`
precision highp float;
uniform samplerCube uEnv;
uniform mat3 uEnvRot;       // PERF: el entorno gira con la pareja (giro en el plano en vertical) → mismo reflejo que en horizontal
uniform vec3 uIor;          // IOR por canal (R,G,B) → dispersión
uniform float uBright;      // exposición propia de la gema
uniform float uSparkle;     // pulso (sparkle / beat)
uniform float uAlpha;
uniform vec3 uGold;         // color del engaste visto a través del pabellón
uniform float uObstruct;    // sombra del observador (contraste "flechas")
varying vec3 vPos; varying vec3 vN; varying vec3 vC; varying vec3 vA; varying vec3 vE; varying vec4 vP; varying vec4 vQ;

vec3 gE1; vec3 gE2; vec3 gA; vec3 gV;
float gHp; float gHc; float gRt; float gNF; float gK; float gKc; float gAl; float gBe;

vec3 toWorld(vec3 d) { return d.x * gE1 + d.y * gE2 + d.z * gA; }

float hitPav(vec3 p, vec3 d) {      // cono del pabellón: (z+hp)^2 = k^2 (x^2+y^2), z en [-hp, 0]
  float k2 = gK * gK, w = p.z + gHp;
  float A = k2 * (d.x * d.x + d.y * d.y) - d.z * d.z;
  float B = 2.0 * (k2 * (p.x * d.x + p.y * d.y) - w * d.z);
  float C = k2 * (p.x * p.x + p.y * p.y) - w * w;
  float t = 1e9;
  if (abs(A) < 1e-6) { if (abs(B) > 1e-6) { float t0 = -C / B; float z0 = p.z + t0 * d.z; if (t0 > 1e-4 && z0 <= 0.001 && z0 >= -gHp) t = t0; } return t; }
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) return t;
  float sq = sqrt(disc);
  float t0 = (-B - sq) / (2.0 * A), t1 = (-B + sq) / (2.0 * A);
  if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; }
  float z0 = p.z + t0 * d.z, z1 = p.z + t1 * d.z;
  if (t0 > 1e-4 && z0 <= 0.001 && z0 >= -gHp) return t0;
  if (t1 > 1e-4 && z1 <= 0.001 && z1 >= -gHp) return t1;
  return t;
}
float hitCrown(vec3 p, vec3 d) {    // tronco de cono de la corona: (kc - z)^2 = kc^2 (x^2+y^2), z en [0, hc]
  float k2 = gKc * gKc, w = gKc - p.z;
  float A = k2 * (d.x * d.x + d.y * d.y) - d.z * d.z;
  float B = 2.0 * (k2 * (p.x * d.x + p.y * d.y) + w * d.z);
  float C = k2 * (p.x * p.x + p.y * p.y) - w * w;
  float t = 1e9;
  if (abs(A) < 1e-6) { if (abs(B) > 1e-6) { float t0 = -C / B; float z0 = p.z + t0 * d.z; if (t0 > 1e-4 && z0 >= -0.001 && z0 <= gHc) t = t0; } return t; }
  float disc = B * B - 4.0 * A * C;
  if (disc < 0.0) return t;
  float sq = sqrt(disc);
  float t0 = (-B - sq) / (2.0 * A), t1 = (-B + sq) / (2.0 * A);
  if (t0 > t1) { float tt = t0; t0 = t1; t1 = tt; }
  float z0 = p.z + t0 * d.z, z1 = p.z + t1 * d.z;
  if (t0 > 1e-4 && z0 >= -0.001 && z0 <= gHc) return t0;
  if (t1 > 1e-4 && z1 >= -0.001 && z1 <= gHc) return t1;
  return t;
}
vec3 facetN(vec3 q, int reg) {
  float phi = atan(q.y, q.x), rho = length(q.xy);
  float sec = 6.2831853 / gNF;
  if (reg == 0) {                                   // pabellón: 8 principales + 16 de rondís inferior
    float ang = gAl, ph;
    if (rho > 0.70) { float s2 = sec * 0.5; ph = (floor(phi / s2) + 0.5) * s2; ang = gAl + 0.045; }
    else ph = floor(phi / sec + 0.5) * sec;
    return vec3(sin(ang) * cos(ph), sin(ang) * sin(ph), -cos(ang));
  }
  float ang = gBe, ph;                              // corona: estrellas + bezel + rondís superior
  if (rho > 0.86) { float s2 = sec * 0.5; ph = (floor(phi / s2) + 0.5) * s2; ang = gBe + 0.10; }
  else if (rho < gRt + 0.10) { ph = (floor(phi / sec) + 0.5) * sec; ang = gBe * 0.55; }
  else ph = floor(phi / sec + 0.5) * sec;
  return vec3(sin(ang) * cos(ph), sin(ang) * sin(ph), cos(ang));
}
vec3 envW(vec3 dl, float lod, int reg) {
  vec3 dw = toWorld(dl);
  vec3 c = textureLod(uEnv, uEnvRot * dw, lod).rgb;
  if (reg == 0) c *= uGold;                                    // por el pabellón se ve el engaste de oro
  float ob = smoothstep(0.93, 0.995, dot(dw, -gV));            // el propio observador tapa la luz (patrón de contraste)
  return c * (1.0 - uObstruct * ob);
}
float fresnelOut(float c, float ior) {                         // Fresnel exacto (sin polarizar) dentro→fuera
  float s2 = ior * ior * max(0.0, 1.0 - c * c);
  if (s2 >= 1.0) return 1.0;
  float ct = sqrt(1.0 - s2);
  float rs = (ior * c - ct) / (ior * c + ct), rp = (ior * ct - c) / (ior * ct + c);
  return 0.5 * (rs * rs + rp * rp);
}
vec3 trace(vec3 p, vec3 d, float ior) {
  vec3 acc = vec3(0.0); float thr = 1.0;
  for (int i = 0; i < BOUNCES; i++) {
    float tP = hitPav(p, d), tC = hitCrown(p, d);
    float tT = d.z > 1e-5 ? (gHc - p.z) / d.z : 1e9;
    if (tT < 1e-4) tT = 1e9;
    float t = min(tP, min(tC, tT));
    if (t > 1e8) { acc += thr * envW(d, 2.0, 1); thr = 0.0; break; }
    int reg = t == tP ? 0 : (t == tT ? 2 : 1);
    p += d * t;
    vec3 n = reg == 2 ? vec3(0.0, 0.0, 1.0) : facetN(p, reg);
    float c = max(dot(d, n), 1e-4);
    float F = fresnelOut(c, ior);
    if (F < 1.0) {
      vec3 dout = refract(d, -n, ior);
      acc += thr * (1.0 - F) * envW(dout, 0.35 + float(i) * 0.55, reg);
      thr *= F;
    }
    d = reflect(d, n);
    p -= n * 2e-3;
    if (thr < 0.02) break;
  }
  if (thr > 0.0) acc += thr * envW(d, 3.0, 1) * 0.6;
  return acc;
}
void main() {
  gA = normalize(vA);
  gE1 = normalize(vE - gA * dot(vE, gA));
  gE2 = cross(gA, gE1);
  float R = vP.x; gHc = vP.y; gHp = vP.z; gRt = vP.w; gNF = vQ.x;
  gK = gHp; gKc = gHc / max(1.0 - gRt, 0.05);
  gAl = atan(gK); gBe = atan(gKc);
  vec3 V = normalize(vPos - cameraPosition); gV = V;
  vec3 N = normalize(vN);
  if (dot(N, V) > 0.0) N = -N;
  float cosI = clamp(-dot(V, N), 0.0, 1.0);
  float Ff = 0.172 + 0.828 * pow(1.0 - cosI, 5.0);             // F0 del diamante (n = 2.42)
  vec3 refl = textureLod(uEnv, uEnvRot * reflect(V, N), 0.0).rgb;
  vec3 rel = vPos - vC;
  vec3 p = vec3(dot(rel, gE1), dot(rel, gE2), dot(rel, gA)) / R * 0.985;
  vec3 col;
#ifdef GEM_FULL
  vec3 dR = refract(V, N, 1.0 / uIor.r), dG = refract(V, N, 1.0 / uIor.g), dB = refract(V, N, 1.0 / uIor.b);
  float r = trace(p, vec3(dot(dR, gE1), dot(dR, gE2), dot(dR, gA)), uIor.r).r;
  float g = trace(p, vec3(dot(dG, gE1), dot(dG, gE2), dot(dG, gA)), uIor.g).g;
  float b = trace(p, vec3(dot(dB, gE1), dot(dB, gE2), dot(dB, gA)), uIor.b).b;
  col = vec3(r, g, b * 0.93);
#else
  vec3 dG = refract(V, N, 1.0 / uIor.g);
  col = trace(p, vec3(dot(dG, gE1), dot(dG, gE2), dot(dG, gA)), uIor.g);
#endif
  vec3 c = refl * Ff + col * (1.0 - Ff);
  c *= uBright * (1.0 + uSparkle * (0.55 + 0.45 * sin(vQ.y * 40.0)));
  gl_FragColor = vec4(c, uAlpha);
}`;

// --- Fondo: terciopelo café. El patrón (pliegues, brillo rasante, fibra) se hornea una vez; por cuadro solo se ilumina ---
const VELVET_BAKE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
void main(){
  vec2 q = vec2((vUv.x - 0.5) * 3.2, (vUv.y - 0.5) * 1.3);
  float warp = fbm(vec2(q.x * 1.1 + 3.0, q.y * 0.45)) * 3.4 + fbm(vec2(q.x * 0.35 + 9.0, 1.7)) * 2.0;
  float w = q.x * 3.4 + warp;
  float fold = sin(w * 3.14159) * 0.5 + 0.5;
  float slope = cos(w * 3.14159);
  float sheen = pow(abs(slope), 2.5) * (0.5 + 0.5 * fbm(q * 3.0 + 11.0));
  float fib = vnoise(vUv * vec2(1400.0, 520.0)) * 0.6 + vnoise(vUv * vec2(600.0, 240.0)) * 0.4;
  gl_FragColor = vec4(fold, sheen, fib, 1.0);
}`;
// --- Polvo de oro (GPU): flujo tipo curl, bokeh por profundidad, onda expansiva del clink ---
const DUST_VERT = /* glsl */`
attribute vec4 aSeed; attribute vec4 aRnd;
uniform float uTime; uniform float uScale; uniform float uFocus; uniform float uAperture;
uniform vec3 uBoxMin; uniform vec3 uBoxSize; uniform vec3 uShockPos; uniform float uShockAge; uniform float uFlow;
uniform vec3 uLightPos; uniform float uDim; uniform float uSpeed;
varying float vA; varying float vBok; varying vec3 vCol; varying float vRot;
vec3 flow(vec3 p) {
  return vec3(sin(p.y * 1.7 + cos(p.z * 1.3)) + 0.5 * sin(p.z * 2.9 + 1.7),
              sin(p.z * 1.9 + cos(p.x * 1.1)) + 0.5 * sin(p.x * 3.1 + 2.3),
              sin(p.x * 1.5 + cos(p.y * 1.7)) + 0.5 * sin(p.y * 2.7 + 0.4));
}
void main() {
  float t = uTime * uSpeed * (0.55 + aRnd.x * 0.9);
  vec3 s = aSeed.xyz;
  s.y = fract(s.y + t * 0.010 * (0.4 + aRnd.y));
  s.x = fract(s.x + sin(t * 0.07 + aRnd.z * 6.28) * 0.01);
  vec3 p = uBoxMin + s * uBoxSize;
  vec3 f = flow(p * 34.0 + vec3(0.0, t * 0.35, t * 0.21));
  p += f * uBoxSize.y * 0.035 * uFlow;
  if (uShockAge > 0.0 && uShockAge < 3.0) {
    vec3 d = p - uShockPos; float r = length(d) + 1e-5;
    float front = uShockAge * 0.075;
    float k = exp(-pow((r - front) / 0.014, 2.0)) * exp(-uShockAge * 1.2);
    p += d / r * k * 0.010 + d / r * 0.004 * (1.0 - exp(-uShockAge * 3.0)) * exp(-r * 30.0);
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dist = -mv.z;
  float coc = uAperture * abs(dist - uFocus) / max(dist, 1e-3);
  float bok = clamp(coc * 7.0, 0.0, 1.0);
  float size = (1.1 + aRnd.w * 1.6) + coc * 230.0;
  gl_PointSize = clamp(size, 1.0, 110.0) * uScale;
  gl_Position = projectionMatrix * mv;
  float near = smoothstep(0.035, 0.09, dist);
  float tw = 0.55 + 0.45 * sin(uTime * (1.5 + aRnd.y * 3.0) + aRnd.z * 40.0);
  float light = 0.16 + 0.84 * exp(-dot(p - uLightPos, p - uLightPos) / (uBoxSize.y * uBoxSize.y * 0.14));
  vA = near * light * mix(tw * tw * 1.25, 0.40, bok) / (1.0 + coc * coc * 260.0) * uDim;
  vBok = bok;
  vCol = mix(vec3(1.0, 0.70, 0.36), vec3(1.0, 0.88, 0.66), aRnd.z);
  vRot = aRnd.x;
}`;
const DUST_FRAG = /* glsl */`
precision highp float;
varying float vA; varying float vBok; varying vec3 vCol; varying float vRot;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = length(c);
  if (r > 1.0) discard;
  float edge = mix(0.25, 0.86, vBok);
  float disc = 1.0 - smoothstep(edge, 1.0, r);
  float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r)) * vBok;
  float core = exp(-r * r * 9.0) * (1.0 - vBok);
  float a = (disc * mix(0.55, 0.42, vBok) + rim * 0.35 + core * 1.6) * vA;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

// --- Chispas del clink ---
const SPARK_VERT = /* glsl */`
attribute vec4 aDir; attribute vec4 aRnd;
uniform float uAge; uniform vec3 uOrigin; uniform float uScale; uniform float uUnit;
varying float vA; varying float vHeat;
void main() {
  float age = uAge - aRnd.x * 0.06;
  float life = 0.9 + aRnd.y * 1.3;
  float k = 2.4 + aRnd.z * 2.5;
  float spd = aDir.w * uUnit;
  vec3 p = uOrigin + aDir.xyz * spd * (1.0 - exp(-k * max(age, 0.0))) / k + vec3(0.0, -0.016 * uUnit, 0.0) * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float x = clamp(age / life, 0.0, 1.0);
  vA = (age > 0.0 ? 1.0 : 0.0) * pow(1.0 - x, 1.6) * (0.7 + 0.3 * sin(age * 50.0 + aRnd.w * 30.0));
  vHeat = 1.0 - x;
  gl_PointSize = (1.4 + 3.2 * (1.0 - x) * aRnd.w) * uScale;
}`;
const SPARK_FRAG = /* glsl */`
precision highp float;
varying float vA; varying float vHeat;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0; float r = dot(c, c);
  if (r > 1.0) discard;
  vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.92, 0.7), vHeat) * (1.0 + 3.0 * vHeat * vHeat);
  gl_FragColor = vec4(col * exp(-r * 3.0) * vA, 1.0);
}`;

// --- Estrellas (4 rayos + 2 diagonales finos) en los centros de gema; instanciadas, en espacio de vista ---
const STAR_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iData;   // tamaño (m), intensidad, rotación, tinte
varying vec2 vUv; varying float vI; varying float vRot; varying float vHue;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.z += 0.0035;
  mv.xy += position.xy * iData.x;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0; vI = iData.y; vRot = iData.z; vHue = iData.w;
}`;
const STAR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; varying float vI; varying float vRot; varying float vHue;
uniform float uAnamorph;
void main() {
  if (vI < 0.002) discard;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 p = mat2(cs, -sn, sn, cs) * vUv;
  float r = length(p);
  float ax = abs(p.x), ay = abs(p.y);
  float h = exp(-pow(ay * 42.0, 2.0)) * pow(max(0.0, 1.0 - ax), 2.6);
  float v = exp(-pow(ax * 42.0, 2.0)) * pow(max(0.0, 1.0 - ay), 2.6);
  vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.70710678;
  float d1 = exp(-pow(abs(q.y) * 70.0, 2.0)) * pow(max(0.0, 1.0 - abs(q.x) * 1.7), 3.0);
  float d2 = exp(-pow(abs(q.x) * 70.0, 2.0)) * pow(max(0.0, 1.0 - abs(q.y) * 1.7), 3.0);
  float an = exp(-pow(vUv.y * 60.0, 2.0)) * pow(max(0.0, 1.0 - abs(vUv.x)), 1.5) * uAnamorph;
  float core = exp(-r * r * 160.0) * 2.4 + exp(-r * r * 22.0) * 0.32;
  vec3 warm = vec3(1.0, 0.92, 0.78), cool = vec3(0.86, 0.93, 1.0);
  vec3 col = mix(warm, cool, vHue) * ((h + v) + (d1 + d2) * 0.38 + core) + vec3(1.0, 0.8, 0.55) * an * 0.6;
  // leve franja espectral en los rayos (fuego)
  col.r *= 1.0 + 0.25 * smoothstep(0.2, 0.7, r);
  col.b *= 1.0 + 0.25 * smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(col * vI, 1.0);
}`;

// --- Onda expansiva (anillo luminoso con separación cromática) ---
const SHOCK_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv; uniform float uAge;
float ring(float r, float R, float w){ return exp(-pow((r - R) / w, 2.0)); }
void main() {
  float r = length(vUv);
  float R = 1.0 - exp(-uAge * 3.4);
  float w = 0.008 + 0.035 * R;
  float fade = exp(-uAge * 3.0) * smoothstep(0.0, 0.03, uAge) * (1.0 - smoothstep(0.85, 1.0, r));
  vec3 col = vec3(ring(r, R * 1.015, w), ring(r, R, w), ring(r, R * 0.982, w)) * vec3(1.0, 0.84, 0.58) * 0.9 * fade;
  float R2 = 1.0 - exp(-max(uAge - 0.10, 0.0) * 2.6);
  col += ring(r, R2 * 0.72, 0.012 + 0.03 * R2) * vec3(1.0, 0.76, 0.46) * 0.35 * exp(-uAge * 3.2) * step(0.10, uAge);
  col += exp(-r * r * 60.0) * exp(-uAge * 10.0) * vec3(1.0, 0.9, 0.75) * 1.4;
  gl_FragColor = vec4(col, 1.0);
}`;
const BILLBOARD_VERT = /* glsl */`
uniform float uSize; varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  mv.z += 0.006;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
}`;

// --- Pase final: aberración cromática + destello + ACES/AgX + sRGB + viñeta + grano ---
const FINAL_SHADER = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uExposure: { value: 1 }, uCA: { value: 0.0018 }, uVig: { value: 0.42 }, uGrain: { value: 0.035 },
    uFlash: { value: 0 }, uFlashPos: { value: new THREE.Vector2(0.5, 0.5) }, uDim: { value: 1 },
    tBloom: { value: null }, uBloom: { value: 0 },
    tVelvet: { value: null }, uPool: { value: new THREE.Vector2(0.5, 0.6) }, uPar: { value: new THREE.Vector2() }, uPoolR: { value: 0.32 }, uLift: { value: 1 }, uBgDim: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
precision highp float;
uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; uniform float uExposure; uniform float uCA;
uniform float uVig; uniform float uGrain; uniform float uFlash; uniform vec2 uFlashPos; uniform float uDim;
uniform sampler2D tBloom; uniform float uBloom;
uniform sampler2D tVelvet; uniform vec2 uPool; uniform vec2 uPar; uniform float uPoolR; uniform float uLift; uniform float uBgDim;
varying vec2 vUv;
// terciopelo café: patrón horneado (pliegues, brillo rasante, fibra) iluminado por el charco de luz de los anillos
vec3 velvet(vec2 uv, float asp){
  vec2 q = vec2((uv.x - 0.5) * asp, uv.y - 0.5) + uPar;
  vec3 v = texture2D(tVelvet, vec2(q.x / 3.2 + 0.5, q.y / 1.3 + 0.5)).rgb;
  float fold = v.r * 2.0 - 1.0, sheen = v.g, fib = v.b;
  vec2 dp = (uv - uPool) * vec2(asp, 1.0);
  float d2 = dot(dp, dp);
  float pool = exp(-d2 / (uPoolR * uPoolR));
  float halo = exp(-d2 / (uPoolR * uPoolR * 5.0));
  float side = smoothstep(0.35, 1.25, abs(q.x)) * 0.6;
  vec3 col = vec3(0.008, 0.0045, 0.0032) * (0.85 + 0.2 * fold);
  col += vec3(0.135, 0.072, 0.036) * uLift * pool * (0.78 + 0.22 * fold) + vec3(0.040, 0.020, 0.011) * halo * uLift;
  col += vec3(0.085, 0.046, 0.024) * sheen * (pool * 0.85 + halo * 0.3) * uLift;
  col += vec3(0.026, 0.008, 0.005) * side * (0.6 + 0.4 * fold);
  return col * (0.9 + 0.1 * fib) * uBgDim;
}
// CREMA (decisión n.º 9.1): estudio de papel crema en espacio de pantalla (sRGB), como la puerta: charco de luz marfil detrás de
// los anillos, borde apenas tostado y fibra de papel sutil (del mismo patrón horneado).
// Pedido del usuario (31/10 18:55): detrás de los anillos el fondo debe ser más OSCURO y aclararse a crema hacia los bordes, porque el
// crema claro opacaba el oro. Núcleo cacao/bronce cálido que sigue a los anillos (uPool) y se funde suave al crema de la página.
vec3 creamBg(vec2 uv, float asp){
  vec2 q = vec2((uv.x - 0.5) * asp, uv.y - 0.5) + uPar;
  vec3 v = texture2D(tVelvet, vec2(q.x / 3.2 + 0.5, q.y / 1.3 + 0.5)).rgb;
  vec2 dp = (uv - uPool) * vec2(asp, 1.0);
  float d = length(dp) / max(uPoolR, 0.05);                 // 1 = radio del charco de luz de los anillos
  float halo = exp(-d * d / 7.0);
  vec3 edge = mix(vec3(0.905, 0.855, 0.765), vec3(0.945, 0.910, 0.845), halo);
  float core = 1.0 - smoothstep(0.0, 1.85, d);
  core = core * core * (3.0 - 2.0 * core);
  vec3 dark = mix(vec3(0.155, 0.108, 0.075), vec3(0.34, 0.25, 0.17), smoothstep(0.15, 1.05, d));
  dark += vec3(0.11, 0.075, 0.035) * exp(-pow(d - 0.62, 2.0) * 9.0) * uLift;   // aro de luz cálida tenue detrás del oro
  vec3 col = mix(edge, dark, core);
  col *= 0.985 + 0.03 * (v.b - 0.5) + 0.012 * (v.r - 0.5);
  return mix(vec3(0.95, 0.918, 0.852), col, uBgDim);
}
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = IN * (c / 0.6); c = RRTAndODTFit(c); c = OUT * c; return clamp(c, 0.0, 1.0);
}
vec3 neutral(vec3 color){
  const float sc = 0.76; const float desat = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < sc) return color;
  float d = 1.0 - sc;
  float np = 1.0 - d * d / (peak + d - sc);
  color *= np / peak;
  float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(color, vec3(np), g);
}
vec3 srgb(vec3 c){ return mix(pow(c, vec3(0.41666)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  vec2 off = d * uCA * (0.35 + r2 * 3.0);
  vec3 c;
  vec4 s0 = texture2D(tDiffuse, vUv);
  c.r = texture2D(tDiffuse, vUv + off).r;
  c.g = s0.g;
  c.b = texture2D(tDiffuse, vUv - off).b;
  float asp = uRes.x / uRes.y;
  float a = clamp(s0.a, 0.0, 1.0);
  if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
  vec2 fd = (vUv - uFlashPos) * vec2(asp, 1.0);
  float f2 = dot(fd, fd);
  vec3 fl = uFlash * (vec3(1.0, 0.86, 0.64) * (2.6 * exp(-f2 * 40.0) + 0.35 * exp(-f2 * 5.0)) + vec3(0.10, 0.07, 0.045));
#ifdef NEUTRAL
  c = clamp(neutral(c * uExposure), 0.0, 1.0);
  c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
#else
  c = aces(c * uExposure);
#endif
  c = srgb(c);
  // CREMA: los anillos (alfa = cobertura, color premultiplicado) sobre el estudio crema; lo que brilla sin cobertura (polvo de oro,
  // halo del bloom) tiñe el papel de oro viejo (sobre claro el brillo aditivo no se vería) con un núcleo más claro
  vec3 bg = creamBg(vUv, asp);
  float w = smoothstep(0.0, 0.06, a);
  vec3 gw = c * (1.0 - w);
  float gL = clamp(dot(gw, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
  vec3 bgG = bg * mix(vec3(1.0), vec3(0.72, 0.55, 0.30), clamp(gL * gL * 3.2 + gL * 0.5, 0.0, 0.7)) + gw * gw * 0.45;
  c = mix(bgG, c + bg * (1.0 - a), w);
  // destello del clink: luz que aclara (pantalla)
  vec3 flD = clamp(srgb(clamp(fl * uExposure * 0.6, 0.0, 1.0)), 0.0, 1.0);
  c = 1.0 - (1.0 - c) * (1.0 - flD);
  float v = smoothstep(1.05, 0.18, length(d * vec2(1.0 + 0.25 * (asp - 1.0), 1.12)));
  c *= mix(vec3(1.0) - uVig * vec3(0.30, 0.38, 0.5), vec3(1.0), v);   // CREMA: viñeta de papel tostado, no negra
  float g = h12(vUv * uRes + fract(uTime * 13.7) * 431.0) - 0.5;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += g * uGrain * 0.6 * (0.55 + 0.45 * (1.0 - lum));
  c = mix(bg, c, uDim);   // CREMA: al bajar, los anillos se funden en el crema (antes se apagaban a negro)
  gl_FragColor = vec4(c, 1.0);
}`,
};

/* ------------------------------------------------------------------------ */
/* Bloom HDR ligero (filtro dual de Kawase): umbral alto, cadena ½ → 1/64, se compone en el pase final.     */
/* Equivale a UnrealBloomPass pero sin volver a escribir en el búfer MSAA (una sola resolución por cuadro). */
/* ------------------------------------------------------------------------ */
const ADD = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
const FS_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
class BloomLite extends Pass {
  constructor({ threshold = 1.3, knee = 0.6, levels = 6, clampMax = 24, first = 4 } = {}) {
    super();
    this.needsSwap = false;
    this.levels = levels;
    this.first = first;          // resolución del primer nivel (1/2 o 1/4 de la imagen)
    this.down = []; this.up = [];
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    for (let i = 0; i < levels; i++) { this.down.push(new THREE.WebGLRenderTarget(1, 1, opt)); this.up.push(new THREE.WebGLRenderTarget(1, 1, opt)); }
    this.mDown = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uHp: { value: new THREE.Vector2() }, uPre: { value: 0 }, uThr: { value: threshold }, uKnee: { value: knee }, uMax: { value: clampMax } },
      vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
precision highp float; uniform sampler2D tSrc; uniform vec2 uHp; uniform float uPre; uniform float uThr; uniform float uKnee; uniform float uMax; varying vec2 vUv;
vec3 pre(vec3 c){ c = min(c, vec3(uMax)); float br = max(c.r, max(c.g, c.b)); float soft = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);
  float k = max(soft, br - uThr) / max(br, 1e-4); return c * k; }
vec3 tap(vec2 uv){ vec3 c = texture2D(tSrc, uv).rgb; return uPre > 0.5 ? pre(c) : c; }
void main(){
  vec3 s = tap(vUv) * 4.0 + tap(vUv - uHp) + tap(vUv + uHp) + tap(vUv + vec2(uHp.x, -uHp.y)) + tap(vUv - vec2(uHp.x, -uHp.y));
  gl_FragColor = vec4(s / 8.0, 1.0);
}` });
    this.mUp = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, tAdd: { value: null }, uHp: { value: new THREE.Vector2() }, uScatter: { value: 0.72 } },
      vertexShader: FS_VERT, depthTest: false, depthWrite: false,
      fragmentShader: /* glsl */`
precision highp float; uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uHp; uniform float uScatter; varying vec2 vUv;
void main(){
  vec2 h = uHp;
  vec3 s = texture2D(tSrc, vUv + vec2(-2.0 * h.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(2.0 * h.x, 0.0)).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -2.0 * h.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0 * h.y)).rgb
         + 2.0 * (texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb + texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb
         + texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb + texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb);
  gl_FragColor = vec4(s / 12.0 * uScatter + texture2D(tAdd, vUv).rgb, 1.0);
}` });
    this.quad = new FullScreenQuad(null);
    this.texture = this.up[0].texture;
  }
  setSize(w, h) {
    for (let i = 0; i < this.levels; i++) {
      const d = this.first * Math.pow(2, i);
      const ww = Math.max(1, Math.round(w / d)), hh = Math.max(1, Math.round(h / d));
      this.down[i].setSize(ww, hh); this.up[i].setSize(ww, hh);
    }
  }
  render(renderer, writeBuffer, readBuffer) {
    const q = this.quad;
    q.material = this.mDown;
    let src = readBuffer.texture, sw = readBuffer.width, sh = readBuffer.height;
    for (let i = 0; i < this.levels; i++) {
      this.mDown.uniforms.tSrc.value = src;
      // primer paso a 1/4: muestras a ±1 texel (cada una bilineal 2×2) → cubre 4×4 sin saltarse píxeles
      const k = i === 0 ? this.first / 4 : 0.5;
      this.mDown.uniforms.uHp.value.set(k / sw, k / sh);
      this.mDown.uniforms.uPre.value = i === 0 ? 1 : 0;
      renderer.setRenderTarget(this.down[i]); q.render(renderer);
      src = this.down[i].texture; sw = this.down[i].width; sh = this.down[i].height;
    }
    q.material = this.mUp;
    let prev = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      this.mUp.uniforms.tSrc.value = prev.texture;
      this.mUp.uniforms.tAdd.value = this.down[i].texture;
      this.mUp.uniforms.uHp.value.set(0.5 / prev.width, 0.5 / prev.height);
      renderer.setRenderTarget(this.up[i]); q.render(renderer);
      prev = this.up[i];
    }
  }
  dispose() { [...this.down, ...this.up].forEach(r => r.dispose()); this.mDown.dispose(); this.mUp.dispose(); this.quad.dispose(); }
}

/* ------------------------------------------------------------------------ */
/* Estudio de joyería (escena emisiva → PMREM para el oro y cubemap nítido para gemas)                     */
/* ------------------------------------------------------------------------ */
function softboxTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const u = Math.abs(x / 63 * 2 - 1), v = Math.abs(y / 63 * 2 - 1);
    const e = Math.pow(1 - Math.pow(u, 6), 1.0) * Math.pow(1 - Math.pow(v, 6), 1.0);
    const k = Math.round(255 * Math.pow(e, 0.9) * (0.82 + 0.18 * (1 - v)));
    const i = (y * 64 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildStudio({ metalDark, gems, tex }) {
  const scene = new THREE.Scene();
  const disposables = [];
  const lin = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  const domeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: gems ? lin('#efe6da', 0.55) : lin('#4a3424', 0.22) });
  if (metalDark) domeMat.map = metalDark;
  const domeGeo = new THREE.SphereGeometry(9, 48, 24);
  scene.add(new THREE.Mesh(domeGeo, domeMat));
  const floorGeo = new THREE.CircleGeometry(8.5, 48);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ color: gems ? lin('#5a3a1e', 0.35) : lin('#3a1e0c', 0.55) }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -3.2; scene.add(floor);
  disposables.push(domeGeo, domeMat, floorGeo, floor.material);
  const plane = new THREE.PlaneGeometry(1, 1);
  const sphere = new THREE.SphereGeometry(1, 16, 8);
  disposables.push(plane, sphere);
  const panel = (w, h, color, k, pos, map) => {
    const m = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: lin(color, k), side: THREE.DoubleSide, map: map || null }));
    m.scale.set(w, h, 1); m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); scene.add(m);
    disposables.push(m.material); return m;
  };
  // Softbox principal (arriba-izquierda, delante): luz cálida de vela "grande"
  panel(3.4, 2.2, '#ffe7c8', 6.0, [-2.6, 3.0, 2.5], tex);
  // Relleno derecho más suave
  panel(2.0, 3.2, '#ffeedd', 1.7, [3.3, 0.9, 1.9], tex);
  // Panel frontal bajo (detrás de la cámara): degradado que da el reflejo "de joyería" en la cara del aro.
  // PERF (oro, no gemas): la cara plana del aro de compromiso, vista de frente, reflejaba ENTERO ese panel ancho → todo el
  // aro brillaba parejo (> umbral de bloom) = "aro de neón naranja". En el estudio del oro el panel se parte en dos, a los
  // lados de la cámara, más tenues: al centro queda el hueco oscuro del fotógrafo y el aro muestra bordes brillantes + metal.
  if (gems) panel(8.0, 1.9, '#fff3e4', 2.1, [0.4, -0.7, 4.4], tex);
  else {
    panel(2.6, 1.5, '#fff3e4', 1.35, [-2.5, -0.55, 3.7], tex);
    panel(2.2, 1.5, '#fff3e4', 1.05, [2.6, -0.45, 3.6], tex);
  }
  // gran difusor superior-frontal: el aro de compromiso (de frente a cámara) recibe un reflejo dorado amplio.
  // PERF: en el oro es la otra fuente del "neón" (la cara inclinada del aro lo reflejaba parejo a ≈2.7 en HDR): en dos
  // franjas con un hueco oscuro entre ellas → la cara muestra bandas de luz y sombra (detalle de metal) y no brilla entera.
  if (gems) panel(4.2, 2.6, '#ffeed8', 2.4, [0.8, 3.4, 3.1], tex);
  else {
    panel(4.2, 0.8, '#ffeed8', 1.7, [0.66, 3.86, 2.55], tex);
    panel(4.2, 0.8, '#ffeed8', 1.25, [0.93, 2.86, 3.58], tex);
  }
  // Tiras verticales largas: reflejos largos y contrastados en el oro
  panel(0.24, 6.5, '#fff6ea', 9.0, [-3.7, 0.5, -0.5]);
  panel(0.2, 6.5, '#fff0dc', 7.0, [3.5, 0.8, -1.7]);
  panel(0.16, 5.0, '#fff6ea', 5.5, [-1.2, 0.6, -3.8]);
  // Tira cenital
  panel(7.2, 0.18, '#fff8ee', 7.5, [0.2, 3.9, 0.3]);
  // Contraluz frío suave (rim)
  panel(1.5, 2.4, '#a8c2ff', 2.4, [1.9, 1.5, -3.5], tex);
  // Bombillas pequeñas: chispas en el oro y fuego en los diamantes
  const nB = gems ? 26 : 8;
  for (let i = 0; i < nB; i++) {
    const a = hash(i * 3.1 + 1) * Math.PI * 2, el = (gems ? -0.15 : 0.05) + hash(i * 7.3 + 2) * 1.05;
    const r = 4.2;
    const m = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial({ color: lin(hash(i + 9) > .8 ? '#dfe9ff' : '#fff1de', gems ? 28 + 40 * hash(i * 1.7) : 14) }));
    const s = gems ? 0.045 + 0.06 * hash(i * 5.1) : 0.07;
    m.scale.setScalar(s);
    m.position.set(Math.cos(a) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(a) * Math.cos(el) * r);
    scene.add(m); disposables.push(m.material);
  }
  if (gems) {
    // el observador / la cámara: disco oscuro detrás de la cámara → patrón de contraste real del brillante
    const occ = new THREE.Mesh(new THREE.CircleGeometry(0.95, 32), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide }));
    occ.position.set(0, 0.25, 3.9); occ.lookAt(0, 0, 0); scene.add(occ); disposables.push(occ.geometry, occ.material);
  }
  return { scene, dispose: () => disposables.forEach(d => d.dispose?.()) };
}

/* ------------------------------------------------------------------------ */
/* Preparación de cada anillo: materiales + gemas fusionadas con su marco analítico                      */
/* ------------------------------------------------------------------------ */
const CUT_FACETS = { round: 8, princess: 4, marquise: 8, emerald: 4 };

function analyzeGem(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const tri = idx ? idx.count / 3 : pos.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const clusters = [];
  for (let t = 0; t < tri; t++) {
    const ia = idx ? idx.getX(3 * t) : 3 * t, ib = idx ? idx.getX(3 * t + 1) : 3 * t + 1, ic = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const ar = n.length() / 2; if (ar <= 0) continue;
    n.divideScalar(ar * 2);
    let f = clusters.find(k => k.n.dot(n) > 0.999);
    if (!f) { f = { n: n.clone(), area: 0 }; clusters.push(f); }
    f.area += ar;
  }
  clusters.sort((x, y) => y.area - x.area);
  const axis = clusters[0].n.clone().normalize();
  // dirección de referencia: faceta principal del pabellón
  let e1 = null, best = 0;
  for (const k of clusters) { const d = k.n.dot(axis); if (d < -0.55 && d > -0.92 && k.area > best) { best = k.area; e1 = k.n.clone().addScaledVector(axis, -d).normalize(); } }
  if (!e1) { e1 = new THREE.Vector3(1, 0, 0); if (Math.abs(e1.dot(axis)) > 0.9) e1.set(0, 0, 1); e1.addScaledVector(axis, -e1.dot(axis)).normalize(); }
  let zmin = 1e9, zmax = -1e9, rmax = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); const z = p.dot(axis); const r = Math.sqrt(Math.max(0, p.lengthSq() - z * z));
    zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); rmax = Math.max(rmax, r);
  }
  let gz = 0, gc = 0, rt = 0;
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); const z = p.dot(axis); const r = Math.sqrt(Math.max(0, p.lengthSq() - z * z));
    if (r > 0.97 * rmax) { gz += z; gc++; }
    if (z > zmax - 0.01 * rmax) rt = Math.max(rt, r);
  }
  gz = gc ? gz / gc : 0;
  return { axis, e1, R: rmax, gz, hc: Math.max(0.12, (zmax - gz) / rmax), hp: Math.max(0.4, (gz - zmin) / rmax), rt: clamp01(rt / rmax) };
}

function prepareRing(gltf, name, metalMat, gemMat, physGem) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const gemsMeshes = [], metals = [];
  root.traverse(o => { if (o.isMesh) (/gema/i.test(o.material?.name || '') || /^gema/i.test(o.name) ? gemsMeshes : metals).push(o); });
  // oro
  for (const m of metals) { m.material.dispose?.(); m.material = metalMat; m.castShadow = m.receiveShadow = false; }
  // gemas → una sola malla con atributos por gema
  const gems = [];
  const parts = [];
  let total = 0;
  for (const g of gemsMeshes) {
    const M = new THREE.Matrix4().multiplyMatrices(inv, g.matrixWorld);
    const geo = g.geometry.index ? g.geometry.toNonIndexed() : g.geometry.clone();
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const info = analyzeGem(geo);
    const nm = new THREE.Matrix3().getNormalMatrix(M);
    const center = new THREE.Vector3().setFromMatrixPosition(M);
    const axisW = info.axis.clone().applyMatrix3(nm).normalize();
    const e1W = info.e1.clone().applyMatrix3(nm).normalize();
    const girdle = info.axis.clone().multiplyScalar(info.gz).applyMatrix4(M);
    const cut = g.userData?.cut || 'round';
    const size = g.userData?.size || info.R * 2;
    const seed = hash(gems.length * 1.37 + name.length);
    geo.applyMatrix4(M);
    parts.push({ geo, girdle, axisW, e1W, info, cut, seed });
    total += geo.attributes.position.count;
    // centro de la mesa (para estrellas) y facetas de destello pseudoaleatorias
    const table = girdle.clone().addScaledVector(axisW, info.hc * info.R);
    const facets = [];
    for (let k = 0; k < 7; k++) {
      const ang = (k / 7) * Math.PI * 2 + seed * 6.28, tilt = k === 0 ? 0 : 0.18 + 0.32 * hash(seed * 50 + k);
      const ref = e1W.clone().applyAxisAngle(axisW, ang);
      facets.push(axisW.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(ref, Math.sin(tilt)).normalize());
    }
    gems.push({ name: g.name, cut, size, seed, center: table, axis: axisW, facets, R: info.R, big: false });
    g.parent.remove(g);
    g.geometry.dispose();
    if (g.material && g.material !== gemMat) g.material.dispose?.();
  }
  if (gems.length) {
    const maxSize = Math.max(...gems.map(g => g.size));
    gems.forEach(g => { g.big = g.size > maxSize * 0.8; });
  }
  let gemMesh = null;
  if (parts.length) {
    const P = new Float32Array(total * 3), N = new Float32Array(total * 3), C = new Float32Array(total * 3),
      A = new Float32Array(total * 3), E = new Float32Array(total * 3), GP = new Float32Array(total * 4), GQ = new Float32Array(total * 4);
    let o = 0;
    for (const pt of parts) {
      const pos = pt.geo.attributes.position, nor = pt.geo.attributes.normal;
      for (let i = 0; i < pos.count; i++, o++) {
        P[3 * o] = pos.getX(i); P[3 * o + 1] = pos.getY(i); P[3 * o + 2] = pos.getZ(i);
        N[3 * o] = nor.getX(i); N[3 * o + 1] = nor.getY(i); N[3 * o + 2] = nor.getZ(i);
        C[3 * o] = pt.girdle.x; C[3 * o + 1] = pt.girdle.y; C[3 * o + 2] = pt.girdle.z;
        A[3 * o] = pt.axisW.x; A[3 * o + 1] = pt.axisW.y; A[3 * o + 2] = pt.axisW.z;
        E[3 * o] = pt.e1W.x; E[3 * o + 1] = pt.e1W.y; E[3 * o + 2] = pt.e1W.z;
        GP[4 * o] = pt.info.R; GP[4 * o + 1] = pt.info.hc; GP[4 * o + 2] = pt.info.hp; GP[4 * o + 3] = pt.info.rt;
        GQ[4 * o] = CUT_FACETS[pt.cut] || 8; GQ[4 * o + 1] = pt.seed; GQ[4 * o + 2] = pt.cut === 'emerald' ? 1 : 0; GQ[4 * o + 3] = 0;
      }
      pt.geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    geo.setAttribute('gemC', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('gemA', new THREE.BufferAttribute(A, 3));
    geo.setAttribute('gemE', new THREE.BufferAttribute(E, 3));
    geo.setAttribute('gemP', new THREE.BufferAttribute(GP, 4));
    geo.setAttribute('gemQ', new THREE.BufferAttribute(GQ, 4));
    geo.computeBoundingSphere();
    gemMesh = new THREE.Mesh(geo, physGem || gemMat);
    gemMesh.name = name + '_gemas';
    gemMesh.renderOrder = 1;
    root.add(gemMesh);
  }
  // nube de puntos de superficie (para pruebas de colisión del enhebrado)
  const pts = [];
  const v = new THREE.Vector3();
  for (const m of metals) {
    const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    const pos = m.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 9000));
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i).applyMatrix4(M); pts.push(v.x, v.y, v.z); }
  }
  const metalPoints = new Float32Array(pts);
  for (const g of gems) pts.push(g.center.x, g.center.y, g.center.z);
  const holder = new THREE.Group();
  holder.name = name;
  holder.add(root);
  return { object: holder, gems, gemMesh, metals, points: new Float32Array(pts), metalPoints };
}

/* ------------------------------------------------------------------------ */
/* Enhebrado: dirección de llegada de la alianza y ventana de cruce (colisión real)                     */
/* ------------------------------------------------------------------------ */
function bandProfile(points, bins = 48) {
  // perfil de la alianza en su espacio local: radio interior/exterior y semiancho por sector angular
  const rin = new Float32Array(bins).fill(1), rout = new Float32Array(bins).fill(0), hz = new Float32Array(bins).fill(0);
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    const r = Math.hypot(x, y), b = Math.min(bins - 1, Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI * 2) * bins));
    if (r < 0.004) continue;
    rin[b] = Math.min(rin[b], r); rout[b] = Math.max(rout[b], r); hz[b] = Math.max(hz[b], Math.abs(z));
  }
  const m = 0.00025;
  let rMin = 1, rMax = 0, zMax = 0;
  for (let b = 0; b < bins; b++) {
    if (rout[b] === 0) { rin[b] = 1; continue; }
    rin[b] -= m; rout[b] += m; hz[b] += m;
    rMin = Math.min(rMin, rin[b]); rMax = Math.max(rMax, rout[b]); zMax = Math.max(zMax, hz[b]);
  }
  return { rin, rout, hz, bins, rMin, rMax, zMax };
}
function makeCollider(ePoints, prof) {
  // devuelve f(matrixE, matrixB) → n.º de puntos de E dentro del volumen de B (y su centroide)
  const n = ePoints.length / 3;
  const tmp = new THREE.Matrix4();
  return function collide(mE, mB, stride = 1, outC = null) {
    tmp.copy(mB).invert().multiply(mE);  // E local → B local
    const e = tmp.elements;
    let hits = 0, cx = 0, cy = 0, cz = 0;
    const { rin, rout, hz, bins, rMin, rMax, zMax } = prof;
    for (let i = 0; i < n; i += stride) {
      const x0 = ePoints[3 * i], y0 = ePoints[3 * i + 1], z0 = ePoints[3 * i + 2];
      const z = e[2] * x0 + e[6] * y0 + e[10] * z0 + e[14];
      if (z > zMax || z < -zMax) continue;
      const x = e[0] * x0 + e[4] * y0 + e[8] * z0 + e[12];
      const y = e[1] * x0 + e[5] * y0 + e[9] * z0 + e[13];
      const r = Math.hypot(x, y);
      if (r < rMin || r > rMax) continue;
      const b = Math.min(bins - 1, Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI * 2) * bins));
      if (r > rin[b] && r < rout[b] && Math.abs(z) < hz[b]) {
        hits++;
        if (outC) { cx += x0; cy += y0; cz += z0; }
      }
    }
    if (outC && hits) outC.set(cx / hits, cy / hits, cz / hits).applyMatrix4(mE);
    return hits;
  };
}
function planThreading(E, B, pose, rc = 0.0097) {
  const mEf = new THREE.Matrix4().compose(pose.pE, pose.qE, new THREE.Vector3(1, 1, 1));
  const mBf = new THREE.Matrix4().compose(pose.pB, pose.qB, new THREE.Vector3(1, 1, 1));
  const prof = bandProfile(B.metalPoints);
  const collide = makeCollider(E.points, prof);
  const mB = new THREE.Matrix4();
  const u = new THREE.Vector3(), c = new THREE.Vector3();
  const nE = E.points.length / 3;
  const scanStride = Math.max(1, Math.floor(nE / 1100));
  function windows(dir, stride, step, maxS) {
    const wins = []; let cur = null;
    for (let s = 0; s <= maxS + 1e-9; s += step) {
      mB.copy(mBf); mB.elements[12] += dir.x * s; mB.elements[13] += dir.y * s; mB.elements[14] += dir.z * s;
      const h = collide(mEf, mB, stride);
      if (h > 0) { if (!cur) cur = { a: s, b: s, n: h }; else { cur.b = s; cur.n = Math.max(cur.n, h); } }
      else if (cur) { wins.push(cur); cur = null; }
    }
    if (cur) wins.push(cur);
    return wins;
  }
  // barrido de direcciones que llegan desde la derecha (la alianza entra por la derecha)
  let best = null;
  for (let th = 20; th <= 160; th += 10) for (let ph = -80; ph <= 80; ph += 10) {
    const t = th * Math.PI / 180, p = ph * Math.PI / 180;
    u.set(Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p));
    if (u.x < 0.45) continue;
    const w = windows(u, scanStride, 0.001, 0.03);
    if (w.length !== 1 || w[0].b > 0.022) continue;
    const len = w[0].b - w[0].a + 0.001;
    const score = len * 1000 + (1 - u.x) * 3 + Math.abs(u.y) * 1.5;
    if (!best || score < best.score) best = { score, u: u.clone() };
  }
  if (!best) best = { u: new THREE.Vector3(0.87, -0.5, 0).normalize() };
  // refinado con todos los puntos
  const w = windows(best.u, 1, 0.00025, 0.035);
  const win = w.length ? w[0] : { a: 0.006, b: 0.010 };
  const sMid = (win.a + win.b) / 2;
  mB.copy(mBf); mB.elements[12] += best.u.x * sMid; mB.elements[13] += best.u.y * sMid; mB.elements[14] += best.u.z * sMid;
  collide(mEf, mB, 1, c);
  if (!w.length) c.copy(pose.pB);
  // eje de vaivén: tangente del aro de compromiso en el punto más cercano al centro de la alianza
  const invE = new THREE.Matrix4().copy(mEf).invert();
  const bLocal = pose.pB.clone().applyMatrix4(invE);
  const q = new THREE.Vector3(bLocal.x, bLocal.y, 0).normalize().multiplyScalar(rc);
  const tng = new THREE.Vector3(0, 0, 1).cross(q).normalize();
  const swingP = q.clone().applyMatrix4(mEf);
  const swingA = tng.applyQuaternion(pose.qE).normalize();
  // amplitud máxima de vaivén sin colisión
  const qs = new THREE.Quaternion(), pB = new THREE.Vector3(), qB = new THREE.Quaternion();
  let amp = 0.34;
  for (; amp > 0.05; amp -= 0.04) {
    let ok = true;
    for (let k = -4; k <= 4 && ok; k++) {
      const ang = amp * k / 4;
      qs.setFromAxisAngle(swingA, ang);
      pB.copy(pose.pB).sub(swingP).applyQuaternion(qs).add(swingP);
      qB.copy(qs).multiply(pose.qB);
      mB.compose(pB, qB, new THREE.Vector3(1, 1, 1));
      if (collide(mEf, mB, 2) > 0) ok = false;
    }
    if (ok) break;
  }
  return { u: best.u, s1: win.a, s2: win.b, contact: c.clone(), swingP, swingA, swingAmp: amp, collide, mEf };
}

/* ------------------------------------------------------------------------ */
/* Montaje                                                                    */
/* ------------------------------------------------------------------------ */
/** Nombre del renderer si es por software (SwiftShader, llvmpipe…: 1–9 fps con esta escena) o '' si es una GPU real. */
function softwareRenderer(renderer) {
  try {
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    return /SwiftShader|llvmpipe|softpipe|Basic Render|Software Rasterizer/i.test(name) ? name : '';
  } catch { return ''; }
}

export async function mountRings(container, opts = {}) {
  const reduced = !!opts.reducedMotion;
  const progress = p => { try { opts.onProgress?.(clamp01(p)); } catch {} };
  const params = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
  const tierName = detectTier();
  const T0 = performance.now(), timings = {};
  const mark = k => { timings[k] = Math.round(performance.now() - T0); };
  const tier = { ...TIERS[tierName] };
  const gemMode = opts.gemMode || params.get('gem') || 'shader';
  const adaptOn = params.get('adapt') !== '0';
  progress(0.01);

  // --- renderer ---
  const canvas = document.createElement('canvas');
  canvas.className = 'rings3d';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  let renderer;
  try {
    // failIfMajorPerformanceCaveat: sin GPU real (render por software) el contexto falla → la web usa la imagen
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true,
      failIfMajorPerformanceCaveat: params.get('sw') !== '1' });
  } catch (e) { throw new Error('WebGL no disponible: ' + (e?.message || e)); }
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); throw new Error('Se requiere WebGL2'); }
  // FIX (GPU sin render a coma flotante: drivers Android antiguos): todos los destinos (escena con MSAA, bloom, cubemap de las
  // gemas, PMREM) son HalfFloat. Sin estas extensiones el framebuffer queda incompleto y el hero se veía vacío, sin error y con
  // fps altos (ninguna red de seguridad actuaba). Se falla aquí → main.js usa la imagen de los anillos.
  if (!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))) {
    try { renderer.dispose(); renderer.forceContextLoss(); } catch {}
    throw new Error('sin destinos de render en coma flotante');
  }
  {
    const why = softwareRenderer(renderer);
    if (why && params.get('sw') !== '1') { try { renderer.dispose(); renderer.forceContextLoss(); } catch {} throw new Error('render por software (' + why + ')'); }
  }
  container.appendChild(canvas);
  // PERF: sin leer los registros de compilación en el primer uso de cada programa (viajes síncronos a la GPU en el primer
  // cuadro, 170–240 ms en escritorio). ?glcheck=1 los activa para depurar.
  renderer.debug.checkShaderErrors = params.get('glcheck') === '1';
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;        // el tone mapping (Khronos PBR Neutral o ACES) lo hace el pase final
  renderer.setClearColor(0x000000, 0);   // alfa = cobertura de la escena; el terciopelo se compone en el pase final
  let dprScale = 1;
  const dpr = () => Math.max(tier.dprMin, Math.min(window.devicePixelRatio || 1, tier.dprMax) * dprScale);
  renderer.setPixelRatio(dpr());
  const size = { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) };
  renderer.setSize(size.w, size.h, false);

  const disposables = [];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(12.8376, size.w / size.h, 0.01, 4);

  // --- carga: manifest + GLB + entorno ---
  const fail = e => { try { renderer.dispose(); renderer.forceContextLoss(); } catch {} canvas.remove(); throw e; };
  const man = await fetch(asset('models/anillos/manifest.json')).then(r => { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); }).catch(fail);
  progress(0.05);
  const hp = man.heroPair;
  if (!hp?.interlock) fail(new Error('manifest sin heroPair.interlock'));
  const files = [hp.engagement, hp.band].map(n => (man.rings.find?.(r => r.name === n)?.file) || (n + '.glb'));
  const loader = new GLTFLoader();
  const loaded = [0, 0], totals = [2.1e6, 0.14e6];
  const report = () => progress(0.05 + 0.7 * (loaded[0] + loaded[1]) / (totals[0] + totals[1]));
  const loadGLB = (f, i) => new Promise((res, rej) => loader.load(asset('models/anillos/' + f.split('/').pop()), g => { loaded[i] = totals[i]; report(); res(g); },
    x => { if (x.total) totals[i] = x.total; loaded[i] = x.loaded; report(); }, rej));
  const texLoader = new THREE.TextureLoader();
  const metalDarkP = new Promise(res => texLoader.load(asset('env/metal_dark.jpg'), t => { t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; res(t); }, undefined, () => res(null)));
  const [gE, gB, metalDark] = await Promise.all([loadGLB(files[0], 0), loadGLB(files[1], 1), metalDarkP]).catch(fail);
  mark('load');
  progress(0.78);

  // --- entorno: PMREM (oro) + cubemap nítido HDR (gemas) ---
  const sbTex = softboxTexture();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studioM = buildStudio({ metalDark, gems: false, tex: sbTex });
  const envRT = pmrem.fromScene(studioM.scene, 0, 0.05, 30);
  const studioG = buildStudio({ metalDark, gems: true, tex: sbTex });
  const cubeRT = new THREE.WebGLCubeRenderTarget(tier.env, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
  const cubeCam = new THREE.CubeCamera(0.05, 30, cubeRT);
  cubeCam.update(renderer, studioG.scene);
  studioM.dispose(); studioG.dispose(); pmrem.dispose();
  mark('env');
  disposables.push(envRT, cubeRT, sbTex);
  if (metalDark) disposables.push(metalDark);
  progress(0.84);

  // --- materiales ---
  const goldHex = man.materials?.metal?.baseColor || '#e6c27a';
  const metalMat = new THREE.MeshPhysicalMaterial({
    name: 'metal', color: new THREE.Color(goldHex).lerp(new THREE.Color('#f0c66e'), 0.35), metalness: 1, roughness: 0.095,
    envMap: envRT.texture, envMapIntensity: 1.5,
  });
  // PERF (nunca "neón"): la cara plana del aro, de frente, refleja ENTERO el softbox principal (×6) cuando el giro de reposo
  // la alinea (~2.7 s por vuelta): todo el aro quedaba a ≈9 en HDR → blanco + halo de bloom. Rodilla suave en las altas
  // luces del oro (tono intacto, máximo ≈2.9): los filos siguen siendo los más brillantes y el bloom queda para las gemas.
  metalMat.onBeforeCompile = sh => {
    sh.uniforms.uHiKnee = { value: 1.5 }; sh.uniforms.uHiRange = { value: 1.4 };
    sh.fragmentShader = 'uniform float uHiKnee; uniform float uHiRange;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      `{ float pk = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
  if (pk > uHiKnee) { float x = pk - uHiKnee; outgoingLight *= (uHiKnee + x / (1.0 + x / uHiRange)) / pk; } }
#include <opaque_fragment>`);
  };
  metalMat.customProgramCacheKey = () => 'oro-rodilla';
  const gemMat = new THREE.ShaderMaterial({
    name: 'gema', vertexShader: GEM_VERT, fragmentShader: GEM_FRAG,
    defines: { BOUNCES: tier.gemFull ? 5 : 3, ...(tier.gemFull ? { GEM_FULL: '' } : {}) },
    uniforms: {
      uEnv: { value: cubeRT.texture }, uEnvRot: { value: new THREE.Matrix3() }, uIor: { value: new THREE.Vector3(2.395, 2.42, 2.46) }, uBright: { value: 1.18 },
      uSparkle: { value: 0 }, uAlpha: { value: 1 }, uGold: { value: new THREE.Color('#e8c48a').multiplyScalar(0.42) }, uObstruct: { value: 0.88 },
    },
  });
  let physGem = null;
  if (gemMode === 'physical') {
    physGem = new THREE.MeshPhysicalMaterial({
      name: 'gema', color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, thickness: 0.0025, ior: 2.33, dispersion: 6,
      specularIntensity: 1, envMap: cubeRT.texture, envMapIntensity: 2.2,
    });
    disposables.push(physGem);
  }
  disposables.push(metalMat, gemMat);

  const E = prepareRing(gE, hp.engagement, metalMat, gemMat, physGem);
  const B = prepareRing(gB, hp.band, metalMat, gemMat, physGem);
  progress(0.88);

  // --- poses finales (manifest) ---
  const IL = hp.interlock;
  const fin = {
    pE: new THREE.Vector3().fromArray(IL.engagement.position), qE: new THREE.Quaternion().fromArray(IL.engagement.quaternion).normalize(),
    pB: new THREE.Vector3().fromArray(IL.band.position), qB: new THREE.Quaternion().fromArray(IL.band.quaternion).normalize(),
  };
  const eInfo = man.rings.find?.(r => r.name === hp.engagement) || {};
  mark('prep');
  const plan = planThreading(E, B, fin, ((eInfo.outerDiameter || 0.021) + (eInfo.innerDiameter || 0.0177)) / 4);
  mark('plan');

  // --- escena ---
  const pair = new THREE.Group(); pair.name = 'pareja';
  const pairInner = new THREE.Group();   // retroceso del clink
  pair.add(pairInner);
  pairInner.add(E.object, B.object);
  scene.add(pair);
  E.object.visible = B.object.visible = false;

  // fondo
  const velvetRT = new THREE.WebGLRenderTarget(tierName === 'high' ? 2048 : 1024, tierName === 'high' ? 832 : 416,
    { depthBuffer: false, wrapS: THREE.MirroredRepeatWrapping, wrapT: THREE.MirroredRepeatWrapping });
  {
    const m = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader: VELVET_BAKE_FRAG, depthTest: false, depthWrite: false });
    const fq = new FullScreenQuad(m);
    renderer.setRenderTarget(velvetRT); fq.render(renderer); renderer.setRenderTarget(null);
    fq.dispose(); m.dispose();
  }
  disposables.push(velvetRT);


  // polvo de oro
  const dustCount = Math.round(tier.dust * (reduced ? 0.35 : 1));
  const dustGeo = new THREE.BufferGeometry();
  {
    const seed = new Float32Array(dustCount * 4), rnd = new Float32Array(dustCount * 4), pos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      // 62 % destellos cerca del plano de foco · 33 % bokeh lejano · 5 % bokeh grande delante
      const zr = Math.random();
      const z = zr < 0.62 ? 0.50 + (Math.random() - 0.5) * 0.30 : zr < 0.95 ? Math.random() * 0.32 : 0.80 + Math.random() * 0.10;
      seed[4 * i] = Math.random(); seed[4 * i + 1] = Math.random(); seed[4 * i + 2] = z; seed[4 * i + 3] = Math.random();
      for (let k = 0; k < 4; k++) rnd[4 * i + k] = Math.random();
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    dustGeo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    dustGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  }
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, ...ADD,
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 1 }, uFocus: { value: 0.27 }, uAperture: { value: 0.22 },
      uBoxMin: { value: new THREE.Vector3() }, uBoxSize: { value: new THREE.Vector3(1, 1, 1) }, uShockPos: { value: new THREE.Vector3() },
      uShockAge: { value: -1 }, uFlow: { value: 1 }, uLightPos: { value: new THREE.Vector3() }, uDim: { value: 1 }, uSpeed: { value: reduced ? 0.35 : 1 },
    },
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.renderOrder = 5; dust.frustumCulled = false;
  scene.add(dust);
  disposables.push(dustGeo, dustMat);

  // chispas
  const sparkCount = reduced ? 0 : tier.sparks;
  let sparks = null, sparkMat = null;
  if (sparkCount) {
    const g = new THREE.BufferGeometry();
    const dir = new Float32Array(sparkCount * 4), rnd = new Float32Array(sparkCount * 4);
    const v = new THREE.Vector3();
    for (let i = 0; i < sparkCount; i++) {
      v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.45).normalize();
      dir[4 * i] = v.x; dir[4 * i + 1] = v.y; dir[4 * i + 2] = v.z; dir[4 * i + 3] = 0.05 + Math.pow(Math.random(), 1.8) * 0.32;
      for (let k = 0; k < 4; k++) rnd[4 * i + k] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sparkCount * 3), 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 4));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    sparkMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, ...ADD,
      uniforms: { uAge: { value: -1 }, uOrigin: { value: new THREE.Vector3() }, uScale: { value: 1 }, uUnit: { value: 1 } },
    });
    sparks = new THREE.Points(g, sparkMat);
    sparks.renderOrder = 6; sparks.frustumCulled = false; sparks.visible = false;
    scene.add(sparks);
    disposables.push(g, sparkMat);
  }

  // onda expansiva + destello del clink (billboards)
  const quad = new THREE.PlaneGeometry(1, 1);
  disposables.push(quad);
  const shockMat = new THREE.ShaderMaterial({
    vertexShader: BILLBOARD_VERT, fragmentShader: SHOCK_FRAG, transparent: true, depthWrite: false, depthTest: false, ...ADD,
    uniforms: { uAge: { value: 0 }, uSize: { value: 0.09 } },
  });
  const shock = new THREE.Mesh(quad, shockMat);
  shock.renderOrder = 7; shock.frustumCulled = false; shock.visible = false;
  scene.add(shock); disposables.push(shockMat);

  // estrellas: una por gema (+1 para el destello del clink)
  const allGems = [...E.gems.map(g => ({ ...g, ring: E })), ...B.gems.map(g => ({ ...g, ring: B }))];
  const nStars = allGems.length + 1;
  const maxGem = Math.max(0.001, ...allGems.map(g => g.size));
  const starGeo = new THREE.InstancedBufferGeometry();
  starGeo.index = quad.index;
  starGeo.setAttribute('position', quad.attributes.position);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(nStars * 3), 3); iPos.setUsage(THREE.DynamicDrawUsage);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(nStars * 4), 4); iData.setUsage(THREE.DynamicDrawUsage);
  starGeo.setAttribute('iPos', iPos); starGeo.setAttribute('iData', iData);
  starGeo.instanceCount = nStars;
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, transparent: true, depthWrite: false, depthTest: true, ...ADD,
    uniforms: { uAnamorph: { value: 0.0 } },
  });
  const stars = new THREE.Mesh(starGeo, starMat);
  stars.renderOrder = 8; stars.frustumCulled = false;
  scene.add(stars);
  disposables.push(starGeo, starMat);

  // direcciones de luz clave (para destellos que dependen del giro real)
  const keyLights0 = [new THREE.Vector3(-2.6, 3.0, 2.5), new THREE.Vector3(3.3, 0.9, 1.9), new THREE.Vector3(0.2, 3.9, 0.3), new THREE.Vector3(-3.7, 0.5, -0.5), new THREE.Vector3(1.9, 1.5, -3.5)].map(v => v.normalize());
  const keyLights = keyLights0.map(v => v.clone());   // PERF: giran con el entorno cuando la pareja rueda en vertical
  const envRot = { qAB: new THREE.Quaternion(), qR: new THREE.Quaternion(), qW: new THREE.Quaternion(), m4: new THREE.Matrix4(), e: new THREE.Euler(), last: 1e9 };

  // --- post ---
  const rt = new THREE.WebGLRenderTarget(size.w * renderer.getPixelRatio(), size.h * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: tier.msaa });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.w, size.h);
  composer.addPass(new RenderPass(scene, camera));
  // PERF: umbral más alto y tope por píxel más bajo: el bloom queda para los destellos de las gemas y los filos del oro;
  // una cara de oro iluminada pareja (≈2–3 en HDR) ya no se convierte en un halo de neón.
  const bloom = new BloomLite({ threshold: 2.0, knee: 0.6, levels: 5, first: 4, clampMax: 14 });
  bloom.enabled = tier.bloom;
  bloom.strength = 0.55;
  composer.addPass(bloom);
  const finalPass = new ShaderPass(FINAL_SHADER);
  composer.addPass(finalPass);
  // FIX (memoria de GPU en teléfonos): el pase final dibuja en pantalla; sin intercambio, el RenderPass escribe siempre en
  // renderTarget1 y renderTarget2 (otro MSAA×4 HDR con profundidad, ≈ 42 MB en 390×844 y 105 MB en una tableta) nunca se asigna.
  finalPass.needsSwap = false;
  const FU = finalPass.uniforms;
  FU.tBloom.value = bloom.texture;
  FU.tVelvet.value = velvetRT.texture;
  if ((opts.toneMap || params.get('tone') || 'neutral') !== 'aces') { finalPass.material.defines.NEUTRAL = ''; finalPass.material.needsUpdate = true; }
  const BLOOM_K = +(params.get('bloomk') || 0.5);
  const EXPOSURE = +(params.get('exp') || 1.16);
  if (reduced) { FU.uGrain.value = 0.02; FU.uCA.value = 0.0012; }

  // --- encuadre (cámara larga 12.84° de pareja.jpg; los anillos ocupan la franja superior, el texto va abajo) ---
  const PAIR_D = 0.034;
  const view = { dist: 0.27, visH: 0.06, center: 0.38, aspect: 1 };
  const camDir = new THREE.Vector3().fromArray(hp.camera?.position || [0, 0.0105, 0.205]).sub(new THREE.Vector3().fromArray(hp.camera?.target || [0, 0.0005, 0])).normalize();
  const baseElev = Math.asin(camDir.y);
  function layout() {
    const w = size.w, h = size.h, aspect = w / h;
    view.aspect = aspect;
    const portrait = aspect < 0.8;
    view.center = portrait ? 0.335 : aspect < 1.25 ? 0.355 : 0.37;
    const zone = portrait ? 0.43 : aspect < 1.25 ? 0.5 : 0.53;
    const pairPx = Math.min(zone * h, (portrait ? 0.88 : 0.62) * w);
    view.visH = PAIR_D * h / pairPx;
    const fov = camera.fov * Math.PI / 180;
    view.dist = view.visH / (2 * Math.tan(fov / 2));
    camera.aspect = aspect;
    camera.setViewOffset(w, h, 0, (0.5 - view.center) * h, w, h);
    camera.updateProjectionMatrix();
    // caja del polvo relativa al encuadre
    const hw = view.visH * aspect * 0.62, hh = view.visH * 0.66;
    dustMat.uniforms.uBoxMin.value.set(-hw, -hh * 1.15, -view.dist * 0.75);
    dustMat.uniforms.uBoxSize.value.set(hw * 2, hh * 2.1, view.dist * 1.33);
    dustMat.uniforms.uFocus.value = view.dist;
    const pxScale = renderer.getPixelRatio() * (h / 900);
    dustMat.uniforms.uScale.value = pxScale;
    if (sparkMat) { sparkMat.uniforms.uScale.value = pxScale; sparkMat.uniforms.uUnit.value = view.visH / 0.06; }
    FU.uPoolR.value = portrait ? 0.28 : 0.34;
    FU.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }
  let asleep = false;   // FIX · memoria: dormido = destinos de render y lienzo a 1×1 (ver sleep()/wake())
  function resize() {
    if (asleep) return;
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    if (w === size.w && h === size.h && renderer.getPixelRatio() === dpr()) return;
    size.w = w; size.h = h;
    renderer.setPixelRatio(dpr());
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    layout();
    setupArcs();
    needsFrame = true;
  }
  layout();

  // --- coreografía ---
  // FIX: vuelo más largo (2.2 s) y giro con easeOutCubic: la puerta se abre ~1 s después de empezar la intro y el
  // invitado debe ver a los anillos llegar girando (antes el 98 % del giro ocurría detrás de las solapas).
  const TL = reduced ? { fly: 0, approach: 0, snap: 0, end: 1.1 } : { fly: 2.2, approach: 3.9, snap: 0.15, end: 7.3 };
  const sStage = plan.s2 + 0.012, sPre = plan.s2 + 0.0042;
  const sMid = (plan.s1 + plan.s2) / 2;
  const tauC = 1 - Math.cbrt(sMid / sPre);
  const tClink = reduced ? 1.0 : TL.approach + tauC * TL.snap;
  const tSnapEnd = TL.approach + TL.snap;
  // base ortonormal perpendicular a la dirección de llegada (espiral)
  const n1 = new THREE.Vector3().crossVectors(plan.u, new THREE.Vector3(0, 0, 1));
  if (n1.lengthSq() < 1e-6) n1.set(0, 1, 0);
  n1.normalize();
  const n2 = new THREE.Vector3().crossVectors(plan.u, n1).normalize();
  let spiralR = 0.0062;
  // puntos de control de los arcos (se recalculan con el encuadre)
  const ctrl = { E: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], B: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] };
  const stageB = new THREE.Vector3();
  function setupArcs() {
    const halfW = view.visH * Math.max(view.aspect, 0.6) / 2;
    const off = halfW + 0.03;
    const h = view.visH;
    ctrl.E[0].set(-off - 0.01, h * 0.42, -0.04);
    ctrl.E[1].set(-off * 0.35, h * 0.62, 0.025);
    ctrl.E[2].set(-0.012, -h * 0.30, 0.03);
    stageB.copy(fin.pB).addScaledVector(plan.u, sStage).addScaledVector(n1, spiralR);
    ctrl.B[0].set(off + 0.012, -h * 0.40, 0.05);
    ctrl.B[1].set(off * 0.42, -h * 0.66, 0.02);
    ctrl.B[2].set(stageB.x + 0.026, stageB.y + h * 0.36, stageB.z - 0.02);
  }
  setupArcs();
  const E_SPIN_AXIS = new THREE.Vector3(0.25, 1, 0.15).normalize();
  const B_TUMBLE_AXIS = new THREE.Vector3(1, 0.3, 0).normalize();
  const Z = new THREE.Vector3(0, 0, 1);
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
  const pose = { pE: new THREE.Vector3(), qE: new THREE.Quaternion(), pB: new THREE.Vector3(), qB: new THREE.Quaternion() };
  function poseAt(t, o) {
    if (reduced) { o.pE.copy(fin.pE); o.qE.copy(fin.qE); o.pB.copy(fin.pB); o.qB.copy(fin.qB); return o; }
    // compromiso
    if (t < TL.fly) {
      const x = clamp01(t / TL.fly);
      bezier(ctrl.E[0], ctrl.E[1], ctrl.E[2], fin.pE, easeOutCubic(x), o.pE);
      _q.setFromAxisAngle(E_SPIN_AXIS, -3.2 * Math.PI * (1 - easeOutCubic(x)));
      o.qE.copy(fin.qE).multiply(_q);
    } else { o.pE.copy(fin.pE); o.qE.copy(fin.qE); }
    // alianza
    const psi = -4 * Math.PI * (1 - easeOutCubic(Math.min(1, t / tSnapEnd)) );
    if (t < TL.fly) {
      const x = clamp01(t / TL.fly);
      bezier(ctrl.B[0], ctrl.B[1], ctrl.B[2], stageB, easeOutCubic(x), o.pB);
      _q.setFromAxisAngle(Z, psi);
      _q2.setFromAxisAngle(B_TUMBLE_AXIS, 1.7 * (1 - easeOutCubic(x)));
      o.qB.copy(fin.qB).multiply(_q).multiply(_q2);
    } else if (t < TL.approach) {
      const x = clamp01((t - TL.fly) / (TL.approach - TL.fly));
      const s = lerp(sStage, sPre, easeInOutSine(x));
      const r = spiralR * Math.pow(1 - x, 1.25), th = 2.6 * Math.PI * easeInOutSine(x);
      o.pB.copy(fin.pB).addScaledVector(plan.u, s).addScaledVector(n1, r * Math.cos(th)).addScaledVector(n2, r * Math.sin(th));
      _q.setFromAxisAngle(Z, psi);
      o.qB.copy(fin.qB).multiply(_q);
    } else if (t < tSnapEnd) {
      const tau = clamp01((t - TL.approach) / TL.snap);
      const s = sPre * Math.pow(1 - tau, 3);
      o.pB.copy(fin.pB).addScaledVector(plan.u, s);
      _q.setFromAxisAngle(Z, psi);
      o.qB.copy(fin.qB).multiply(_q);
    } else {
      // vaivén amortiguado alrededor del aro de compromiso (sin colisión, amplitud verificada)
      const tt = t - tSnapEnd;
      const ang = plan.swingAmp * 0.85 * Math.sin(tt * 2 * Math.PI / 0.78) * Math.exp(-tt / 0.62);
      _q.setFromAxisAngle(plan.swingA, ang);
      o.pB.copy(fin.pB).sub(plan.swingP).applyQuaternion(_q).add(plan.swingP);
      o.qB.copy(_q).multiply(fin.qB);
    }
    return o;
  }
  // verificación: recorre toda la intro y registra los intervalos con interpenetración
  const verify = (() => {
    if (reduced) return { intervals: [], ok: true };
    const mE = new THREE.Matrix4(), mB = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    const run = () => {
      const iv = []; let cur = null;
      for (let t = 0; t <= TL.end; t += 1 / 150) {
        poseAt(t, pose);
        mE.compose(pose.pE, pose.qE, one); mB.compose(pose.pB, pose.qB, one);
        const h = plan.collide(mE, mB, 3);
        if (h) { if (!cur) cur = [t, t]; else cur[1] = t; } else if (cur) { iv.push(cur); cur = null; }
      }
      if (cur) iv.push(cur);
      return iv;
    };
    let iv = run();
    for (let k = 0; k < 3 && iv.some(([a, b]) => b < TL.approach - 1e-3 || a > tSnapEnd + 1e-3); k++) { spiralR *= 0.5; setupArcs(); iv = run(); }
    return { intervals: iv.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]), ok: !iv.some(([a, b]) => b < TL.approach - 1e-3 || a > tSnapEnd + 1e-3) };
  })();
  mark('verify');

  // --- estado ---
  const st = {
    time: 0, introT: -1, introStarted: false, introDone: false, clinked: false, clinkTime: -10, frozen: false, introRate: 1, roll: 0,
    scroll: 0, sparkT: -10, paused: false, visible: true, pageVisible: !document.hidden, running: false,
    yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, idleAng: 0, gyro: null, zoom: +(params.get('zoom') || 1), focus: params.get('focus') || '',
  };
  let needsFrame = true, disposed = false, ready = false;
  let introResolve = null, introPromise = null, safetyTimer = 0;
  const contactW = new THREE.Vector3();
  const pairCenterW = new THREE.Vector3();
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), camTarget = new THREE.Vector3();

  function fireClink() {
    if (st.clinked) return;
    st.clinked = true;
    st.clinkTime = st.time - Math.max(0, st.introT - tClink);
    try { opts.onClink?.(); } catch (e) { console.warn('[rings3d] onClink', e); }
    st.sparkT = st.time + 0.05;
    if (introResolve) { const r = introResolve; introResolve = null; r(); }
  }

  // --- interacción: parallax con puntero/giroscopio ---
  const onPointer = e => {
    const r = container.getBoundingClientRect();
    st.tYaw = ((e.clientX - r.left) / r.width - 0.5) * 2;
    st.tPitch = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  const onLeave = () => { st.tYaw = 0; st.tPitch = 0; };
  window.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  let onOrient = null;
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function' && matchMedia?.('(pointer: coarse)').matches) {
    onOrient = e => {
      if (e.beta == null || e.gamma == null) return;
      if (!st.gyro) st.gyro = { b: e.beta, g: e.gamma };
      st.tYaw = Math.max(-1, Math.min(1, (e.gamma - st.gyro.g) / 25));
      st.tPitch = Math.max(-1, Math.min(1, (e.beta - st.gyro.b) / 25));
    };
    window.addEventListener('deviceorientation', onOrient, { passive: true });
  }

  // --- visibilidad ---
  const io = new IntersectionObserver(es => { for (const e of es) st.visible = e.isIntersecting; schedule(); }, { threshold: 0 });
  io.observe(container);
  const onVis = () => { st.pageVisible = !document.hidden; schedule(); };
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  const onWinResize = () => resize();
  window.addEventListener('resize', onWinResize);

  // --- actualización por cuadro ---
  const fpsState = { frames: 0, t0: performance.now(), fps: 0, low: 0, hist: [] };
  function updateStars(introT) {
    const arr = iPos.array, dat = iData.array;
    const camPos = camera.position;
    const sinceSpark = st.time - st.sparkT;
    const vis = (E.object.visible ? 1 : 0);
    for (let i = 0; i < allGems.length; i++) {
      const g = allGems[i];
      const obj = g.ring.object;
      tmpV.copy(g.center).applyMatrix4(obj.matrixWorld);
      arr[3 * i] = tmpV.x; arr[3 * i + 1] = tmpV.y; arr[3 * i + 2] = tmpV.z;
      // eje de la gema en mundo y destello cuando una faceta refleja una luz clave hacia la cámara
      tmpV2.copy(camPos).sub(tmpV).normalize();
      _q.setFromRotationMatrix(obj.matrixWorld);
      _v.copy(g.axis).applyQuaternion(_q);
      const facing = smooth(-0.05, 0.55, _v.dot(tmpV2));
      let glint = 0;
      for (let f = 0; f < g.facets.length; f++) {
        const n = tmpV.copy(g.facets[f]).applyQuaternion(_q);
        // reflejo de la dirección de vista en la faceta
        const d = 2 * n.dot(tmpV2);
        const rx = n.x * d - tmpV2.x, ry = n.y * d - tmpV2.y, rz = n.z * d - tmpV2.z;
        for (let l = 0; l < keyLights.length; l++) {
          const L = keyLights[l];
          const c = rx * L.x + ry * L.y + rz * L.z;
          if (c > 0.985) glint = Math.max(glint, Math.pow((c - 0.985) / 0.015, 2.2) * (l === 0 ? 1 : 0.7));
        }
      }
      const tw = Math.pow(Math.max(0, Math.sin(st.time * (0.6 + g.seed * 1.3) + g.seed * 40)), 24) * 0.55;
      let flare = 0;
      if (sinceSpark > -0.1) { const dl = sinceSpark - g.seed * 0.22; if (dl > 0) flare = Math.exp(-dl * 5.5) * (1 - Math.exp(-dl * 40)); }
      const base = g.big ? 0.10 : 0.0;
      let I = (base + glint * (g.big ? 1.25 : 0.85) + tw * (g.big ? 0.6 : 0.35) + flare * (g.big ? 1.4 : 0.9)) * facing * vis;
      if (reduced) I *= 0.6;
      const sizeM = view.visH * 0.34 * Math.pow(g.size / maxGem, 0.75) * (0.8 + 0.35 * Math.min(1, glint + flare));
      dat[4 * i] = sizeM; dat[4 * i + 1] = I * FU.uDim.value; dat[4 * i + 2] = 0.21 + (g.seed - 0.5) * 0.08; dat[4 * i + 3] = g.seed > 0.82 ? 0.7 : 0.1;
    }
    // destello del clink (en el punto de contacto) — cubre el instante del cruce
    const k = allGems.length;
    let fl = 0;
    if (!reduced && st.introStarted) {
      const dt = introT - tClink;
      if (dt > -0.06 && dt < 1.4) fl = dt < 0 ? Math.pow((dt + 0.06) / 0.06, 2) : Math.exp(-dt * 9.0) * 0.88 + Math.exp(-dt * 2.2) * 0.12;
    }
    tmpV.copy(plan.contact); pairInner.localToWorld(tmpV);
    contactW.copy(tmpV);
    arr[3 * k] = tmpV.x; arr[3 * k + 1] = tmpV.y; arr[3 * k + 2] = tmpV.z;
    dat[4 * k] = PAIR_D * 1.45; dat[4 * k + 1] = fl * 2.6; dat[4 * k + 2] = 0.21; dat[4 * k + 3] = 0.15;
    iPos.needsUpdate = true; iData.needsUpdate = true;
    return fl;
  }

  function update(dt) {
    st.time += dt;
    const time = st.time;
    // (introRate ≠ 1 solo hasta el clink: estira/encoge la intro para que el clink caiga en un pulso de la canción)
    if (st.introStarted && !st.frozen) st.introT += dt * (st.clinked ? 1 : st.introRate);
    const it = st.introT;
    // anillos
    if (st.introStarted) {
      poseAt(Math.max(0, it), pose);
      E.object.position.copy(pose.pE); E.object.quaternion.copy(pose.qE);
      B.object.position.copy(pose.pB); B.object.quaternion.copy(pose.qB);
      if (!st.clinked && it >= tClink) fireClink();
      if (!st.introDone && it >= TL.end) st.introDone = true;
    }
    // fundido (movimiento reducido)
    if (reduced && st.introStarted) {
      const a = smooth(0, 0.9, it);
      gemMat.uniforms.uAlpha.value = a;
      metalMat.opacity = a;
      const tr = a < 1;
      if (metalMat.transparent !== tr) { metalMat.transparent = tr; metalMat.needsUpdate = true; gemMat.transparent = tr; gemMat.needsUpdate = true; }
    }
    // reposo: giro conjunto lento + flotación
    const settle = st.introStarted ? smooth(tSnapEnd + 0.8, tSnapEnd + 4.0, it) : 0;
    const w = (reduced ? 0.05 : 0.13) * settle;
    st.idleAng += w * dt;
    const introYaw = st.introStarted && !reduced ? -0.32 * (1 - easeInOutCubic(it / tClink)) : 0;
    // FIX (móvil vertical): la pareja gira en el plano durante la intro para que la alianza llegue desde ABAJO (en horizontal
    // esperaba fuera del cuadro); tras el clink vuelve a su pose con un giro suave mientras la alianza se balancea.
    const roll = st.roll && st.introStarted ? st.roll * (it < tSnapEnd ? 1 : 1 - easeInOutCubic(clamp01((it - tSnapEnd) / 1.7))) : 0;
    const rx = 0.035 * Math.sin(time * 0.5) * settle, ry = st.idleAng + introYaw;
    pair.rotation.set(rx, ry, 0.03 * Math.sin(time * 0.37) * settle + roll);
    // PERF (aro de neón en vertical): el giro en el plano rotaba solo la pareja, no el estudio → la cara del aro reflejaba
    // otra zona del entorno y se encendía entera. El entorno (oro y gemas) y las luces de los destellos giran con la
    // pareja: en vertical el oro se ve igual que en horizontal. W = (Rx·Ry)·Rz(roll)·(Rx·Ry)⁻¹ (giro del plano en el mundo).
    if (Math.abs(roll - envRot.last) > 1e-5) {
      envRot.last = roll;
      const E2 = envRot;
      E2.qAB.setFromEuler(E2.e.set(rx, ry, 0, 'XYZ'));
      E2.qR.setFromAxisAngle(Z, roll);
      E2.qW.copy(E2.qAB).multiply(E2.qR).multiply(E2.qAB.invert());
      // metal: three aplica Euler(−x,−y,−z) en el mismo orden → con orden ZYX resulta exactamente W⁻¹ (verificado)
      metalMat.envMapRotation.setFromQuaternion(E2.qW, 'XYZ');
      metalMat.envMapRotation.order = 'ZYX';
      E2.m4.makeRotationFromQuaternion(E2.qW);
      gemMat.uniforms.uEnvRot.value.setFromMatrix4(E2.m4).transpose();   // W⁻¹
      for (let i = 0; i < keyLights.length; i++) keyLights[i].copy(keyLights0[i]).applyQuaternion(E2.qW);
    }
    // retroceso del clink
    const ct = time - st.clinkTime;
    if (st.clinked && ct < 2 && !reduced) {
      const k = Math.exp(-ct / 0.2) * Math.sin(ct * 20);
      pairInner.position.copy(plan.u).multiplyScalar(-0.0011 * k);
      pairInner.rotation.set(0, 0, 0.03 * Math.exp(-ct / 0.3) * Math.sin(ct * 15));
    } else { pairInner.position.set(0, 0, 0); pairInner.rotation.set(0, 0, 0); }
    // scroll: la cámara retrocede, los anillos suben y se apagan
    const sp = st.scroll;
    pair.position.set(0, 0.0012 * Math.sin(time * 0.8) * settle + sp * view.visH * 0.42, 0);
    // cámara
    const ease = 1 - Math.exp(-dt * 3.2);
    st.yaw += (st.tYaw - st.yaw) * ease; st.pitch += (st.tPitch - st.pitch) * ease;
    const push = st.introStarted && !reduced ? 1 + 0.16 * (1 - easeInOutSine(Math.min(1, it / (tClink + 0.3)))) : (st.introStarted ? 1 : 1.12);
    let dist = view.dist * push * (1 + 0.5 * sp);
    let shake = 0;
    if (st.clinked && !reduced && ct < 1.2) { shake = Math.exp(-ct / 0.16); dist *= 1 - 0.018 * Math.exp(-ct / 0.12); }
    const yaw = st.yaw * (reduced ? 0.03 : 0.075) + (st.introStarted && !reduced ? 0.07 * (1 - easeInOutSine(it / 4.5)) : 0);
    const pitch = baseElev + st.pitch * (reduced ? 0.02 : 0.05);
    camTarget.set(0, sp * view.visH * 0.1, 0);
    if (st.zoom > 1.001) {
      dist /= st.zoom;
      const g = st.focus === 'band' ? allGems.find(x => x.ring === B) : allGems.find(x => x.ring === E && x.big);
      if (g) { tmpV2.copy(g.center).applyMatrix4(g.ring.object.matrixWorld); camTarget.lerp(tmpV2, clamp01((st.zoom - 1) / 1.5)); }
    }
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(camTarget);
    camera.lookAt(camTarget);
    if (shake > 0.001) {
      camera.rotateX(Math.sin(time * 91.0) * 0.0026 * shake);
      camera.rotateY(Math.sin(time * 77.0 + 1.3) * 0.0026 * shake);
      camera.rotateZ(Math.sin(time * 53.0 + 0.7) * 0.0035 * shake);
    }
    camera.updateMatrixWorld();
    scene.updateMatrixWorld();
    // estrellas + destello
    const fl = updateStars(it);
    // centro de la pareja en pantalla → charco de luz
    pairCenterW.set(0, 0, 0); pair.localToWorld(pairCenterW);
    tmpV.copy(pairCenterW).project(camera);
    const dim = 1 - 0.9 * smooth(0.12, 0.92, sp);
    FU.uPool.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5 + 0.02);
    FU.uPar.value.set(st.yaw * 0.02, -st.pitch * 0.015);
    // polvo
    const du = dustMat.uniforms;
    du.uTime.value = time;
    du.uLightPos.value.copy(pairCenterW);
    du.uDim.value = 1 - 0.6 * smooth(0.2, 1, sp);
    if (st.clinked && !reduced) { du.uShockAge.value = ct; du.uShockPos.value.copy(contactW); } else du.uShockAge.value = -1;
    // chispas + onda
    if (sparks) {
      const age = st.clinked ? ct : -1;
      sparks.visible = st.clinked && ct < 2.6;
      sparkMat.uniforms.uAge.value = age;
      sparkMat.uniforms.uOrigin.value.copy(contactW);
    }
    if (!reduced) {
      shock.visible = st.clinked && ct < 1.8;
      if (shock.visible) { shock.position.copy(contactW); shockMat.uniforms.uAge.value = ct; shockMat.uniforms.uSize.value = PAIR_D * 1.6; }
    }
    // gema: pulso
    const sinceSpark = time - st.sparkT;
    gemMat.uniforms.uSparkle.value = sinceSpark > 0 ? Math.exp(-sinceSpark * 3.0) * 0.55 : 0;
    // post
    tmpV.copy(contactW).project(camera);
    FU.uFlashPos.value.set(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5);
    FU.uFlash.value = reduced ? 0 : fl * 0.20;
    FU.uExposure.value = EXPOSURE * (1 + 0.10 * fl);
    FU.uCA.value = (reduced ? 0.0012 : 0.0019) * (1 + 5 * fl);
    FU.uTime.value = time;
    FU.uDim.value = dim;
    starMat.uniforms.uAnamorph.value = 0.0;
    // (PERF: el clink sube el bloom ×1.6 como máximo, antes ×2.4: el destello y la onda ya marcan el golpe sin "encender" el oro)
    FU.uBloom.value = bloom.enabled ? BLOOM_K * (1 + 0.6 * fl) * (0.4 + 0.6 * dim) : 0;
  }

  // PERF · calidad adaptativa reversible. Antes cada bajada era permanente y se disparaba también con carga que no es de
  // esta GPU (revelado de los nombres en el DOM, montaje del pergamino): ahora
  //  · no se mide durante la intro, durante hold(ms) (main.js lo pide en el revelado) ni en segundos con un frame largo
  //    del hilo principal (> 100 ms, long-animation-frame/longtask);
  //  · cada paso guarda cómo deshacerse: con 4 s seguidos holgados (≥ objetivo + 10 fps) se recupera el último paso;
  //  · si vuelve a caer antes de 8 s tras recuperar, se queda en ese nivel (sin oscilar).
  const undos = [];
  let holdUntil = 0, lastLong = 0, lastUndo = -1e9, upLocked = false;
  try {
    // solo frames largos con JS AJENO que bloquee el hilo (los que esperan a la GPU sí deben bajar la calidad)
    const po = new PerformanceObserver(l => {
      for (const e of l.getEntries()) {
        if (e.duration < 100) continue;
        let other = 0;
        for (const s of e.scripts || []) if (!/rings3d\.js/.test(s.sourceURL || '')) other += s.duration || 0;
        const ajeno = e.entryType !== 'long-animation-frame' || ((e.blockingDuration ?? 0) >= 50 && other >= 50);
        if (ajeno) lastLong = Math.max(lastLong, e.startTime + e.duration);
      }
    });
    try { po.observe({ type: 'long-animation-frame', buffered: false }); } catch { po.observe({ type: 'longtask', buffered: false }); }
    disposables.push({ dispose: () => po.disconnect() });
  } catch {}
  const setSamples = n => { const r = composer.readBuffer; if (r.samples !== n) { r.samples = n; r.dispose(); } }; // (el otro destino no se usa)
  function stepDown() {
    const push = (name, undo) => { quality.steps.push(name); quality.history.push('↓' + name); undos.push(undo); };
    if (dpr() > tier.dprMin + 0.01) { const prev = dprScale; dprScale *= 0.85; resize(); push('dpr→' + dpr().toFixed(2), () => { dprScale = prev; resize(); }); }
    else if (composer.readBuffer.samples > 2) { const prev = composer.readBuffer.samples; setSamples(2); push('msaa 2', () => setSamples(prev)); }
    else if (dust.visible && dustMat.uniforms.uSpeed.value && dustGeo.drawRange.count === Infinity) { dustGeo.setDrawRange(0, Math.floor(dustCount * 0.5)); push('polvo 50%', () => dustGeo.setDrawRange(0, Infinity)); }
    else if (bloom.enabled) { bloom.enabled = false; push('bloom off', () => { bloom.enabled = tier.bloom; }); }
  }
  function adapt(now) {
    const f = fpsState;
    f.frames++;
    if (now - f.t0 < 1000) return;
    const t0 = f.t0;
    f.fps = Math.round(f.frames * 1000 / (now - f.t0));
    f.frames = 0; f.t0 = now;
    api.fps = f.fps;
    const busy = (st.introStarted && st.introT < tClink + 1.5) || now < holdUntil || lastLong > t0 - 50;
    if (!adaptOn || busy || st.time <= 3) { f.low = 0; f.good = 0; return; }
    // FIX (modo de bajo consumo de iOS / ahorro de batería de Android: rAF limitado a 30 Hz con la GPU ociosa): con cuadros
    // cuantizados a ~33 ms el objetivo pasa a 27 fps (antes bajaba la calidad para siempre sin ganar nada)
    const target = cap30() ? Math.min(tier.targetFps, 27) : tier.targetFps;
    if (f.fps < target) { f.low++; f.good = 0; }
    else { f.low = Math.max(0, f.low - 1); f.good = f.fps >= target + 10 ? (f.good || 0) + 1 : 0; }
    if (f.low >= 2) {
      f.low = 0; f.good = 0;
      if (now - lastUndo < 8000) upLocked = true;
      stepDown();
    } else if (f.good >= 4 && undos.length && !upLocked) {
      f.good = 0; lastUndo = now;
      const name = quality.steps.pop();   // quality.steps = lo que sigue aplicado; quality.history = todo lo ocurrido
      undos.pop()();
      quality.history.push('↑' + name);
    }
  }

  // FIX · tope de 30 Hz (bajo consumo): intervalos entre callbacks de rAF (los últimos 64)
  const ivs = new Float32Array(64); let ivN = 0;
  function cap30() {
    const n = Math.min(ivN, 64);
    if (n < 40) return false;
    const a = Array.from(ivs.subarray(0, n)).sort((x, y) => x - y);
    const med = a[n >> 1], p90 = a[Math.floor(n * 0.9)];
    return med > 31 && med < 35.5 && p90 < 38;
  }
  let raf = 0, last = 0, skip = 0;
  function loop(now) {
    raf = 0;
    if (!shouldRun()) { st.running = false; return; }
    raf = requestAnimationFrame(loop);
    if (last && now - last < 200) ivs[(ivN++) & 63] = now - last;
    // poses analíticas: se puede avanzar con el tiempo real (solo se recorta un tirón grande)
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 1 / 60;
    last = now;
    // antes de la intro (la puerta tapa el hero) basta con ~30 fps
    if (!st.introStarted && (skip++ & 1) && !needsFrame) return;
    needsFrame = false;
    update(dt);
    // PERF-RETOMA: la calidad se ajusta ANTES de dibujar: un cambio de DPR redimensiona (y borra) el lienzo; hecho después
    // del dibujo, ese cuadro se mostraba vacío (parpadeo de los anillos en cada bajada/subida; a 2–5 fps se veía medio segundo)
    adapt(now);
    composer.render(dt);
  }
  function shouldRun() { return ready && !st.paused && !asleep && st.visible && st.pageVisible && !disposed; }
  function schedule() {
    // (PERF: al reanudar se reinicia la ventana de fps; si no, el primer segundo medía el tiempo en pausa como "fps bajo")
    if (shouldRun() && !raf) { last = 0; st.running = true; fpsState.frames = 0; fpsState.t0 = performance.now(); raf = requestAnimationFrame(loop); }
    else if (!shouldRun() && raf) { cancelAnimationFrame(raf); raf = 0; st.running = false; }
  }

  // --- precompilación (sin tirones en la intro) ---
  progress(0.9);
  E.object.visible = B.object.visible = true; shock.visible = true; if (sparks) sparks.visible = true;
  poseAt(TL.end, pose);
  E.object.position.copy(pose.pE); E.object.quaternion.copy(pose.qE); B.object.position.copy(pose.pB); B.object.quaternion.copy(pose.qB);
  layout();
  camera.position.set(0, 0, view.dist); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  try {
    // los materiales de post (bloom + pase final) también se compilan en paralelo (KHR_parallel_shader_compile)
    const post = new THREE.Scene();
    for (const m of [finalPass.material, bloom.mDown, bloom.mUp]) { const o = new THREE.Mesh(quad, m); o.frustumCulled = false; post.add(o); }
    // FIX: la escena se dibuja en el destino del EffectComposer (lineal, sin tone mapping): hay que compilar ESA variante.
    // Con el destino en null (sRGB) serían otros programas y el primer cuadro los recompilaba de forma síncrona (~0.9 s).
    // compile() fija los parámetros al llamarse, así que el destino se cambia y se restaura sin esperar a las promesas.
    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(null);
    const pFinal = renderer.compileAsync(post, camera);              // el pase final dibuja en pantalla
    renderer.setRenderTarget(composer.readBuffer);
    const pPost = renderer.compileAsync(post, camera);               // bloom (a destinos intermedios)
    const pScene = renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(prevRT);
    await Promise.all([pScene, pPost, pFinal]);
  } catch {}
  mark('compile');
  update(0); composer.render(0);
  mark('firstFrame');
  E.object.visible = B.object.visible = false; shock.visible = false; if (sparks) sparks.visible = false;
  progress(0.98);

  const quality = { tier: tierName, gemMode, steps: [], history: [] };
  const api = {
    fps: 0,
    quality,
    /** PERF: no adaptar la calidad durante ms (carga ajena a la GPU de los anillos, p. ej. el revelado de los nombres). */
    hold(ms = 4000) { holdUntil = Math.max(holdUntil, performance.now() + (+ms || 0)); },
    /** PERF: coste real de GPU en ms por cuadro (n cuadros con sincronización forzada por readPixels). Para que main.js
     *  confirme una GPU débil antes de cambiar el 3D por la imagen. Bloquea ~n cuadros: usar solo como confirmación. */
    gpuCost(n = 3) {
      const gl = renderer.getContext(), px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      composer.render(0); sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) composer.render(0);
      sync();
      return +((performance.now() - t0) / Math.max(1, n)).toFixed(1);
    },
    /** opts.clinkIn (s, opcional): en cuánto tiempo debe sonar el clink (p. ej. en el siguiente pulso de la canción);
     *  la intro se acelera o frena hasta un ±15–20 % para lograrlo. */
    intro(o = {}) {
      if (introPromise) return introPromise;
      introPromise = new Promise(res => { introResolve = res; });
      st.introStarted = true; st.introT = 0; st.clinked = false;
      st.introRate = !reduced && o.clinkIn > 0 ? Math.min(1.2, Math.max(0.84, tClink / o.clinkIn)) : 1;
      // móvil/tableta en vertical: la alianza llega desde abajo (la pareja rota en su plano y vuelve tras el clink)
      st.roll = !reduced && view.aspect < 0.8 ? Math.max(-1.7, Math.min(1.7, -Math.PI / 2 - Math.atan2(plan.u.y, plan.u.x))) : 0;
      E.object.visible = B.object.visible = true;
      needsFrame = true; schedule();
      // si la pestaña está oculta o la vista pausada, que la promesa no quede colgada
      safetyTimer = setTimeout(() => { if (introResolve && !st.frozen) { st.introT = Math.max(st.introT, tClink); fireClink(); } }, (tClink + 6) * 1000);
      return introPromise;
    },
    /** Segundos desde intro() hasta el clink (a velocidad normal). */
    get clinkTime() { return tClink; },
    setScroll(p) { st.scroll = clamp01(+p || 0); needsFrame = true; },
    sparkle() { st.sparkT = st.time; },
    pause() { st.paused = true; schedule(); },
    resume() { st.paused = false; schedule(); },
    /** FIX (memoria de GPU en teléfonos de 2–4 GB): con el hero lejos, suelta los destinos de render (escena MSAA HDR, bloom)
     *  y el lienzo (todo a 1×1) sin perder modelos, entorno ni programas. wake() los recrea al volver (un cuadro). */
    sleep() {
      if (asleep || disposed) return;
      asleep = true; schedule();
      try { renderer.setSize(1, 1, false); composer.setPixelRatio(1); composer.setSize(1, 1); } catch {}
    },
    wake() {
      if (!asleep || disposed) return;
      asleep = false; size.w = 0; resize(); needsFrame = true; schedule();
    },
    get asleep() { return asleep; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      clearTimeout(safetyTimer);
      io.disconnect(); ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('resize', onWinResize);
      if (onOrient) window.removeEventListener('deviceorientation', onOrient);
      scene.traverse(o => { if (o.isMesh || o.isPoints) { o.geometry?.dispose?.(); } });
      for (const d of disposables) d.dispose?.();
      composer.passes.forEach(p => p.dispose?.());
      rt.dispose(); composer.renderTarget2?.dispose?.();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch {}
      canvas.remove();
      if (introResolve) { introResolve(); introResolve = null; }
    },
    // ganchos de prueba (no forman parte del contrato)
    _debug: {
      zoom(z, focus = '') { st.zoom = z; st.focus = focus; needsFrame = true; },
      seek(t) { if (!st.introStarted) api.intro(); st.introT = t; st.frozen = true; st.clinked = t >= tClink; st.clinkTime = st.time - (t - tClink); needsFrame = true; },
      play() { st.frozen = false; },
      /** Fija el ángulo del giro de reposo (rad) para capturas deterministas. */
      idle(a) { st.idleAng = +a || 0; needsFrame = true; },
      get objects() { return { scene, camera, pair, E: E.object, B: B.object, metalMat, gemMat, bloom, FU }; },
      bench(n = 40) {
        const gl = renderer.getContext(), px = new Uint8Array(4);
        const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let i = 0; i < 4; i++) { update(1 / 60); composer.render(1 / 60); } sync();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { update(1 / 60); composer.render(1 / 60); }
        sync();
        return +((performance.now() - t0) / n).toFixed(2);
      },
      set(k, v) {
        if (k === 'dust') dust.visible = !!v;
        if (k === 'bloom') bloom.enabled = !!v;
        if (k === 'gems') { E.gemMesh && (E.gemMesh.visible = !!v); B.gemMesh && (B.gemMesh.visible = !!v); }
        if (k === 'rings') { E.object.visible = B.object.visible = !!v; }
        if (k === 'stars') stars.visible = !!v;
        if (k === 'final') finalPass.enabled = !!v;
        if (k === 'bg') FU.uBgDim.value = v ? 1 : 0;
        if (k === 'dpr') { dprScale = v; resize(); }
        needsFrame = true;
      },
      get info() {
        return { tier: tierName, gemMode, dpr: renderer.getPixelRatio(), size: { ...size }, tClink: +tClink.toFixed(3), approachDir: plan.u.toArray().map(v => +v.toFixed(3)),
          window_mm: [+(plan.s1 * 1000).toFixed(2), +(plan.s2 * 1000).toFixed(2)], swingAmpDeg: +(plan.swingAmp * 57.3).toFixed(1), spiralR,
          collisions: verify, contact: plan.contact.toArray().map(v => +v.toFixed(4)), quality: quality.steps, gems: allGems.length,
          view: { ...view }, introT: st.introT, timings, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
      },
    },
  };
  Object.defineProperty(api, 'isIntroDone', { get: () => st.introDone });
  ready = true;
  schedule();
  progress(1);
  return api;
}
