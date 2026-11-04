// js/scroll3d.js — WEB-SCROLL · la escena estrella de la invitación.
// Sobre una mesa de nogal, a la luz de una vela que titila, descansa el pergamino de doble rollo atado con el lazo de satén
// vino (ribbon.js) y sellado con lacre "J & M" (sello.glb). Al tocar el sello: la cámara se acerca → grietas que brillan →
// el sello se parte en sus 4 fragmentos con física (rebote, fricción, migas, chispas) → el lazo se desata (física de tela)
// → el pergamino se eleva y se pone de frente → se desenrolla con inercia y soplo de polvo dorado → el texto se escribe a
// mano (parchment.setWriting si existe) con un barrido de luz sobre el oro → caen pétalos → opts.onOpened().
//
// Contrato (SPEC.md):
//   export async function mountScroll(container, { music?, reducedMotion?, onProgress?(p), onOpened?() })
//     → Promise<{ open(): Promise<void>, readonly isOpen, reset(), setActive(on), dispose(), fps }>
// Extras (no contractuales, para depurar / integrar):
//   opening, opened, phase, quality (nivel 0..4), setQuality(n | null = automático),
//   setSafeArea({ top, bottom, left, right } px: lo que tapa la interfaz en la lectura y el encuadre final — ESCENA),
//   seek(t, scroll?) (simulación determinista de la apertura hasta t s y congela; scroll = progreso fijo 0..1), live(),
//   scene, camera, renderer, parchment, ribbon.
//   ESCENA: setScrollProgress(s), sequence { phase, opening, opened, ctaShown, done, wt, wNat, rate, back, scroll, finalMode },
//   inkwell { position (mundo, mesa y = 0), rotationY }, attachQuill(quill) → Promise<bool>, detachQuill(), quill,
//   legibility { xHeightPx, finalMode, dpr }.
//   opts.quality (nivel fijo), opts.safeArea ({ top, bottom } px que tapa la interfaz del sitio), opts.dprMax.
//
// Estilo antiguo (decisión n.º 4 del SPEC): vela + relleno + contraluz, entorno tenue cálido, motas de polvo en el haz,
// DOF sutil, bloom sutil, viñeta, grano y gradación sepia que sube durante la apertura. Posproceso propio y ligero
// (sin EffectComposer): escena HDR con MSAA → ½ → ¼ (desenfoque para DOF, bloom) → ⅛ (bloom ancho) → composición final.
// Calidad adaptativa: si el fps medio cae bajo 45 baja DPR → DOF → sombras → posproceso → partículas.
// PERF (ronda de rendimiento): (1) `ready`: el bucle no dibuja hasta terminar montaje + calentamiento (antes, si la sección
// entraba a la vista a mitad del montaje, el primer cuadro compilaba y subía todo de golpe: 2–2.7 s congelado);
// (2) texturas decodificadas fuera del hilo y subidas por franjas (uploadInStrips); programas compilados en tandas con mallas
// sustitutas, incluida la pasada de sombras (primer cuadro sin compilaciones); la otra variante (pantalla ↔ HDR) en 2.º plano;
// (3) la calidad se recupera tras una caída pasajera (3 ventanas de 2 s > 50 fps → sube un nivel, hasta 2; si vuelve a caer
// antes de 8 s, ese nivel queda bloqueado); no se mide sin `ready`, 2 s después de quedar listo ni en ventanas con frames
// largos de JS ajeno; (4) L4 mantiene DPR 1 (texto legible) y recorta sombras (mapa 512 que solo se redibuja si algo se
// mueve: también en L3), partículas y posproceso. Extras de la API: ready, gpuCost(n), debug.timing/adapt/feed().
// PERF-RETOMA: los lienzos también suben por franjas; el armado de la escena tras el lazo cede el hilo 3 veces (await idle());
// progreso fino 0.80→0.88 durante la subida (main.js abandona el montaje solo si el progreso no avanza en 30 s).
// Si ESCENA añade armado síncrono pesado, que lo corte igual con `await idle()` (el bucle no corre hasta `ready`).
//
// ESCENA (decisión n.º 5: el pergamino se LEE al navegar):
//  · Ritmo = max(tiempo, scroll): main.js pasa setScrollProgress(s 0..1 del recorrido fijo); la secuencia (sello → lazo → elevar →
//    desenrollar → escribir → alejar → CTAs) sigue al tiempo real y, si el scroll va por delante, acelera con tope (apertura ≤ 3.2×,
//    escritura ≤ 6×, alejar ≤ 2.5×). Nunca retrocede: al volver arriba sigue escrito. La escritura dura P.writing.seconds (21.9 s).
//  · Cámara de lectura: se acerca a la columna de texto y la recorre renglón a renglón (getFocus, suavizado crítico); cuanto más
//    rápido se navega, más se abre el plano. Al terminar se aleja al encuadre final legible (escritorio: hoja completa; móvil
//    vertical: la columna centrada), respetando la zona de los CTA (setSafeArea({ top, bottom, left, right })).
//  · Legible: luz de lectura cálida y pareja (direccional sin sombra + vela clave más frontal: sin la banda oscura bajo el rollo),
//    zona "limpia" sobre la columna en el posproceso (sin sepia/grano/viñeta/bloom/DOF), polvo y chispas ocultos delante del
//    texto y pétalos solo a los lados.
//  · Tintero: lugar reservado en la mesa (api.inkwell) y gancho attachQuill(quill) para js/pluma.js (lo cablea UNIR).
//  · prefers-reduced-motion: sin viaje de cámara (cortes con fundido) y el texto aparece con un fundido corto.

// FIX compatibilidad (iOS < 16.4 sin import maps): URL completa del ESM de jsDelivr, la misma que usan rings3d/pluma/historia/final
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import * as PARCH from './parchment.js'; // extras de PARCH-ANIM (unrollEase, getPen…) se usan solo si existen

import { createRibbon } from './ribbon.js';

const ASSET = (p) => new URL('../assets/' + p, import.meta.url).href;

// ───────────────────────────── utilidades ─────────────────────────────
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t) => -(Math.cos(Math.PI * clamp(t)) - 1) / 2;
function mulberry32(a) {
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const damp = (cur, goal, lambda, dt) => lerp(cur, goal, 1 - Math.exp(-lambda * dt));
// SmoothDamp (crítico, 2.º orden): movimiento de cámara con aceleración y frenado naturales.
function smoothDampV(cur, goal, vel, st, dt) {
  const omega = 2 / Math.max(1e-4, st), x = omega * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  for (const k of ['x', 'y', 'z']) {
    const change = cur[k] - goal[k], temp = (vel[k] + omega * change) * dt;
    vel[k] = (vel[k] - omega * temp) * e;
    cur[k] = goal[k] + (change + temp) * e;
  }
}

// ───────────────────────────── geometría compartida ─────────────────────────────
const { createParchment, CLOSED, DIMENSIONS } = PARCH;
const SHEET_W = DIMENSIONS.W;               // 0.30
const R_C = CLOSED.R;                       // radio del rollo cerrado (≈0.01376)
const Y_C = CLOSED.topCenter[1];            // ±0.01311
const Z_C = CLOSED.topCenter[2];            // = R_C
const TABLE_Z_LOCAL = Z_C - R_C - 0.00037;  // mesa en el marco local del pergamino tumbado (la banda del lazo pasa debajo)
const OPEN_HALF_H = DIMENSIONS.LfMax / 2 + 0.0125; // media altura visible abierto (parte plana + rollo)
const ROD_HALF = 0.189;                     // varilla con remates (varilla.glb)
// CREMA (decisión n.º 9.1): estudio de papel crema (como la puerta y el resto del sitio), sin vacío marrón. La niebla funde la mesa
// con el fondo. Con posproceso el fondo pasa por ACES + sepia + calidez: se usa el color que, tras esa cadena, sale ≈ BG.
const BG = '#f1e7d4';
const UP = new THREE.Vector3(0, 1, 0);
function bgColors() {
  const t = new THREE.Color(BG); // lineal
  const tgt = [t.r, t.g, t.b];
  const f = (x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081);
  const fwd = ([r0, g0, b0]) => { // three r170 ACESFilmicToneMapping (exposición 1) + sepia 0.12 + calidez 0.6 de FS_COMPOSITE
    const r = r0 / 0.6, g = g0 / 0.6, b = b0 / 0.6;
    const a0 = f(0.59719 * r + 0.35458 * g + 0.04823 * b), a1 = f(0.076 * r + 0.90834 * g + 0.01566 * b), a2 = f(0.0284 * r + 0.13383 * g + 0.83777 * b);
    let c = [1.60475 * a0 - 0.53108 * a1 - 0.07367 * a2, -0.10208 * a0 + 1.10813 * a1 - 0.00605 * a2, -0.00327 * a0 - 0.07276 * a1 + 1.07602 * a2].map((v) => Math.min(1, Math.max(0, v)));
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], sp = [l * 1.12 + 0.018, l * 0.93 + 0.01, l * 0.68];
    c = c.map((v, i) => v + (sp[i] - v) * 0.12);
    return [c[0] * 1.018, c[1], c[2] * 0.97];
  };
  let v = tgt.slice();
  for (let it = 0; it < 80; it++) { const o = fwd(v); v = v.map((x, i) => Math.max(0, x + (tgt[i] - o[i]) * 1.4)); }
  const post = new THREE.Color().setRGB(v[0], v[1], v[2], THREE.LinearSRGBColorSpace);
  // sin posproceso la niebla se mezcla DESPUÉS de pasar a sRGB (fog_fragment va tras colorspace_fragment): componentes sRGB
  const s = new THREE.Color(BG).getRGB({}, THREE.SRGBColorSpace);
  const fogDirect = new THREE.Color().setRGB(s.r, s.g, s.b, THREE.LinearSRGBColorSpace);
  return { post, direct: new THREE.Color(BG), fogDirect };
}

// Niveles de calidad (0 = máximo). post: 2 = bloom + DOF, 1 = solo bloom, 0 = render directo (MSAA del contexto,
// viñeta y sepia por CSS). samples 0 → FXAA en la composición (resolver MSAA en un destino HDR es lo más caro en iGPU).
// PERF: L4 ya NO baja la densidad de píxeles de 1 (con 0.75 el texto del pergamino abierto era ilegible en móvil): recorta
// en su lugar sombras (mapa de 512 que solo se redibuja cuando algo se mueve: lazySh), partículas y posproceso.
// L3 también redibuja las sombras solo cuando hace falta.
const LEVELS = [
  { dpr: 1.5, post: 2, samples: 4, shadow: 2048, parts: 1.0 },
  { dpr: 1.5, post: 2, samples: 0, shadow: 1024, parts: 0.9 },
  { dpr: 1.0, post: 1, samples: 0, shadow: 1024, parts: 0.7 },
  { dpr: 1.0, post: 0, samples: 0, shadow: 1024, parts: 0.5, lazySh: true },
  { dpr: 1.0, post: 0, samples: 0, shadow: 512, parts: 0.15, lazySh: true },
];

// PERF · subida de texturas en ratos ociosos y SIN decodificar en el hilo principal. three.js sube cada imagen entera de
// una vez y, para un <img>, Chrome decodifica el JPEG dentro de texSubImage2D, en el hilo principal (2048×3550 ≈ 116–131 ms
// en escritorio, varias veces más en un móvil medio): un tirón por textura en la puerta, el desatado o el hero. Aquí:
//  1) <img>: se vuelven a pedir sus bytes (caché HTTP, cache: 'force-cache') y createImageBitmap(blob) los decodifica FUERA
//     del hilo, ya invertidos en Y si la textura lo pide; ImageBitmap (texturas de los GLB): se usa tal cual;
//  2) texStorage2D vía renderer.initTexture() con source.dataReady = false (three la da por subida y no la repite);
//  3) franjas de ~1.5 MB recortadas del bitmap y subidas con texSubImage2D, varias por ranura mientras quede tiempo ocioso;
//  4) generateMipmap en la GPU. La textura conserva su imagen original (no se retiene el bitmap).
// Medido (shots/perf/up/): un bloque de 116–131 ms → franjas de ≤ 28 ms incluso forzando la sincronización con la GPU.
// Devuelve false si no aplica (WebGL1, formato distinto, sin fetch…) y entonces se usa renderer.initTexture().
// PERF-RETOMA: los lienzos (canvas) también van por franjas: createImageBitmap(lienzo) + las mismas franjas.
// FIX (Safari < 17 / iOS < 17, también los navegadores de Instagram/Facebook/WhatsApp en iOS, que no llevan «Version/»):
// three 0.170 desactiva createImageBitmap ahí a propósito (WebKit 232357: texturas grandes negras o caída del proceso de GPU)
// y su GLTFLoader usa <img> con URL blob: que revoca al cargar (volver a pedirlas fallaba con ERR_FILE_NOT_FOUND).
const OLD_WEBKIT = (() => {
  try {
    const ua = navigator.userAgent || '';
    const ios = +(ua.match(/OS (\d+)_\d+(?:_\d+)? like Mac OS X/) || [])[1] || 0;
    const saf = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua) ? +(ua.match(/Version\/(\d+)/) || [])[1] || 0 : 0;
    return (ios > 0 && ios < 17) || (saf > 0 && saf < 17);
  } catch { return false; }
})();
async function uploadInStrips(THREE, renderer, tex, idle) {
  const img = tex.image;
  if (!img || !renderer.capabilities.isWebGL2 || typeof createImageBitmap !== 'function') return false;
  if (OLD_WEBKIT || /^blob:/.test(img?.src || '')) return false;
  if (tex.isDataTexture || tex.isCompressedTexture || tex.isVideoTexture || tex.isCubeTexture || tex.isRenderTargetTexture || (tex.mipmaps && tex.mipmaps.length)) return false;
  if (tex.format !== THREE.RGBAFormat || tex.type !== THREE.UnsignedByteType || tex.premultiplyAlpha) return false;
  const isImg = typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement;
  const isBmp = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
  // PERF-RETOMA: también lienzos (los que compone parchment.js: 1117×2876 ≈ 60 ms de una vez en escritorio, ~240 ms con CPU ×4)
  const isCnv = (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas);
  if (!isImg && !isBmp && !isCnv) return false;
  const W = isImg ? img.naturalWidth : img.width, H = isImg ? img.naturalHeight : img.height;
  if (!W || !H || W * H < 0.25e6 || Math.max(W, H) > renderer.capabilities.maxTextureSize) return false;
  // 1) bitmap decodificado fuera del hilo (para <img>); con flipY ya viene invertido → fila 0 del bitmap = fila 0 de GL
  let src = img, own = null;
  const o = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
  if (tex.flipY) o.imageOrientation = 'flipY';
  if (isImg) {
    let blob = null;
    try { const r = await fetch(img.currentSrc || img.src, { cache: 'force-cache' }); if (r.ok) blob = await r.blob(); } catch { /* */ }
    if (!blob) return false;
    try { own = await createImageBitmap(blob, o); } catch { return false; }
    if (own.width !== W || own.height !== H) { own.close(); return false; }
    src = own;
  } else if (isCnv) {
    // copia del lienzo (la composición ya terminó: no cambia después); con flipY = lo mismo que haría three al subirlo
    try { own = await createImageBitmap(img, o); } catch { return false; }
    if (own.width !== W || own.height !== H) { own.close(); return false; }
    src = own;
  }
  const gl = renderer.getContext();
  try {
    // 2) reservar el almacenamiento sin subir datos
    tex.source.dataReady = false;
    try { renderer.initTexture(tex); } finally { tex.source.dataReady = true; }
    const glTex = renderer.properties.get(tex).__webglTexture;
    if (!glTex) return false;
    // 3) franjas de ~1.5 MB
    const rows = Math.max(64, Math.min(512, Math.round(1.5e6 / (W * 4))));
    try {
      // por rato ocioso: franjas mientras quede plazo, como mucho ~12 ms seguidos
      let dl = await idle(), slot = performance.now();
      for (let y0 = 0; y0 < H; y0 += rows) {
        const h = Math.min(rows, H - y0);
        if (!dl || typeof dl.timeRemaining !== 'function' || dl.timeRemaining() < 6 || performance.now() - slot > 12) { dl = await idle(); slot = performance.now(); }
        const strip = rows >= H ? src : await createImageBitmap(src, 0, y0, W, h);
        renderer.state.bindTexture(gl.TEXTURE_2D, glTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, W, h, gl.RGBA, gl.UNSIGNED_BYTE, strip);
        if (strip !== src) strip.close?.();
      }
    } catch (e) {
      // algo falló a mitad: three la vuelve a subir entera desde su imagen original (versión nueva)
      tex.needsUpdate = true; renderer.initTexture(tex);
      return true;
    }
    // 4) mipmaps (en la GPU)
    if (tex.generateMipmaps && tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter) {
      renderer.state.bindTexture(gl.TEXTURE_2D, glTex);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    return true;
  } finally { own?.close?.(); }
}

// Línea de tiempo de open() en segundos (versión completa y versión para prefers-reduced-motion).
const TL_FULL = {
  crack: 1.0, crackDur: 0.45, brk: 1.45, untie: 1.95, untieDur: 2.1, liftMin: 4.15, liftWait: 1.2, liftDur: 1.9,
  unrollDelay: 1.3, unrollDur: 2.6, writeDelay: 2.05, writeDur: 4.0, petals: 1.4, chime: 1.8, done: 4.0,
  camSeal: 0.42, camMedium: 0.62, camOpen: 0.78,
};
const TL_REDUCED = {
  crack: 0.25, crackDur: 0.25, brk: 0.5, untie: 0.75, untieDur: 1.1, liftMin: 1.7, liftWait: 0.8, liftDur: 1.0,
  unrollDelay: 0.55, unrollDur: 1.2, writeDelay: 0.95, writeDur: 1.3, petals: 99, chime: 0.6, done: 1.3,
  camSeal: 0.22, camMedium: 0.3, camOpen: 0.4,
};
// ESCENA · ritmo de la secuencia guiado por el scroll (fracciones del recorrido fijo que main.js pasa con setScrollProgress)
// 0 → sOpen: sello, lazo, elevar, desenrollar · sOpen → sWrite: escritura · sWrite → sBack: la cámara se aleja · resto: CTAs.
// Topes de velocidad (s naturales por s reales) y tau = segundos de retraso que añaden +1× de velocidad.
// COMPAT-FLUIDEZ: backCap 2.5 → 6 (quien ya baja tras la escritura no espera el alejamiento completo a 1×: main.js acorta
// la sección al terminar de escribir y su tramo final guía el alejamiento)
// Pedido del usuario (31/10): al deslizar rápido en el celular la escena seguía fija 7–8 pantallas (topes 3.2× / 6×). Con topes más altos
// la apertura y la pluma se aceleran con el gesto (la pluma más ágil) y se pasa a la historia en ~3–4 pantallas; a ritmo normal no cambia nada.
const PACE = { sOpen: 0.15, sWrite: 0.78, sBack: 0.86, openCap: 5, writeCap: 14, backCap: 9, tau: 0.85, openEst: 7.6 };
const READ_HOLD = 0.7;   // s (naturales) con todo escrito antes de alejarse
const BACK_DUR = 2.6;    // s (naturales) del alejamiento final; los CTA aparecen al 55 %

// ───────────────────────────── shaders ─────────────────────────────
const VS_FS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FS_DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.25, 1.0);
}`;
const FS_BRIGHT = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee); soft = soft * soft / (4.0 * uKnee + 1e-4);
  gl_FragColor = vec4(c * (max(soft, br - uThreshold) / max(br, 1e-4)), 1.0);
}`;
const FS_BLUR = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += (texture2D(tSrc, vUv + uDir * 1.3846153846).rgb + texture2D(tSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  c += (texture2D(tSrc, vUv + uDir * 3.2307692308).rgb + texture2D(tSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;
const FS_COMPOSITE = /* glsl */`
#include <packing>
uniform sampler2D tScene, tBlur, tBloom, tBloom2, tDepth;
uniform float uDof, uFocus, uFocusRange, uNear, uFar, uBloom, uSepia, uVig, uGrain, uTime, uExpo, uFade, uWarm, uFxaa;
uniform vec2 uRes;
// ESCENA: zona "limpia" (la columna de texto proyectada en pantalla, en UV): sin DOF, bloom, sepia, viñeta ni grano al leer
uniform vec4 uClean; uniform vec2 uCleanFeather; uniform float uCleanAmt;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float lumT(vec3 c){ float l = dot(c, vec3(0.299, 0.587, 0.114)); return l / (1.0 + l); }
vec3 fxaa(vec2 uv){
  vec2 px = 1.0 / uRes;
  vec3 nw = texture2D(tScene, uv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(tScene, uv + vec2(1.0, -1.0) * px).rgb;
  vec3 sw = texture2D(tScene, uv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(tScene, uv + vec2(1.0, 1.0) * px).rgb;
  vec3 m = texture2D(tScene, uv).rgb;
  float lNW = lumT(nw), lNE = lumT(ne), lSW = lumT(sw), lSE = lumT(se), lM = lumT(m);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return m;
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (texture2D(tScene, uv - dir * (1.0 / 6.0)).rgb + texture2D(tScene, uv + dir * (1.0 / 6.0)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tScene, uv - dir * 0.5).rgb + texture2D(tScene, uv + dir * 0.5).rgb);
  float lB = lumT(b);
  return (lB < lMin || lB > lMax) ? a : b;
}
void main(){
  vec2 ce = smoothstep(uClean.xy - uCleanFeather, uClean.xy, vUv) * (1.0 - smoothstep(uClean.zw, uClean.zw + uCleanFeather, vUv));
  float keep = 1.0 - uCleanAmt * ce.x * ce.y; // 0 sobre la columna de texto mientras se lee
  // (sin FXAA sobre el texto: los trazos finos vienen filtrados de su textura y FXAA los agrisaba: −30 % de contraste)
  vec3 col = uFxaa > 0.5 && keep > 0.5 ? fxaa(vUv) : texture2D(tScene, vUv).rgb;
  if (uDof > 0.001) {
    float z = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
    float coc = smoothstep(0.14, 1.0, abs(z - uFocus) / uFocusRange) * uDof * keep;
    col = mix(col, texture2D(tBlur, vUv).rgb, coc);
  }
  col += (texture2D(tBloom, vUv).rgb * 0.6 + texture2D(tBloom2, vUv).rgb * 0.8) * uBloom * keep;
  col *= uExpo;
#ifdef TONE_MAPPING
  col = toneMapping(col);
#endif
  // gradación sepia (película antigua) + calidez en las sombras
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  vec3 sep = l * vec3(1.12, 0.93, 0.68) + vec3(0.018, 0.010, 0.0);
  col = mix(col, sep, uSepia * keep);
  col = mix(col, col * vec3(1.03, 1.0, 0.95), uWarm);
  // viñeta independiente del aspecto
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
  float rr = length(q) / length(vec2(0.5 * uRes.x / uRes.y, 0.5));
  // CREMA: viñeta de papel (borde apenas tostado), no un marco oscuro
  col *= mix(vec3(1.0), vec3(0.86, 0.78, 0.66), uVig * keep * smoothstep(0.32, 1.08, rr));
  col *= uFade;
  vec4 o = linearToOutputTexel(vec4(max(col, 0.0), 1.0));
  float n = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 917.0) - 0.5;
  o.rgb += n * uGrain * keep * (0.55 + 0.9 * (1.0 - clamp(l * 1.4, 0.0, 1.0)));
  gl_FragColor = o;
}`;

// ESCENA: nada brilla delante de la columna de texto mientras se lee (rectángulo en NDC con borde suave)
const GLSL_CLEAN = /* glsl */`
uniform vec4 uCleanNdc; uniform float uCleanAmt;
float cleanKeep(vec4 clip){
  vec2 n = clip.xy / max(clip.w, 1e-4);
  vec2 e = smoothstep(uCleanNdc.xy - 0.06, uCleanNdc.xy, n) * (1.0 - smoothstep(uCleanNdc.zw, uCleanNdc.zw + 0.06, n));
  return 1.0 - uCleanAmt * e.x * e.y;
}`;
const VS_SPARK = /* glsl */`
attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
uniform float uScale; varying vec3 vColor; varying float vAlpha;
${GLSL_CLEAN}
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = aSize * uScale / max(0.001, -mv.z);
  gl_PointSize = clamp(s, 1.0, 48.0);
  vColor = aColor; vAlpha = aAlpha * min(1.0, s * s) * cleanKeep(gl_Position);
}`;
const FS_SPARK = /* glsl */`
varying vec3 vColor; varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
  float a = (exp(-r2 * 5.0) + 0.35 * exp(-r2 * 28.0)) * vAlpha;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;
const VS_DUST = /* glsl */`
attribute vec4 aSeed;
uniform float uTime, uScale, uFlick, uAmt; uniform vec3 uSpotPos, uSpotDir, uBoxMin, uBoxSize; uniform float uCosOuter, uCosInner;
varying float vA;
${GLSL_CLEAN}
void main(){
  vec3 p = position;
  p.y = uBoxMin.y + mod(p.y - uBoxMin.y + uTime * (0.0035 + 0.006 * aSeed.w), uBoxSize.y);
  p.x += sin(uTime * 0.21 + aSeed.x * 6.283) * 0.022 + sin(uTime * 0.53 + aSeed.y * 6.283) * 0.007;
  p.z += cos(uTime * 0.17 + aSeed.z * 6.283) * 0.022;
  vec3 L = p - uSpotPos; float d = length(L);
  float beam = smoothstep(uCosOuter, uCosInner, dot(L / d, uSpotDir));
  float tw = 0.5 + 0.5 * sin(uTime * (0.8 + aSeed.w * 2.2) + aSeed.x * 40.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = (0.0009 + 0.0016 * aSeed.w) * uScale / max(0.01, -mv.z);
  gl_PointSize = clamp(s, 1.0, 20.0);
  float edge = smoothstep(0.0, 0.06, p.y - uBoxMin.y) * smoothstep(0.0, 0.1, uBoxMin.y + uBoxSize.y - p.y);
  vA = beam * (0.2 + 0.8 * tw * tw) * uFlick * edge * uAmt * min(1.0, s * s) * (0.35 + 0.3 * aSeed.w) * cleanKeep(gl_Position);
}`;
const FS_DUST = /* glsl */`
varying float vA;
void main(){
  vec2 c = gl_PointCoord * 2.0 - 1.0; float r2 = dot(c, c); if (r2 > 1.0) discard;
  gl_FragColor = vec4(vec3(1.0, 0.84, 0.6) * exp(-r2 * 3.5) * vA, 1.0);
}`;
const FS_FLAME = /* glsl */`
uniform float uTime, uFlick; varying vec2 vUv;
float h1(float n){ return fract(sin(n) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main(){
  float y = vUv.y; float x = vUv.x * 2.0 - 1.0;
  float sway = (n1(uTime * 2.7) - 0.5) * 0.42 + sin(uTime * 8.3) * 0.05;
  x -= sway * y * y;
  float w = 1.55 * pow(max(y, 0.0), 0.45) * pow(max(1.0 - y, 0.0), 0.95) * (0.92 + 0.08 * uFlick);
  float d = abs(x) / max(w, 1e-3);
  float tip = 1.0 - smoothstep(0.62, 1.0, y);
  float body = (1.0 - smoothstep(0.45, 1.0, d)) * tip;
  float core = (1.0 - smoothstep(0.0, 0.6, d)) * smoothstep(0.03, 0.2, y) * (1.0 - smoothstep(0.3, 0.72, y));
  float base = (1.0 - smoothstep(0.0, 0.2, y)) * (1.0 - smoothstep(0.2, 1.0, d));
  vec3 col = vec3(1.0, 0.40, 0.09) * body * 3.0 + vec3(1.0, 0.82, 0.55) * core * 9.0 + vec3(0.22, 0.32, 1.0) * base * 0.9;
  gl_FragColor = vec4(col * uFlick, clamp(body + core, 0.0, 1.0));
}`;
const FS_AURA = /* glsl */`
uniform float uI, uTime; varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * 0.12;
  float r = length(p);
  // filo de luz dorada justo en el borde del lacre (la parte interior la tapa el propio sello) + un halo cálido muy tenue
  float rim = smoothstep(0.0170, 0.0184, r) * (1.0 - smoothstep(0.0184, 0.0212, r));
  float halo = smoothstep(0.017, 0.019, r) * (1.0 - smoothstep(0.019, 0.03, r));
  float ang = atan(p.y, p.x);
  float sh = 0.7 + 0.3 * sin(ang * 5.0 + uTime * 0.9) * sin(ang * 3.0 - uTime * 0.55);
  gl_FragColor = vec4((vec3(1.0, 0.62, 0.24) * rim * 0.85 + vec3(1.0, 0.52, 0.2) * halo * 0.12) * sh * uI, 1.0);
}`;

// ───────────────────────────── posproceso ligero ─────────────────────────────
function createPost(renderer, { samples, hdr }) {
  let TYPE = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
  let useDepthTex = true;
  const mkRT = () => new THREE.WebGLRenderTarget(1, 1, { type: TYPE, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false });
  const rt = { half: mkRT(), q1: mkRT(), q2: mkRT(), b1: mkRT(), b2: mkRT(), e1: mkRT(), e2: mkRT() };
  let rtScene = null, curSamples = samples, w = 1, h = 1;
  function makeSceneRT() {
    if (rtScene) { rtScene.depthTexture?.dispose(); rtScene.dispose(); }
    let depth = null;
    if (useDepthTex) { depth = new THREE.DepthTexture(w, h); depth.type = THREE.UnsignedIntType; }
    rtScene = new THREE.WebGLRenderTarget(w, h, { type: TYPE, format: THREE.RGBAFormat, samples: curSamples, depthBuffer: true, depthTexture: depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
  }
  makeSceneRT();
  const mat = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS_FS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
  const mDown = mat(FS_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { toneMapped: false });
  const mBright = mat(FS_BRIGHT, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.0 }, uKnee: { value: 0.6 } }, { toneMapped: false });
  const mBlur = mat(FS_BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, { toneMapped: false });
  const U = {
    tScene: { value: null }, tBlur: { value: null }, tBloom: { value: null }, tBloom2: { value: null }, tDepth: { value: null },
    uDof: { value: 0 }, uFocus: { value: 1 }, uFocusRange: { value: 0.5 }, uNear: { value: 0.01 }, uFar: { value: 10 },
    uBloom: { value: 0.5 }, uSepia: { value: 0.1 }, uVig: { value: 0.5 }, uGrain: { value: 0.03 }, uTime: { value: 0 },
    uExpo: { value: 1 }, uFade: { value: 1 }, uWarm: { value: 0.5 }, uFxaa: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
    uClean: { value: new THREE.Vector4(2, 2, 2, 2) }, uCleanFeather: { value: new THREE.Vector2(0.03, 0.03) }, uCleanAmt: { value: 0 },
  };
  if (!hdr) mBright.uniforms.uThreshold.value = 0.82; // sin destino flotante: umbral de bloom en LDR
  const mComp = mat(FS_COMPOSITE, U);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(geo, mComp); quad.frustumCulled = false;
  const qcam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (m, target) => { quad.material = m; renderer.setRenderTarget(target); renderer.render(quad, qcam); };
  return {
    uniforms: U,
    get samples() { return curSamples; },
    get sceneTarget() { return rtScene; },
    /** para precompilar: los pases intermedios dibujan en destinos (lineal) y la composición en pantalla */
    materials: { toTarget: [mDown, mBright, mBlur], toScreen: [mComp], quad: geo },
    _exp(o) { if ('depthTex' in o) useDepthTex = o.depthTex; if ('hdr' in o) TYPE = o.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType; makeSceneRT(); },
    setSamples(s) { if (s !== curSamples) { curSamples = s; makeSceneRT(); } },
    setSize(W, H) {
      w = Math.max(1, W | 0); h = Math.max(1, H | 0);
      rtScene.setSize(w, h);
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1), qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2), ew = Math.max(1, w >> 3), eh = Math.max(1, h >> 3);
      rt.half.setSize(hw, hh); rt.q1.setSize(qw, qh); rt.q2.setSize(qw, qh); rt.b1.setSize(qw, qh); rt.b2.setSize(qw, qh); rt.e1.setSize(ew, eh); rt.e2.setSize(ew, eh);
      U.uRes.value.set(w, h);
    },
    render(scene, camera, { dof }) {
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);
      mDown.uniforms.tSrc.value = rtScene.texture; mDown.uniforms.uTexel.value.set(1 / w, 1 / h); pass(mDown, rt.half);
      const qw = rt.q1.width, qh = rt.q1.height;
      if (dof) {
        mBlur.uniforms.tSrc.value = rt.half.texture; mBlur.uniforms.uDir.value.set(1.25 / qw, 0); pass(mBlur, rt.q1);
        mBlur.uniforms.tSrc.value = rt.q1.texture; mBlur.uniforms.uDir.value.set(0, 1.25 / qh); pass(mBlur, rt.q2);
      }
      mBright.uniforms.tSrc.value = rt.half.texture; mBright.uniforms.uTexel.value.set(1 / rt.half.width, 1 / rt.half.height); pass(mBright, rt.b1);
      mBlur.uniforms.tSrc.value = rt.b1.texture; mBlur.uniforms.uDir.value.set(1 / qw, 0); pass(mBlur, rt.b2);
      mBlur.uniforms.tSrc.value = rt.b2.texture; mBlur.uniforms.uDir.value.set(0, 1 / qh); pass(mBlur, rt.b1);
      const ew = rt.e1.width, eh = rt.e1.height;
      mBlur.uniforms.tSrc.value = rt.b1.texture; mBlur.uniforms.uDir.value.set(1.4 / ew, 0); pass(mBlur, rt.e1);
      mBlur.uniforms.tSrc.value = rt.e1.texture; mBlur.uniforms.uDir.value.set(0, 1.4 / eh); pass(mBlur, rt.e2);
      U.tScene.value = rtScene.texture; U.tDepth.value = rtScene.depthTexture; if (!rtScene.depthTexture) dof = false; U.tBlur.value = rt.q2.texture;
      U.tBloom.value = rt.b1.texture; U.tBloom2.value = rt.e2.texture;
      U.uDof.value = dof ? U.uDof.value : 0;
      U.uFxaa.value = curSamples > 0 ? 0 : 1;
      U.uNear.value = camera.near; U.uFar.value = camera.far;
      pass(mComp, null);
    },
    dispose() {
      rtScene.depthTexture?.dispose(); rtScene.dispose(); Object.values(rt).forEach((r) => r.dispose());
      [mDown, mBright, mBlur, mComp].forEach((m) => m.dispose()); geo.dispose();
    },
  };
}

// ───────────────────────────── partículas (chispas, polvo de oro) ─────────────────────────────
function createSparks(max, cleanU = {}) {
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const vel = new Float32Array(max * 3), base = new Float32Array(max * 3), life = new Float32Array(max), maxLife = new Float32Array(max);
  const drag = new Float32Array(max), grav = new Float32Array(max), tw = new Float32Array(max), bsize = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  const aAlpha = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos); geo.setAttribute('aColor', aCol); geo.setAttribute('aSize', aSize); geo.setAttribute('aAlpha', aAlpha);
  geo.setDrawRange(0, 0);
  const material = new THREE.ShaderMaterial({ vertexShader: VS_SPARK, fragmentShader: FS_SPARK, uniforms: { uScale: { value: 800 }, ...cleanU },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, material); points.frustumCulled = false; points.renderOrder = 5; points.name = 'chispas';
  let n = 0;
  const move = (a, b) => {
    for (let k = 0; k < 3; k++) { pos[a * 3 + k] = pos[b * 3 + k]; vel[a * 3 + k] = vel[b * 3 + k]; base[a * 3 + k] = base[b * 3 + k]; col[a * 3 + k] = col[b * 3 + k]; }
    size[a] = size[b]; alpha[a] = alpha[b]; life[a] = life[b]; maxLife[a] = maxLife[b]; drag[a] = drag[b]; grav[a] = grav[b]; tw[a] = tw[b]; bsize[a] = bsize[b];
  };
  return {
    points, material,
    get count() { return n; },
    spawn(p, v, o) {
      if (n >= max) return;
      const i = n++;
      pos.set([p.x, p.y, p.z], i * 3); vel.set([v.x, v.y, v.z], i * 3);
      base.set(o.color, i * 3); col.set(o.color, i * 3);
      life[i] = maxLife[i] = o.life; drag[i] = o.drag ?? 2; grav[i] = o.grav ?? 0; tw[i] = o.twinkle ?? 0; bsize[i] = size[i] = o.size; alpha[i] = 0;
    },
    clear() { n = 0; geo.setDrawRange(0, 0); },
    update(dt, time) {
      for (let i = 0; i < n; i++) {
        life[i] -= dt;
        if (life[i] <= 0) { n--; if (i < n) { move(i, n); i--; } continue; }
        const f = Math.exp(-drag[i] * dt), j = i * 3;
        vel[j] *= f; vel[j + 1] = vel[j + 1] * f + grav[i] * dt; vel[j + 2] *= f;
        pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
        const age = maxLife[i] - life[i];
        const fade = Math.min(1, age / 0.08) * Math.min(1, life[i] / (maxLife[i] * 0.45));
        const twk = tw[i] > 0 ? 1 - tw[i] + tw[i] * (0.5 + 0.5 * Math.sin(time * (9 + (i % 7)) + i * 1.7)) : 1;
        alpha[i] = fade * twk;
      }
      geo.setDrawRange(0, n);
      if (n) {
        aPos.clearUpdateRanges(); aPos.addUpdateRange(0, n * 3); aPos.needsUpdate = true;
        aCol.clearUpdateRanges(); aCol.addUpdateRange(0, n * 3); aCol.needsUpdate = true;
        aSize.clearUpdateRanges(); aSize.addUpdateRange(0, n); aSize.needsUpdate = true;
        aAlpha.clearUpdateRanges(); aAlpha.addUpdateRange(0, n); aAlpha.needsUpdate = true;
      }
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}

// ───────────────────────────── texturas de lienzo ─────────────────────────────
function radialTex(stops, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// CREMA (decisión n.º 9.1): mantel de lino crema procedural y repetible (en vez de la mesa de nogal oscuro): tafetán de hilos de
// 4 px con relieve por hilo, grosor irregular y algún nudo; de lejos se promedia en un crema parejo que se funde con la niebla.
function linenTex(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size); const d = img.data;
  const r = mulberry32(11), n = size >> 2;
  const wv = new Float32Array(n), wp = new Float32Array(n);
  for (let i = 0; i < n; i++) { wv[i] = (r() - 0.5) * 0.09; wp[i] = (r() - 0.5) * 0.09; }
  const prof = [0.9, 1.0, 1.0, 0.92];
  const hash = (a, b) => { let h = Math.imul(a, 374761393) + Math.imul(b, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  for (let y = 0; y < size; y++) {
    const ty = y >> 2, py = y & 3;
    for (let x = 0; x < size; x++) {
      const tx = x >> 2, px = x & 3;
      const weftTop = ((tx + ty) & 1) === 0;
      let v = weftTop ? 1 + wv[ty] + (hash(ty, tx >> 3) > 0.93 ? 0.05 : 0) : 1 + wp[tx] + (hash(tx + 999, ty >> 3) > 0.93 ? 0.05 : 0);
      v *= weftTop ? prof[py] : prof[px];
      v += (r() - 0.5) * 0.035;
      const i = (y * size + x) * 4;
      d[i] = Math.min(255, 241 * v); d[i + 1] = Math.min(255, 232 * v); d[i + 2] = Math.min(255, 214 * v); d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function vGradientTex(stops) {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
export async function mountScroll(container, opts = {}) {
  if (!container) throw new Error('mountScroll: falta el contenedor');
  let music = opts.music || null;
  const reduced = !!opts.reducedMotion;
  // COMPAT-FLUIDEZ · modo suave (prefers-reduced-motion del sistema, main.js): la secuencia completa (sello, lazo, pluma que
  // escribe por trazos) pero la cámara no viaja: un solo acercamiento lento al encuadre final, sin parallax del puntero
  const soft = !reduced && !!opts.softMotion;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const onOpenedCb = typeof opts.onOpened === 'function' ? opts.onOpened : () => {};
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const mobile = coarse || Math.min(innerWidth, innerHeight) < 600;
  const DPR_CAP = opts.dprMax || (mobile ? 1.35 : 1.75);
  const TL = reduced ? TL_REDUCED : TL_FULL;
  let progress = 0;
  const marks = { t0: Math.round(performance.now()) }; // PERF (depuración): ms desde el inicio del montaje en cada etapa
  const report = (p, mark = true) => { if (p <= progress) return; progress = p; if (mark) marks['p' + p] = Math.round(performance.now()) - marks.t0; try { onProgress(progress); } catch { /* */ } };
  report(0.02);
  const sfx = (name, ...a) => { if (silent) return; try { music?.sfx?.[name]?.(...a); } catch { /* sin audio */ } };
  const duck = (a, s) => { if (silent) return; try { music?.duck?.(a, s); } catch { /* */ } };
  let silent = false;

  // ───────── lienzo y renderer
  const canvas = document.createElement('canvas');
  canvas.className = 'scroll3d-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;-webkit-tap-highlight-color:transparent;outline:none;opacity:0;transition:opacity .9s ease;';
  try { if (getComputedStyle(container).position === 'static') container.style.position = 'relative'; } catch { /* */ }
  container.appendChild(canvas);
  const vignetteEl = document.createElement('div');
  vignetteEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:none;background:radial-gradient(ellipse 80% 75% at 50% 50%, rgba(150,112,62,0) 55%, rgba(150,112,62,.2) 100%);';
  container.appendChild(vignetteEl);

  let renderer;
  const allowSW = /[?&]sw=1\b/.test(location.search);
  try {
    // failIfMajorPerformanceCaveat: sin GPU real (render por software, 1–2 fps aquí) el contexto falla → tarjeta HTML
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false, failIfMajorPerformanceCaveat: !allowSW });
  } catch (e) { canvas.remove(); vignetteEl.remove(); throw e; }
  try {
    const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
    if (!allowSW && /SwiftShader|llvmpipe|softpipe|Basic Render|Software Rasterizer/i.test(name)) throw new Error('render por software (' + name + ')');
  } catch (e) { try { renderer.dispose(); renderer.forceContextLoss(); } catch { /* */ } canvas.remove(); vignetteEl.remove(); throw e; }
  // trabajo pesado (composición de texturas, compilación, subida a la GPU) en tiempo ocioso: main.js lo aplaza mientras
  // corre una animación protagonista (apertura de la puerta, intro de los anillos)
  const idle = typeof opts.idle === 'function' ? () => Promise.resolve(opts.idle()).catch(() => {}) : () => Promise.resolve();
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  // PERF: sin leer los registros de compilación de cada programa en su primer uso (4 viajes síncronos a la GPU por
  // programa × ~40 programas en el primer cuadro). ?glcheck=1 los vuelve a activar para depurar.
  renderer.debug.checkShaderErrors = /[?&]glcheck=1\b/.test(location.search);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(BG, 1);
  const hdr = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));

  let W = 1, H = 1, aspect = 1, dpr = 1;
  const measure = () => {
    const r = container.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width || container.clientWidth || innerWidth));
    H = Math.max(1, Math.round(r.height || container.clientHeight || innerHeight));
    aspect = W / H;
  };
  measure();

  // ───────── calidad
  let forcedQ = Number.isInteger(opts.quality) ? clamp(opts.quality, 0, LEVELS.length - 1) : null;
  let qLevel = forcedQ ?? 1; // L1 (FXAA) ≈ L0 (MSAA) a la vista y cuesta la mitad; L0 solo por subida automática
  let upgrades = 0, lockUp = false;
  // PERF · recuperación tras una caída pasajera: recovered = niveles recuperados desde la última bajada (máx. 2);
  // lockAt = nivel por debajo del cual ya no se intenta subir (volvió a caer justo después de recuperar)
  let recovered = 0, lockAt = -1, lastRecoverT = -1e9;
  // PERF · listo: el bucle de dibujo no arranca (wake) hasta terminar el montaje y el calentamiento
  let ready = false;
  const disposeExtra = [];
  const timing = marks; // (depuración: api.debug.timing)
  let Q = LEVELS[qLevel];
  let post = null;
  try { post = createPost(renderer, { samples: Q.samples, hdr }); } catch (e) { console.warn('[scroll3d] posproceso no disponible:', e?.message || e); }

  const scene = new THREE.Scene();
  const BGC = bgColors();
  scene.background = BGC.post.clone();
  scene.fog = new THREE.Fog(BGC.post.clone(), 1.5, 3.9);
  // CREMA: fondo/niebla según el camino de render (con posproceso: color pre-ACES; directo: crema tal cual)
  const applyBg = (usePost) => {
    scene.background.copy(usePost ? BGC.post : BGC.direct);
    scene.fog.color.copy(usePost ? BGC.post : BGC.fogDirect);
  };
  const camera = new THREE.PerspectiveCamera(30, aspect, 0.01, 12);
  const pmrem = new THREE.PMREMGenerator(renderer);

  // ───────── entorno tenue y cálido (para el oro, el raso y el lacre)
  const envRT = (() => {
    const s = new THREE.Scene();
    const disp = [];
    const add = (geo, color, k, pos, look = true, side = THREE.DoubleSide) => {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side });
      const o = new THREE.Mesh(geo, m); o.position.set(...pos); if (look) o.lookAt(0, 0.15, 0); s.add(o); disp.push(geo, m); return o;
    };
    add(new THREE.BoxGeometry(9, 5, 9), '#d9c8aa', 0.36, [0, 1.6, 0], false, THREE.BackSide);   // CREMA: estudio claro
    add(new THREE.PlaneGeometry(1.8, 1.1), '#ffb070', 4.2, [-2.1, 2.3, 1.9]);   // vela grande fuera de cuadro (clave)
    add(new THREE.PlaneGeometry(0.45, 0.45), '#ff8a36', 12, [-1.0, 0.45, -1.3]); // vela del fondo
    add(new THREE.PlaneGeometry(2.4, 1.2), '#9fb4ff', 0.75, [2.5, 1.4, -2.1]);   // contraluz frío
    add(new THREE.PlaneGeometry(3.2, 0.7), '#ffcf96', 0.7, [0.4, 2.9, 0.6]);     // techo cálido
    const floor = add(new THREE.PlaneGeometry(9, 9), '#a8875e', 0.4, [0, -0.02, 0], false); floor.rotation.x = -Math.PI / 2;
    const rt = pmrem.fromScene(s, 0.035);
    disp.forEach((d) => d.dispose());
    return rt;
  })();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.62;
  report(0.06);

  // ───────── luces: vela clave (spot con sombras suaves) + relleno + contraluz + vela visible + destello del lacre
  const KEY_I = 4.1;
  const KEY_ANGLE = 0.38;
  const key = new THREE.SpotLight('#ffc890', KEY_I, 0, KEY_ANGLE, 0.88, 2); // CREMA: vela menos naranja (papel crema, no tostado)
  key.position.set(-0.44, 0.86, 0.66);
  key.castShadow = true;
  key.shadow.mapSize.set(Q.shadow, Q.shadow);
  key.shadow.camera.near = 0.35; key.shadow.camera.far = 2.6;
  key.shadow.bias = -0.0001; key.shadow.normalBias = 0.0009;
  scene.add(key, key.target);
  const hemi = new THREE.HemisphereLight('#fff0dc', '#d2bc98', 0.4); // AJUSTES: suelo más claro (antes #a88a64: mantel tostado) // CREMA: la sala clara rellena las sombras (antes 0.13 a oscuras)
  scene.add(hemi);
  // contraluz frío acotado al pergamino (como direccional teñía de azul toda la mesa en pantallas anchas)
  const rim = new THREE.SpotLight('#a9bfff', 1.15, 0, 0.42, 1.0, 2);
  rim.position.set(0.6, 0.55, -0.9);
  scene.add(rim, rim.target);
  const CANDLE_I = 0.16;
  const candleLight = new THREE.PointLight('#ff9a48', CANDLE_I, 0, 2);
  scene.add(candleLight);
  const flash = new THREE.PointLight('#ff7a2a', 0, 0.6, 2);
  scene.add(flash);
  // ESCENA · luz de lectura: direccional cálida SIN sombra (ilumina parejo toda la hoja: en una superficie plana N·L es constante).
  // Nace con intensidad 0 (ya cuenta para los programas compilados en el calentamiento) y sube al elevarse el pergamino. Mientras
  // tanto la vela clave se vuelve más frontal y abierta: la sombra del rollo superior cae detrás del rollo (sin banda oscura).
  const readLight = new THREE.DirectionalLight('#fff1de', 0); // CREMA: luz de lectura casi blanca cálida
  readLight.position.set(-0.22, 0.62, 1.15);
  scene.add(readLight, readLight.target);
  const KEY_POS = key.position.clone(), KEY_READ_POS = new THREE.Vector3(-0.3, 0.6, 1.0);
  const READ_I = 1.75, KEY_READ_I = 0.6; // (medido: contraste del antetítulo ≥ 4.5:1 sin quemar el oro)

  // ───────── carga en paralelo
  const gltfLoader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();
  let nLoaded = 0; const N_LOAD = 8;
  const tick = () => { nLoaded++; report(0.08 + 0.62 * (nLoaded / N_LOAD)); };
  const loadTex = (p, srgb) => texLoader.loadAsync(ASSET(p)).then((t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; tick(); return t; })
    .catch((e) => { console.warn('[scroll3d] textura', p, e?.message || e); tick(); return null; });
  const loadGLB = (p) => gltfLoader.loadAsync(ASSET(p)).then((g) => { tick(); return g; })
    .catch((e) => { console.warn('[scroll3d] modelo', p, e?.message || e); tick(); return null; });
  let P, selloG, varillaG, tAlb, tNrm, tRgh, tPet1, tPet2;
  try {
    [P, selloG, varillaG, tAlb, tNrm, tRgh, tPet1, tPet2] = await Promise.all([
      createParchment({ THREE, renderer, idle }).then((p) => { tick(); return p; }),
      loadGLB('models/sello.glb'), loadGLB('models/varilla.glb'),
      // CREMA: la mesa de nogal oscuro se cubre con un mantel de lino crema procedural (no se descargan sus texturas)
      (tick(), null), (tick(), null), (tick(), null),
      loadTex('tex/petalo.png', true), loadTex('tex/petalo_2.png', true),
    ]);
  } catch (e) {
    post?.dispose(); envRT.dispose(); pmrem.dispose(); renderer.dispose(); canvas.remove(); vignetteEl.remove();
    throw e;
  }
  report(0.72);
  try { P.setWriting?.(0); } catch { /* */ }
  if (reduced) P.setReducedMotion?.(true);
  const U0 = P.uniforms ? { edge: P.uniforms.pEdgeWave?.value, gain: P.uniforms.pSweepGain?.value } : {};

  // ───────── mesa de nogal
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const TABLE = 8, REP = TABLE / 0.6; // CREMA: mantel amplio, su borde se pierde del todo en la niebla crema (sin horizonte duro)
  for (const t of [tAlb, tNrm, tRgh]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(REP, REP); t.rotation = Math.PI / 2; t.anisotropy = aniso; }
  // CREMA: mantel de lino crema (hilos de ~0.9 mm)
  if (!tAlb) { tAlb = linenTex(); tAlb.repeat.set(TABLE / 0.12, TABLE / 0.12); tAlb.anisotropy = aniso; }
  const tableMat = new THREE.MeshStandardMaterial({ map: tAlb, normalMap: tNrm, roughnessMap: tRgh, roughness: tRgh ? 1 : 0.9, metalness: 0,
    color: tNrm ? '#b9a493' : '#f4ede2', envMapIntensity: 0.55 });
  if (tNrm) tableMat.normalScale.set(0.7, 0.7);
  // AJUSTES (todo crema): con la luz rasante el mantel se veía tostado (L* ≈ 70) en el tercio inferior de la vista completa;
  // un poco de luz propia con su misma trama lo deja crema sin borrar la sombra del pergamino ni la de las velas
  if (!tNrm) { tableMat.emissive.set('#eadfca'); tableMat.emissiveMap = tAlb; tableMat.emissiveIntensity = 0.6; }
  const table = new THREE.Mesh(new THREE.PlaneGeometry(TABLE, TABLE), tableMat);
  table.rotation.x = -Math.PI / 2; table.receiveShadow = true; table.name = 'mesa';
  scene.add(table);

  // ───────── vela visible al fondo (llama con shader, cera que transluce, platillo de latón)
  const candle = new THREE.Group(); candle.name = 'vela';
  const brass = new THREE.MeshStandardMaterial({ color: '#9b7744', metalness: 1, roughness: 0.4 });
  const dishPts = [[0, 0], [0.046, 0], [0.049, 0.003], [0.047, 0.0055], [0.033, 0.0045], [0.0295, 0.006], [0.0285, 0.012], [0.0265, 0.0128], [0, 0.0122]].map(([r, y]) => new THREE.Vector2(r, y));
  const dish = new THREE.Mesh(new THREE.LatheGeometry(dishPts, 48), brass); dish.castShadow = dish.receiveShadow = true; candle.add(dish);
  const CH = 0.064, CR = 0.024, CB = 0.0122;
  const waxPts = [[0, 0], [CR, 0], [CR * 1.004, CH * 0.35], [CR * 0.996, CH * 0.8], [CR, CH - 0.004], [CR * 0.97, CH - 0.0005], [CR * 0.86, CH - 0.0012], [CR * 0.5, CH - 0.0045], [CR * 0.2, CH - 0.0055], [0, CH - 0.0056]]
    .map(([r, y]) => new THREE.Vector2(r, y + CB));
  const waxGlow = vGradientTex([[0, '#d0773a'], [0.11, '#e08844'], [0.44, '#ffc080'], [0.56, '#c06a30'], [0.67, '#6a3412'], [0.8, '#2e1406'], [1, '#160903']]);
  const waxMat = new THREE.MeshStandardMaterial({ color: '#f3e6cf', roughness: 0.5, emissive: '#ffa45c', emissiveMap: waxGlow, emissiveIntensity: 1.3 });
  const wax = new THREE.Mesh(new THREE.LatheGeometry(waxPts, 48), waxMat); wax.castShadow = true; wax.receiveShadow = true; candle.add(wax);
  const wickY = CB + CH - 0.0056;
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.0006, 0.0008, 0.009, 6), new THREE.MeshStandardMaterial({ color: '#1a120c', roughness: 0.9 }));
  wick.position.set(0, wickY + 0.004, 0); wick.rotation.z = 0.16; candle.add(wick);
  const flameMat = new THREE.ShaderMaterial({ vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: FS_FLAME, uniforms: { uTime: { value: 0 }, uFlick: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const flameGeo = new THREE.PlaneGeometry(0.017, 0.044); flameGeo.translate(0, 0.022, 0);
  const flame = new THREE.Mesh(flameGeo, flameMat); flame.position.set(0, wickY + 0.0035, 0); flame.renderOrder = 6; candle.add(flame);
  const glowTex = radialTex([[0, 'rgba(255,190,120,1)'], [0.18, 'rgba(255,150,70,.55)'], [0.5, 'rgba(255,110,40,.12)'], [1, 'rgba(255,90,30,0)']]);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(1.6, 1.2, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.scale.set(0.2, 0.2, 1); glow.position.set(0, wickY + 0.02, 0); glow.renderOrder = 6; candle.add(glow);
  scene.add(candle);
  // ESCENA · segunda vela, a la derecha, junto al lugar del tintero (equilibra el plano final y el tintero queda "junto a la
  // vela"). Comparte geometrías y programas con la primera (sin compilaciones nuevas) y titila con otra fase. Sin luz propia.
  const flameMat2 = flameMat.clone(); flameMat2.uniforms = { uTime: { value: 0 }, uFlick: { value: 1 } };
  const candle2 = candle.clone(true); candle2.name = 'vela_2';
  const flame2 = candle2.children[candle.children.indexOf(flame)], glow2 = candle2.children[candle.children.indexOf(glow)];
  flame2.material = flameMat2; glow2.material = glow.material.clone();
  candle2.scale.setScalar(0.86);
  scene.add(candle2);
  const flamePos2 = new THREE.Vector3();
  const flamePos = new THREE.Vector3();
  // bokeh de velas lejanas (fondo desenfocado; se ven sobre todo en el plano final)
  const bokehTex = radialTex([[0, 'rgba(255,255,255,.55)'], [0.7, 'rgba(255,255,255,.5)'], [0.86, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']], 64);
  const bokeh = [];
  {
    const r = mulberry32(5);
    for (let i = 0; i < 7; i++) {
      const m = new THREE.SpriteMaterial({ map: bokehTex, color: new THREE.Color().setHSL(0.035 + r() * 0.03, 0.95, 0.5).multiplyScalar(0.1 + r() * 0.2),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
      const b = new THREE.Sprite(m);
      b.position.set((i % 2 ? 1 : -1) * (0.45 + r() * 1.1), 0.12 + r() * 0.7, -1.7 - r() * 1.4); b.scale.setScalar(0.045 + r() * 0.08); b.userData.ph = r() * 6.28; b.userData.k = m.color.clone();
      b.renderOrder = 1; scene.add(b); bokeh.push(b);
    }
  }

  // ───────── el pergamino (rig: hoja + varillas + lazo + sello, en coordenadas locales del pergamino)
  const rig = new THREE.Group(); rig.name = 'pergamino_rig';
  scene.add(rig);
  rig.add(P.group);

  // varillas: clones de varilla.glb con nogal envejecido y remates de latón gastado
  let rodTop, rodBot;
  {
    let src;
    if (varillaG) {
      src = varillaG.scene;
      src.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material;
        if (/oro/i.test(m.name) || /oro/i.test(o.name)) { m.color.set('#a8834c'); m.metalness = 1; m.roughness = 0.4; m.envMapIntensity = 1.1; }
        else { if ('clearcoat' in m) { m.clearcoat = 0.42; m.clearcoatRoughness = 0.24; } m.color.multiplyScalar(0.9); }
      });
    } else {
      src = new THREE.Group();
      const wood = new THREE.MeshPhysicalMaterial({ color: '#3b2314', roughness: 0.4, clearcoat: 0.4 });
      const gold = new THREE.MeshStandardMaterial({ color: '#a8834c', metalness: 1, roughness: 0.4 });
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.33, 32), wood); rod.rotation.z = Math.PI / 2; rod.castShadow = true; src.add(rod);
      for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.0115, 24, 12), gold); f.position.x = s * 0.177; f.castShadow = true; src.add(f); }
    }
    rodTop = src.clone(true); rodBot = src.clone(true);
    rodTop.name = 'varilla_sup'; rodBot.name = 'varilla_inf';
    rig.add(rodTop, rodBot);
  }

  // lazo de satén
  // PERF: las texturas de raso se calculan por filas en ratos ociosos (antes 158 ms seguidos en escritorio, ~600 con CPU ×4)
  await idle();
  const rb = createRibbon({ THREE, renderer, closed: CLOSED, color: '#530d1e', idle });
  rig.add(rb.group);
  if (rb.ready) { try { await rb.ready; } catch { /* sigue con lo que haya */ } }
  marks.ribbon = Math.round(performance.now()) - marks.t0;

  // sello de lacre sobre el nudo
  const sealHolder = new THREE.Group(); sealHolder.name = 'sello_holder';
  sealHolder.position.copy(rb.knot.position);
  sealHolder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), rb.knot.normal);
  rig.add(sealHolder);
  let sealRoot = null, entero = null, frags = [], fragRest = [], interiorMats = [], lacreMats = [];
  const goldGlow = { value: 0 };
  const crackMeshes = [];
  // FIX: grietas naranjas (antes 3.2× saturaba a blanco) y más gruesas, con un halo suave alrededor (tubo ancho con caída)
  const crackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.24).multiplyScalar(1.35), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const crackGlowMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.48, 0.14) } },
    vertexShader: `varying float vF; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vF; void main(){ gl_FragColor = vec4(uColor * pow(vF, 2.2) * uOpacity * 0.9, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const setCrack = (o) => { crackMat.opacity = o; crackGlowMat.uniforms.uOpacity.value = o; };
  if (selloG) {
    sealRoot = selloG.scene.getObjectByName('Sello') || selloG.scene;
    const cache = new Map();
    const toPhysical = (m) => {
      const p = new THREE.MeshPhysicalMaterial({
        name: m.name, map: m.map, normalMap: m.normalMap, normalScale: m.normalScale ? m.normalScale.clone().multiplyScalar(0.8) : new THREE.Vector2(0.8, 0.8),
        roughnessMap: m.roughnessMap, metalnessMap: m.metalnessMap, aoMap: m.aoMap, aoMapIntensity: 1.0, roughness: 1, metalness: 1,
        clearcoat: m.name === 'lacre' ? 0.18 : 0, clearcoatRoughness: 0.32, specularIntensity: 0.6,
        sheen: 0.25, sheenColor: new THREE.Color('#a3202e'), sheenRoughness: 0.5, envMapIntensity: 0.95,
        emissive: new THREE.Color(m.name === 'lacre_interior' ? '#ff4a14' : '#a3202e'), emissiveIntensity: 0,
      });
      if (m.name === 'lacre') {
        // FIX: brillo propio del oro del monograma (J & M legible sobre el burdeos); late con la canción
        p.onBeforeCompile = (sh) => {
          sh.uniforms.uGoldGlow = goldGlow;
          sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGoldGlow;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGoldGlow * vec3(1.0, 0.82, 0.52) * diffuseColor.rgb * smoothstep(0.3, 0.85, metalnessFactor);');
        };
        p.customProgramCacheKey = () => 'lacre-oro';
      }
      // FIX: la cara interna de las fracturas es cera oscura (el horneado salía beige pálido)
      if (m.name === 'lacre_interior') { p.color.setRGB(0.42, 0.17, 0.15); p.sheen = 0.1; }
      return p;
    };
    selloG.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const k = o.material.name;
      if (!cache.has(k)) cache.set(k, toPhysical(o.material));
      o.material = cache.get(k);
    });
    interiorMats = [cache.get('lacre_interior')].filter(Boolean);
    lacreMats = [cache.get('lacre')].filter(Boolean);
    entero = sealRoot.getObjectByName('sello_entero');
    frags = [0, 1, 2, 3, 4].map((i) => sealRoot.getObjectByName('sello_frag_' + i)).filter(Boolean);
    fragRest = frags.map((f) => ({ p: f.position.clone(), q: f.quaternion.clone(), com: Array.isArray(f.userData.centro_masa) ? f.userData.centro_masa[2] : 0.0021,
      dir: Array.isArray(f.userData.salida) ? new THREE.Vector3(...f.userData.salida) : f.position.clone().setZ(0).normalize() }));
    frags.forEach((f) => (f.visible = false));
    let grietas = {};
    try { grietas = JSON.parse(sealRoot.userData.grietas || '{}'); } catch { /* */ }
    for (const [name, pts] of Object.entries(grietas)) {
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
      const segs = Math.max(8, pts.length * 2), delay = name === 'br' || name === 'c1b' ? 0.18 : 0;
      for (const [rad, mat, ro] of [[0.00026, crackMat, 4], [0.00095, crackGlowMat, 5]]) {
        const g = new THREE.TubeGeometry(curve, segs, rad, 6, false);
        const m = new THREE.Mesh(g, mat); m.geometry.setDrawRange(0, 0); m.renderOrder = ro;
        m.userData.full = g.index.count; m.userData.delay = delay;
        crackMeshes.push(m); sealRoot.add(m);
      }
    }
    sealHolder.add(selloG.scene);
  } else {
    const wax = new THREE.MeshPhysicalMaterial({ color: '#6e0f1a', roughness: 0.32, clearcoat: 0.5, sheen: 0.3, sheenColor: '#a3202e', emissive: '#a3202e', emissiveIntensity: 0 });
    lacreMats = [wax];
    const rr = 0.018, hh = 0.0058, prof = [new THREE.Vector2(0, hh)];
    for (let i = 1; i <= 24; i++) { const a = i / 24; prof.push(new THREE.Vector2(rr * a, hh * Math.pow(1 - Math.pow(a, 7), 0.55))); }
    prof.push(new THREE.Vector2(rr * 0.97, 0), new THREE.Vector2(0, 0));
    const geo = new THREE.LatheGeometry(prof.reverse(), 64); geo.rotateX(Math.PI / 2);
    entero = new THREE.Mesh(geo, wax); entero.castShadow = entero.receiveShadow = true; sealHolder.add(entero);
  }
  // halo suave alrededor del sello (aditivo, en el plano del sello)
  // FIX: con prueba de profundidad (las orejas del moño que quedan delante lo tapan: antes se pintaba encima como neblina)
  const auraMat = new THREE.ShaderMaterial({ vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: FS_AURA, uniforms: { uI: { value: 0 }, uTime: { value: 0 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), auraMat);
  aura.position.z = 0.0018; aura.renderOrder = 7; sealHolder.add(aura);
  // PERF-RETOMA: el armado de la escena tras el lazo era un solo tramo síncrono (~40 ms en escritorio, ~155 ms con CPU ×4):
  // se corta en tres ratos ociosos (aquí, tras los pétalos y antes de applyQuality). El bucle no corre hasta `ready`.
  await idle();

  // ───────── migas de lacre (instanciadas) y fragmentos con física
  const CRUMBS = 34;
  const crumbGeo = new THREE.IcosahedronGeometry(1, 0);
  { const pa = crumbGeo.attributes.position; const r = mulberry32(7); for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) * (0.7 + r() * 0.5), pa.getY(i) * (0.55 + r() * 0.4), pa.getZ(i) * (0.7 + r() * 0.5)); crumbGeo.computeVertexNormals(); }
  const crumbMat = new THREE.MeshStandardMaterial({ color: '#5a0b15', roughness: 0.36, metalness: 0, envMapIntensity: 0.6 });
  const crumbs = new THREE.InstancedMesh(crumbGeo, crumbMat, CRUMBS); crumbs.count = 0; crumbs.frustumCulled = false; crumbs.name = 'migas';
  scene.add(crumbs);
  const crumbState = Array.from({ length: CRUMBS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), ax: new THREE.Vector3(1, 0, 0), w: 0, r: 0.001, sleep: false }));
  let crumbN = 0;
  const fragState = [];

  // ESCENA: rectángulo de la columna de texto en pantalla (NDC) compartido por chispas y motas: nada brilla delante del texto
  const cleanU = { uCleanNdc: { value: new THREE.Vector4(2, 2, 2, 2) }, uCleanAmt: { value: 0 } };
  // chispas + polvo de oro (un solo sistema aditivo)
  const sparks = createSparks(900, cleanU);
  scene.add(sparks.points);

  // motas de polvo en el haz de la vela (todo en el vertex shader: coste de CPU nulo)
  const DUST = mobile ? 260 : 520;
  const dustBox = { min: new THREE.Vector3(-0.5, 0.0, -0.4), size: new THREE.Vector3(1.0, 0.72, 0.9) };
  const dustGeo = new THREE.BufferGeometry();
  {
    const r = mulberry32(99); const p = new Float32Array(DUST * 3), s = new Float32Array(DUST * 4);
    for (let i = 0; i < DUST; i++) {
      p[i * 3] = dustBox.min.x + r() * dustBox.size.x; p[i * 3 + 1] = dustBox.min.y + r() * dustBox.size.y; p[i * 3 + 2] = dustBox.min.z + r() * dustBox.size.z;
      s[i * 4] = r(); s[i * 4 + 1] = r(); s[i * 4 + 2] = r(); s[i * 4 + 3] = r();
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(p, 3)); dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(s, 4));
  }
  const dustMat = new THREE.ShaderMaterial({ vertexShader: VS_DUST, fragmentShader: FS_DUST, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uScale: { value: 800 }, uFlick: { value: 1 }, uAmt: { value: reduced ? 0.5 : 1 }, uSpotPos: { value: new THREE.Vector3() }, uSpotDir: { value: new THREE.Vector3(0, -1, 0) },
      uBoxMin: { value: dustBox.min }, uBoxSize: { value: dustBox.size }, uCosOuter: { value: Math.cos(KEY_ANGLE * 0.62) }, uCosInner: { value: Math.cos(KEY_ANGLE * 0.12) }, ...cleanU } });
  const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; dust.renderOrder = 3; dust.name = 'motas';
  scene.add(dust);

  // ───────── pétalos (dos variantes instanciadas, con sombra recortada)
  const PETALS = mobile ? 26 : 44;
  const petalGeo = new THREE.PlaneGeometry(1, 1, 4, 4);
  { const pa = petalGeo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i); pa.setZ(i, 0.17 * x * x - 0.06 * (y + 0.5) * (y + 0.5) + 0.03 * x * y); } petalGeo.computeVertexNormals(); }
  const petalSets = [tPet1, tPet2].map((tex, k) => {
    // (el tinte cálido de la albedo saca el tono malva de petalo_2 en la sombra: marfil-rosado / rosa, nunca lila)
    const mat = new THREE.MeshLambertMaterial({ map: tex || null, color: tex ? (k ? '#ffe0b8' : '#fff1e0') : (k ? '#e8b4b0' : '#f3dcd0'), alphaTest: 0.45, side: THREE.DoubleSide, transparent: false,
      emissive: '#d6a594', emissiveMap: tex || null, emissiveIntensity: 0.55 });
    // FIX (paleta marfil-rosado): la irradiancia directa se pasa a un tono cálido conservando su luminancia
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  { vec3 alb = max(diffuseColor.rgb, vec3(0.03)); vec3 irr = reflectedLight.directDiffuse / alb;
    float li = dot(irr, vec3(0.299, 0.587, 0.114));
    reflectedLight.directDiffuse = alb * mix(irr, li * vec3(1.08, 0.96, 0.84), 0.85); }`);
    };
    mat.customProgramCacheKey = () => 'petalo-calido';
    const mesh = new THREE.InstancedMesh(petalGeo, mat, Math.ceil(PETALS / 2)); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.name = 'petalos_' + k;
    scene.add(mesh);
    return { mesh, mat, list: [] };
  });
  const petals = Array.from({ length: PETALS }, (_, i) => ({ set: i % 2, slot: Math.floor(i / 2), state: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(),
    ax: new THREE.Vector3(), w: 0, s: 0.035, age: 0, ph: 0, f1: 1, f2: 1, f3: 1, vt: 0.07, wind: 0, landT: 0, qT: new THREE.Quaternion(), fade: 1 }));
  petalSets.forEach((ps, k) => (ps.mesh.count = petals.filter((p) => p.set === k).length));
  const _m4 = new THREE.Matrix4(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  petals.forEach((p) => petalSets[p.set].mesh.setMatrixAt(p.slot, _zero));
  await idle(); // PERF-RETOMA (2.º corte del armado)

  // ───────── poses del pergamino
  const closedPos = new THREE.Vector3(0, -TABLE_Z_LOCAL, 0);
  const qLie = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const qClosed = new THREE.Quaternion();
  const OPEN_TILT = 0.1;
  const openPos = new THREE.Vector3(0, 0.272, 0);
  const qOpen = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -OPEN_TILT);
  function closedYaw() { return lerp(0.82, 0.1, clamp((aspect - 0.55) / (1.25 - 0.55))); }
  function updateClosedQuat() { qClosed.setFromAxisAngle(UP, closedYaw()).multiply(qLie); }
  updateClosedQuat();
  rig.position.copy(closedPos); rig.quaternion.copy(qClosed); rig.updateMatrixWorld(true);

  // ───────── encuadre responsive (busca la distancia que hace caber los puntos en el recuadro NDC)
  const tmpCam = new THREE.PerspectiveCamera();
  const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();
  const safe = { top: opts.safeArea?.top || 0, bottom: opts.safeArea?.bottom || 0 };
  // ESCENA: zona que tapa la interfaz del sitio en la lectura y el encuadre final (CTA abajo en móvil/tableta, a la derecha en
  // escritorio ancho; botón de música): main.js la mide y la pasa con setSafeArea({ top, bottom, left, right }) en px
  const readSafe = { top: 0, bottom: 0, left: 0, right: 0 };
  function fitPose(points, target, dir, mx, my, cy = 0, out, area = safe) {
    tmpCam.fov = camera.fov; tmpCam.aspect = aspect; tmpCam.near = 0.005; tmpCam.far = 50; tmpCam.updateProjectionMatrix();
    // zona útil (descontando la interfaz del sitio que tapa arriba/abajo y, en el encuadre final, a los lados)
    const top = 1 - 2 * clamp(area.top / H, 0, 0.45), bot = -1 + 2 * clamp(area.bottom / H, 0, 0.45);
    const lft = -1 + 2 * clamp((area.left || 0) / W, 0, 0.45), rgt = 1 - 2 * clamp((area.right || 0) / W, 0, 0.45);
    const half = (top - bot) / 2, ctr = (top + bot) / 2 + cy * half;
    const halfX = (rgt - lft) / 2, ctrX = (rgt + lft) / 2;
    const myEff = Math.max(0.15, (my - Math.abs(cy)) * half), mxEff = Math.max(0.15, mx * halfX);
    let lo = 0.03, hi = 8;
    for (let it = 0; it < 30; it++) {
      const d = (lo + hi) / 2;
      tmpCam.position.copy(target).addScaledVector(dir, d); tmpCam.lookAt(target); tmpCam.updateMatrixWorld(true);
      let ok = true;
      for (const p of points) {
        _v.copy(p).applyMatrix4(tmpCam.matrixWorldInverse);
        if (_v.z > -0.01) { ok = false; break; }
        _v.applyMatrix4(tmpCam.projectionMatrix);
        if (Math.abs(_v.x) > mxEff || Math.abs(_v.y) > myEff) { ok = false; break; }
      }
      if (ok) hi = d; else lo = d;
    }
    out.pos.copy(target).addScaledVector(dir, hi); out.tgt.copy(target);
    // desplaza para centrar el objeto en la zona útil (vertical y, si hay zona lateral, horizontal)
    const tf = hi * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    _v2.set(0, 1, 0).applyQuaternion(tmpCam.quaternion);
    out.pos.addScaledVector(_v2, -ctr * tf); out.tgt.addScaledVector(_v2, -ctr * tf);
    if (Math.abs(ctrX) > 1e-4) {
      _v2.set(1, 0, 0).applyQuaternion(tmpCam.quaternion);
      out.pos.addScaledVector(_v2, -ctrX * tf * aspect); out.tgt.addScaledVector(_v2, -ctrX * tf * aspect);
    }
    out.dist = hi;
    out.pxPerM = (H / 2) / tf; // px de pantalla por metro en el plano del objetivo (para medir la altura-x)
    return out;
  }
  const dirFrom = (el, az) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const mkPose = () => ({ pos: new THREE.Vector3(), tgt: new THREE.Vector3(), focus: new THREE.Vector3(), dist: 1, pxPerM: 1 });
  const poses = { closed: mkPose(), seal: mkPose(), medium: mkPose(), open: mkPose(), final: mkPose(), wide: mkPose(), read: mkPose() };
  // ESCENA · columna de texto (local de la hoja abierta) y altura-x del cuerpo en metros (para elegir encuadres legibles)
  const TA = PARCH.TEXT_AREA || { center: [0.063, 0.0273, 0], width: 0.1416, height: 0.3541 };
  const XH = (P.debug?.layout?.alturaX ?? 43.6) * (SHEET_W / 2048);
  const READ_XH_MAX = 26;   // px: altura-x máxima al leer (más cerca solo marea)
  let finalMode = 'sheet';  // 'sheet' (hoja completa) | 'column' (móvil vertical: la columna centrada)
  // ESCENA · lugar reservado del TINTERO sobre la mesa, a la derecha del rollo inferior (diestro), junto a la vela de la derecha
  // en pantallas anchas; en vertical se arrima a la hoja para seguir en cuadro. Mundo: y = 0 (mesa).
  const inkSpot = { pos: new THREE.Vector3(0.205, 0, 0.085), rotY: 0.9 }; // (rotY: la pluma en reposo se recuesta hacia atrás-derecha, lejos de los CTA)
  let quill = null;         // pluma de js/pluma.js (attachQuill)
  let quillSheen = true;    // UNIR: familia de materiales de la pluma fijada al engancharla (L0–L2 con brillo sedoso, L3–L4 sin él)
  const tmpObj = new THREE.Object3D();
  function localPointsTo(pos, quat, list) { tmpObj.position.copy(pos); tmpObj.quaternion.copy(quat); tmpObj.updateMatrixWorld(true); return list.map((p) => new THREE.Vector3(...p).applyMatrix4(tmpObj.matrixWorld)); }
  function boxPts(x0, x1, y0, y1, z0, z1) { const o = []; for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) o.push([x, y, z]); return o; }
  const ka0 = () => clamp((aspect - 0.6) / 0.9); // 0 vertical … 1 apaisado ancho (vela y tintero responsive)
  function computePoses() {
    const portrait = aspect < 0.85;
    camera.fov = portrait ? 36 : aspect < 1.25 ? 32 : 29;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    // cerrado: el pergamino entero (varillas con remates) + colas del lazo
    const cPts = localPointsTo(closedPos, qClosed, boxPts(-ROD_HALF, ROD_HALF, -0.07, 0.034, -0.0004, 0.036));
    const cCtr = new THREE.Box3().setFromPoints(cPts).getCenter(new THREE.Vector3());
    fitPose(cPts, cCtr, dirFrom(0.74, 0), portrait ? 0.96 : 0.78, portrait ? 0.64 : 0.6, portrait ? -0.04 : -0.15, poses.closed);
    tmpObj.position.copy(closedPos); tmpObj.quaternion.copy(qClosed); tmpObj.updateMatrixWorld(true);
    const sealW = rb.knot.position.clone().add(new THREE.Vector3(0, 0, 0.003)).applyMatrix4(tmpObj.matrixWorld);
    poses.closed.focus.copy(sealW);
    // primer plano del sello (con las orejas del moño)
    const sPts = localPointsTo(closedPos, qClosed, boxPts(-0.042, 0.042, -0.036, 0.032, 0.0, 0.036));
    fitPose(sPts, sealW, dirFrom(0.95, -0.12), portrait ? 0.9 : 0.62, portrait ? 0.6 : 0.62, 0, poses.seal);
    poses.seal.focus.copy(sealW);
    // plano medio (la cinta se desata y cae)
    const mPts = localPointsTo(closedPos, qClosed, boxPts(-ROD_HALF, ROD_HALF, -0.11, 0.06, -0.0004, 0.05));
    fitPose(mPts, cCtr, dirFrom(0.6, 0.05), portrait ? 0.97 : 0.8, portrait ? 0.62 : 0.66, -0.02, poses.medium);
    poses.medium.focus.copy(sealW);
    // abierto: hoja completa y legible (escritorio: a la altura; móvil vertical: al ancho)
    // FIX: en vertical se encuadra por la varilla con sus remates de latón (antes por la hoja: los remates quedaban cortados)
    const halfX = ROD_HALF;
    const oPts = localPointsTo(openPos, qOpen, boxPts(-halfX, halfX, -OPEN_HALF_H, OPEN_HALF_H, 0, 0.024));
    const oCtr = new THREE.Vector3(0, 0, 0.006).applyMatrix4(tmpObj.matrixWorld); // tmpObj quedó en la pose abierta
    fitPose(oPts, oCtr, dirFrom(OPEN_TILT + 0.02, 0.05), portrait ? 0.96 : 0.92, portrait ? 0.86 : 0.9, 0, poses.open);
    poses.open.focus.copy(oCtr);
    // ESCENA · encuadre final LEGIBLE: hoja completa (varillas incluidas) en la zona libre de los CTA; si así la altura-x del cuerpo
    // queda bajo ~9.5 px (móvil vertical, apaisado bajo), la columna de texto centrada y completa.
    const readDir = dirFrom(OPEN_TILT + 0.02, 0.05);
    fitPose(oPts, oCtr, readDir, 0.96, 0.97, 0, poses.final, readSafe);
    finalMode = 'sheet';
    // CREMA (decisión n.º 9.4, «desde lejos no se ve»): en pantallas apaisadas la hoja completa sube hasta un 5 % para llegar a
    // ~12 px de altura-x (la caja 3D es holgada: las varillas apenas rozan el borde; el papel y el texto quedan enteros)
    if (aspect >= 0.85 && poses.final.pxPerM * XH < 12 && poses.final.pxPerM * XH >= 9.5) {
      const k = Math.min(1.065, 12.3 / (poses.final.pxPerM * XH));
      fitPose(oPts, oCtr, readDir, 0.96 * k, 0.97 * k, 0, poses.final, readSafe);
    }
    if (poses.final.pxPerM * XH < 9.5) {
      // móvil: centrado en la columna de texto y con la hoja completa en alto (los CTA de abajo nunca la pisan) si así la
      // altura-x llega a 8 px; si no (apaisado bajo), solo la columna completa
      const c = TA.center, m = 0.007;
      const cPts = localPointsTo(openPos, qOpen, boxPts(c[0] - TA.width / 2 - m, c[0] + TA.width / 2 + m, -OPEN_HALF_H, OPEN_HALF_H, 0, 0.02));
      const cCtr2 = new THREE.Vector3(c[0], 0, 0.006).applyMatrix4(tmpObj.matrixWorld);
      fitPose(cPts, cCtr2, readDir, 0.97, 0.975, 0, poses.final, readSafe);
      finalMode = 'column';
      if (poses.final.pxPerM * XH < 8) {
        const tPts = localPointsTo(openPos, qOpen, boxPts(c[0] - TA.width / 2 - m, c[0] + TA.width / 2 + m, c[1] - TA.height / 2 - m, c[1] + TA.height / 2 + m, 0, 0.004));
        const tCtr = new THREE.Vector3(c[0], c[1], 0.002).applyMatrix4(tmpObj.matrixWorld);
        fitPose(tPts, tCtr, readDir, 0.97, 0.97, 0, poses.final, readSafe);
        finalMode = 'text';
      }
    }
    poses.final.focus.copy(oCtr);
    // tintero (responsive: en vertical se arrima a la hoja) y plano abierto que lo incluye (remojos y vuelo de la pluma)
    inkSpot.pos.set(lerp(0.15, 0.205, ka0()), 0, lerp(0.1, 0.085, ka0()));
    if (quill?.inkwell) { quill.inkwell.position.copy(inkSpot.pos); quill.inkwell.rotation.y = inkSpot.rotY; quill.inkwell.updateMatrixWorld(true); }
    const iPts = [...oPts, ...boxPts(inkSpot.pos.x - 0.03, inkSpot.pos.x + 0.03, 0, 0.08, inkSpot.pos.z - 0.03, inkSpot.pos.z + 0.03).map((p) => new THREE.Vector3(...p))];
    fitPose(iPts, oCtr, readDir, 0.96, 0.95, 0, poses.wide, readSafe);
    poses.wide.focus.copy(oCtr);
    // vela del fondo (responsive: en vertical se acerca al centro para seguir en cuadro)
    const ka = clamp((aspect - 0.6) / 0.9);
    candle.position.set(lerp(-0.13, -0.255, ka), 0, lerp(-0.24, -0.19, ka));
    candle2.position.set(lerp(0.2, 0.3, ka), 0, lerp(-0.2, -0.14, ka)); candle2.updateMatrixWorld(true);
    flamePos2.set(0, wickY + 0.018, 0).applyMatrix4(candle2.matrixWorld);
    candle.updateMatrixWorld(true);
    flamePos.set(0, wickY + 0.018, 0).applyMatrix4(candle.matrixWorld);
    candleLight.position.copy(flamePos);
  }

  // ───────── estado
  let active = true, inView = true, disposed = false, frozen = false;
  let time = 0, opening = false, opened = false, phase = 'idle';
  let hovered = false, auraI = 0.0, beatPulse = 0, hoverGlow = 0, songE = 0.4;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, inside: false, down: null };
  const cam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), vp: new THREE.Vector3(), vt: new THREE.Vector3(), focus: 1, goal: 'closed' };
  const grade = { sepia: 0.1, grain: 0.028, vig: 0.5, expo: 1, dof: 0.85, bloom: 0.5, fade: 0, warm: 0.6 };
  // ESCENA · ritmo de la secuencia (max(tiempo, scroll) con tope) y lectura
  let scrollMax = 0, hasScroll = false;  // máximo del progreso del recorrido fijo que pasa main.js (nunca retrocede)
  const pace = { mul: 1, wNat: 0, wRate: 1, wRateS: 1, back: -1, ctaShown: false, gate: 0, wt: 0 };
  let readK = 0, cleanAmt = 0, wideK = 0, textFade = 1, camCut = 0;
  const uState = { u: 0, v: 0 };
  let seq = null;
  let openClock = 0, nextSweep = 6, sweepT = -1, sweepDur = 1.8, sweepGain = 1.25, nextDrizzle = 0;
  let idleSparkT = 0;
  const env = { gravityLocal: new THREE.Vector3(0, 0, -9.81), groundPlaneLocal: new THREE.Plane(), collideRolls: true };
  const _inv = new THREE.Matrix4();
  const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let rng = mulberry32(20261224);
  const rnd = (a, b) => a + (b - a) * rng();

  computePoses();
  cam.pos.copy(poses.closed.pos); cam.tgt.copy(poses.closed.tgt); cam.focus = poses.closed.pos.distanceTo(poses.closed.focus);
  camera.position.copy(cam.pos); camera.lookAt(cam.tgt);

  // ───────── tamaño / calidad
  let pointScale = 800;
  let sizeKey = '';
  // COMPAT-FLUIDEZ (hallazgos 15/32/45, memoria de GPU en teléfonos de 2–4 GB): con la sección lejos (main.js lo pide), los
  // destinos del posproceso (MSAA HDR), el mapa de sombras y el búfer del lienzo quedan en 1×1 (≈ 30–60 MB menos en un
  // teléfono); se recrean al volver, antes del primer cuadro (setActive(true) → gpuWake).
  let gpuAsleep = false;
  function gpuSleep() {
    if (gpuAsleep || disposed || frozen || !ready) return false;
    gpuAsleep = true;
    try { post?.setSize(1, 1); key.shadow.map?.dispose(); key.shadow.map = null; renderer.setSize(1, 1, false); sizeKey = ''; } catch { /* */ }
    return true;
  }
  function gpuWake() {
    if (!gpuAsleep || disposed) return;
    gpuAsleep = false;
    try { applySize(); renderer.shadowMap.needsUpdate = true; } catch { /* */ }
  }
  function applySize() {
    if (gpuAsleep) { sizeKey = ''; return; } // (dormido: se mide al despertar)
    measure();
    dpr = Math.min(Q.dpr, window.devicePixelRatio || 1, DPR_CAP);
    // PERF-RETOMA: solo si cambió el tamaño o la densidad (renderer.setSize reasigna el búfer del lienzo aunque sea igual:
    // ~70 ms en escritorio con MSAA, y lo borra). Antes pasaba también en el primer aviso del ResizeObserver y en cada cambio
    // de nivel que no toca el DPR (L2↔L3↔L4).
    const key = W + 'x' + H + '@' + dpr;
    if (key !== sizeKey) {
      sizeKey = key;
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
    }
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    post?.setSize(db.x, db.y);
    computePoses();
    pointScale = db.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    sparks.material.uniforms.uScale.value = pointScale; dustMat.uniforms.uScale.value = pointScale;
    if (!opening && !opened) { updateClosedQuat(); rig.quaternion.copy(qClosed); rig.updateMatrixWorld(true); }
  }
  function applyQuality() {
    Q = LEVELS[qLevel];
    if (post) post.setSamples(Q.samples);
    if (key.shadow.mapSize.x !== Q.shadow) { key.shadow.mapSize.set(Q.shadow, Q.shadow); key.shadow.map?.dispose(); key.shadow.map = null; }
    // PERF: en L3/L4 el mapa de sombras solo se redibuja cuando algo se mueve (ver renderFrame); al cambiar de nivel, una vez
    renderer.shadowMap.autoUpdate = !Q.lazySh; renderer.shadowMap.needsUpdate = true;
    vignetteEl.style.display = Q.post > 0 && post ? 'none' : 'block';
    applyBg(!!(Q.post > 0 && post));
    dust.geometry.setDrawRange(0, Math.round(DUST * Q.parts));
    applySize();
    // UNIR: la pluma sigue la calidad (franjas de sombra, ondas, sombra en la mesa) sin cambiar de familia de materiales:
    // pasar de L2 a L3 cambiaría sus materiales con brillo sedoso por los estándar y compilaría 2 programas en pleno cuadro
    try { quill?.setQuality?.(quillSheen ? Math.min(qLevel, 2) : Math.max(qLevel, 3)); } catch { /* */ }
    fpsWin.t = 0; fpsWin.n = 0; fpsWin.warm = 2.0; fpsWin.good = 0; fpsWin.max = 0;
  }
  const fpsWin = { t: 0, n: 0, warm: 2.5, lastChange: 0, max: 0, good: 0 };
  let fps = 0, fpsAcc = 0, fpsN = 0;
  // PERF: frames largos del hilo principal causados por OTRO código JS (montajes, revelados): esa ventana no se mide.
  // (Un frame largo SIN JS que bloquee es la GPU/el compositor: ese sí cuenta, es justo lo que esta adaptación corrige.)
  let foreignLong = 0;
  try {
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.duration < 100) continue;
        let js = 0, other = 0;
        for (const s of e.scripts || []) { js += s.duration || 0; if (!/scroll3d\.js|parchment\.js|ribbon\.js/.test(s.sourceURL || '')) other += s.duration || 0; }
        const blocked = e.entryType !== 'long-animation-frame' || ((e.blockingDuration ?? 0) >= 50 && js >= 50);
        if (blocked && (e.entryType !== 'long-animation-frame' || other >= 50)) foreignLong = Math.max(foreignLong, e.startTime + e.duration);
      }
    });
    try { po.observe({ type: 'long-animation-frame', buffered: false }); } catch { po.observe({ type: 'longtask', buffered: false }); }
    disposeExtra.push(() => po.disconnect());
  } catch { /* sin PerformanceObserver */ }
  function drop(n) {
    // ESCENA: la apertura dura ahora ~35 s (escritura natural) y la otra variante de los programas (pantalla, L3/L4) se compila
    // al terminarla: hasta entonces la bajada se queda en L2 (mismo destino HDR, DPR 1, solo bloom), sin recompilar en vivo
    // (antes: L2 → L3 durante la lectura = 1.4 s congelado compilando ~40 programas).
    let target = Math.min(LEVELS.length - 1, qLevel + n);
    if (post && LEVELS[target].post === 0 && LEVELS[qLevel].post > 0 && !variantReady.screen) target = Math.max(qLevel, 2);
    if (target === qLevel) { fpsWin.t = 0; fpsWin.n = 0; fpsWin.max = 0; fpsWin.warm = 2; compileOtherVariant(); return; }
    // volvió a caer poco después de recuperar → ESE nivel queda bloqueado (se puede volver a los de abajo, no a él)
    if (time - lastRecoverT < 8) lockAt = Math.max(lockAt, qLevel);
    qLevel = target; recovered = 0; applyQuality();
  }
  const variantReady = { hdr: false, screen: false };
  // FIX (modo de bajo consumo de iOS / ahorro de batería de Android: rAF limitado a 30 Hz con la GPU ociosa): con cuadros
  // cuantizados a ~33 ms se exige 27 fps de media (no 45): antes el pergamino bajaba a L4 (DPR 1, sin posproceso, 15 % de
  // partículas) para siempre sin ganar nada.
  const dts = new Float32Array(64); let dtN = 0;
  function cap30() {
    const n = Math.min(dtN, 64);
    if (n < 40) return false;
    const a = Array.from(dts.subarray(0, n)).sort((x, y) => x - y);
    const med = a[n >> 1], p90 = a[Math.floor(n * 0.9)];
    return med > 0.031 && med < 0.0355 && p90 < 0.038;
  }
  function adapt(dt) {
    if (dt > 0 && dt < 0.2) dts[(dtN++) & 63] = dt;
    fpsAcc += dt; fpsN++;
    if (fpsAcc >= 0.5) { fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
    if (forcedQ !== null || !ready) return;
    if (fpsWin.warm > 0) { fpsWin.warm -= dt; return; }
    // ventana con un frame largo ajeno (p. ej. otro módulo montándose): se descarta
    if (foreignLong > performance.now() - 1000 * fpsWin.t - 120) { fpsWin.t = 0; fpsWin.n = 0; fpsWin.max = 0; return; }
    fpsWin.t += dt; fpsWin.n++; fpsWin.max = Math.max(fpsWin.max, dt);
    // FIX: bajada rápida (tras ~1 s real): si sin contar el peor cuadro (un tirón aislado) no llega a 25 fps, baja 2 niveles
    if (fpsWin.t >= 1.0 && fpsWin.n >= 2 && qLevel < LEVELS.length - 1) {
      const robust = (fpsWin.n - 1) / Math.max(1e-3, fpsWin.t - fpsWin.max);
      if (robust < (cap30() ? 22 : 25)) { drop(2); return; }
    }
    if (fpsWin.t >= 2.0) {
      const avg = fpsWin.n / fpsWin.t;
      fpsWin.t = 0; fpsWin.n = 0; fpsWin.max = 0;
      if (avg < (cap30() ? 27 : upgrades > 0 && !lockUp ? 52 : 45) && qLevel < LEVELS.length - 1) {
        if (upgrades > 0 && qLevel === 0) lockUp = true;
        drop(1);
      } else if (avg > 50 && !opening) {
        // PERF: recuperación tras una caída pasajera (montaje tardío, desatado en CPU lenta, GPU compartida): 3 ventanas
        // seguidas de 2 s por encima de 50 fps → sube un nivel (hasta 2 por caída; nunca por encima de lockAt)
        fpsWin.good++;
        if (fpsWin.good >= 3 && qLevel > 1 && recovered < 2 && qLevel - 1 > lockAt) { recovered++; lastRecoverT = time; qLevel--; applyQuality(); return; }
        // sube a L0 (MSAA) una sola vez si sobra rendimiento de forma sostenida
        if (avg > 57 && fpsWin.good >= 5 && qLevel === 1 && !lockUp && upgrades < 1 && lockAt < 0) { upgrades++; qLevel = 0; applyQuality(); }
      } else fpsWin.good = 0;
    }
  }

  // ───────── interacción: hover/raycast sobre el sello, toque para abrir, parallax
  const raycaster = new THREE.Raycaster();
  const sealSphere = new THREE.Sphere();
  function sealWorld(out) { return sealHolder.localToWorld(out.set(0, 0, 0.003)); }
  function hitSeal(nx, ny, touch) {
    if (opening || opened || !sealHolder.visible) return false;
    raycaster.setFromCamera(_v2.set(nx, ny, 0), camera);
    sealSphere.center.copy(sealWorld(_v)); sealSphere.radius = touch ? 0.05 : 0.03;
    return raycaster.ray.intersectsSphere(sealSphere);
  }
  const toNdc = (e) => { const r = canvas.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)]; };
  const onMove = (e) => {
    const [x, y] = toNdc(e); pointer.x = x; pointer.y = y; pointer.inside = true;
    if (e.pointerType === 'mouse') {
      const h = hitSeal(x, y, false);
      if (h !== hovered) { hovered = h; canvas.style.cursor = h ? 'pointer' : ''; }
    }
  };
  const onLeave = () => { pointer.inside = false; if (hovered) { hovered = false; canvas.style.cursor = ''; } };
  const onDown = (e) => { const [x, y] = toNdc(e); pointer.down = { x: e.clientX, y: e.clientY, t: performance.now(), nx: x, ny: y, type: e.pointerType }; };
  const onUp = (e) => {
    const d = pointer.down; pointer.down = null;
    if (!d || opening || opened) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12 || performance.now() - d.t > 900) return;
    const [x, y] = toNdc(e);
    if (hitSeal(x, y, e.pointerType !== 'mouse')) open();
  };
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave, { passive: true });
  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  // giroscopio (solo donde no exige permiso: Android); en iOS se queda sin parallax
  let gyroBase = null;
  const onOrient = (e) => {
    if (e.gamma == null || e.beta == null) return;
    if (!gyroBase) gyroBase = { b: e.beta, g: e.gamma };
    pointer.x = clamp((e.gamma - gyroBase.g) / 25, -1, 1); pointer.y = clamp(-(e.beta - gyroBase.b) / 25, -1, 1); pointer.inside = true;
  };
  if (coarse && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function' && !reduced) addEventListener('deviceorientation', onOrient, { passive: true });

  let unsubBeat = null, beatBars = 0;
  function bindMusic(m) {
    try { unsubBeat?.(); } catch { /* */ }
    unsubBeat = null; music = m || null;
    try {
      if (typeof music?.onBeat === 'function') unsubBeat = music.onBeat((i, t, info) => {
        beatPulse = Math.max(beatPulse, info?.strength ?? info?.accent ?? 0.6);
        // con el pergamino abierto, cada tiempo fuerte suelta un soplo de polvo de oro
        if (opened && info?.downbeat && !reduced && active && inView && Q.parts >= 0.5) glitterRain(Math.round(10 * Q.parts));
        // IDEA (FIX ronda 1): cada 2 compases la luz recorre los nombres en pan de oro al compás de la canción (antes cada ~7 s
        // por reloj): los nombres destacan a intervalos y el oro "canta" con la música
        if (opened && info?.downbeat && !reduced && active && inView) {
          beatBars++;
          if (beatBars % 2 === 0 && sweepT < 0 && openClock > 3) { sweepT = 0; nextSweep = openClock + 30; }
        }
      });
    } catch { /* */ }
  }
  bindMusic(music);

  // ───────── física de fragmentos, migas
  const capsuleOn = () => !seq || seq.liftT < 0;
  const _l = new THREE.Vector3(), _n = new THREE.Vector3(), _vl = new THREE.Vector3();
  // colisión con el "estadio" del pergamino cerrado (cápsula en el plano YZ local, extruida en X) + mesa.
  function collide(p, v, r, rest, fric) {
    let contact = false;
    if (p.y - r < 0) { p.y = r; if (v.y < 0) v.y = -v.y * rest; v.x *= fric; v.z *= fric; contact = true; }
    if (capsuleOn()) {
      _l.copy(p).applyMatrix4(_inv);
      if (Math.abs(_l.x) < SHEET_W / 2 + 0.004) {
        const cy = clamp(_l.y, -Y_C, Y_C), dy = _l.y - cy, dz = _l.z - Z_C, d = Math.hypot(dy, dz), R = R_C + r;
        if (d < R && d > 1e-6) {
          _n.set(0, dy / d, dz / d).transformDirection(rig.matrixWorld);
          _l.y = cy + (dy / d) * R; _l.z = Z_C + (dz / d) * R; p.copy(_l).applyMatrix4(rig.matrixWorld);
          const vn = v.dot(_n);
          if (vn < 0) { _vl.copy(_n).multiplyScalar(vn); v.sub(_vl).multiplyScalar(fric).addScaledVector(_n, -vn * rest); }
          contact = true;
        }
      }
    }
    return contact;
  }
  function breakSeal() {
    rig.updateMatrixWorld(true);
    _inv.copy(rig.matrixWorld).invert();
    const nW = new THREE.Vector3(0, 0, 1).transformDirection(sealHolder.matrixWorld);
    const center = sealWorld(new THREE.Vector3());
    if (entero) entero.visible = false;
    fragState.length = 0;
    frags.forEach((f, i) => {
      f.visible = true;
      scene.attach(f);
      const d0 = fragRest[i].dir;
      // empuja cada pieza hacia delante/atrás del estadio para que caiga a la mesa (y no se quede encima del rollo)
      const dl = new THREE.Vector3(d0.x * 0.55, Math.sign(d0.y || (i % 2 ? 1 : -1)) * Math.max(Math.abs(d0.y), 0.8), 0).normalize();
      const dW = dl.transformDirection(sealHolder.matrixWorld);
      const v = dW.multiplyScalar(reduced ? 0.04 : rnd(0.075, 0.11)).addScaledVector(nW, reduced ? 0.05 : rnd(0.16, 0.22));
      const ax = new THREE.Vector3().crossVectors(nW, v).normalize();
      fragState.push({ obj: f, v, ax, w: (reduced ? 2 : rnd(6, 10)) * (rng() < 0.5 ? -1 : 1), com: fragRest[i].com, sleep: false, settle: 0, qT: null });
    });
    if (!reduced) {
      // migas
      crumbN = Math.round(CRUMBS * Math.max(0.5, Q.parts));
      for (let i = 0; i < crumbN; i++) {
        const c = crumbState[i];
        const a = rng() * Math.PI * 2, rr = rnd(0.002, 0.014);
        c.p.set(Math.cos(a) * rr, Math.sin(a) * rr, rnd(0.003, 0.005)); sealHolder.localToWorld(c.p);
        c.v.set(Math.cos(a), 0, Math.sin(a)).multiplyScalar(rnd(0.03, 0.14)).addScaledVector(nW, rnd(0.08, 0.26));
        c.q.setFromEuler(new THREE.Euler(rng() * 6, rng() * 6, rng() * 6)); c.ax.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
        c.w = rnd(8, 25); c.r = rnd(0.0005, 0.0013); c.sleep = false;
      }
      crumbs.count = crumbN;
      // chispas desde las grietas
      const nS = Math.round(70 * Q.parts);
      for (let i = 0; i < nS; i++) {
        const a = rng() * Math.PI * 2, rr = rnd(0.0, 0.012);
        const p = new THREE.Vector3(Math.cos(a) * rr, Math.sin(a) * rr, 0.005); sealHolder.localToWorld(p);
        const dir = new THREE.Vector3(Math.cos(a) * rnd(0.3, 1), 0, Math.sin(a) * rnd(0.3, 1)).addScaledVector(nW, rnd(0.6, 1.6)).normalize();
        const k = rnd(2.2, 5.5);
        sparks.spawn(p, dir.multiplyScalar(rnd(0.08, 0.32)), { color: [1.0 * k, 0.52 * k, 0.18 * k], life: rnd(0.3, 0.9), drag: 2.8, grav: -0.35, size: rnd(0.0005, 0.0011) });
      }
    }
    flash.position.copy(center).addScaledVector(nW, 0.012);
    seq.flashT = 0;
  }
  const _qa = new THREE.Quaternion();
  function updateFragments(dt) {
    if (!fragState.length && !crumbN) return;
    const g = reduced ? 1.8 : 1.15;
    _inv.copy(rig.matrixWorld).invert();
    for (const s of fragState) {
      if (s.sleep) continue;
      const o = s.obj;
      if (s.settle > 0) {
        s.settle += dt; const k = clamp(dt * 7);
        o.quaternion.slerp(s.qT, k); o.position.y = lerp(o.position.y, s.com, k);
        if (s.settle > 1.2) { o.quaternion.copy(s.qT); o.position.y = s.com; s.sleep = true; }
        continue;
      }
      s.v.y -= g * dt;
      o.position.addScaledVector(s.v, dt);
      o.quaternion.premultiply(_qa.setFromAxisAngle(s.ax, s.w * dt));
      s.w *= Math.exp(-1.1 * dt);
      const c = collide(o.position, s.v, 0.0026, 0.3, 0.72);
      if (c) s.w *= 0.8;
      if (o.position.y < 0.0045) { s.v.x *= Math.exp(-dt * 4); s.v.z *= Math.exp(-dt * 4); }
      if (c && o.position.y < 0.006 && s.v.length() < 0.03) {
        // se asienta plano, cara estampada arriba, conservando el giro horizontal
        const zW = _v.set(0, 0, 1).applyQuaternion(o.quaternion);
        s.qT = new THREE.Quaternion().setFromUnitVectors(zW, UP).multiply(o.quaternion);
        s.settle = 1e-4; s.v.set(0, 0, 0);
      }
    }
    for (let i = 0; i < crumbN; i++) {
      const c = crumbState[i];
      if (!c.sleep) {
        c.v.y -= 1.6 * dt;
        c.p.addScaledVector(c.v, dt);
        c.q.premultiply(_qa.setFromAxisAngle(c.ax, c.w * dt)); c.w *= Math.exp(-2 * dt);
        const hit = collide(c.p, c.v, c.r * 0.7, 0.35, 0.6);
        if (hit && c.p.y < c.r * 0.7 + 0.0002) { c.v.x *= Math.exp(-dt * 6); c.v.z *= Math.exp(-dt * 6); if (c.v.lengthSq() < 0.0004) { c.sleep = true; c.w = 0; } }
      }
      _m4.compose(c.p, c.q, _v.setScalar(c.r)); crumbs.setMatrixAt(i, _m4);
    }
    if (crumbN) crumbs.instanceMatrix.needsUpdate = true;
  }

  // ───────── polvo de oro (unroll, lluvia final) y pétalos
  let dustAcc = 0;
  function emitRollDust(du) {
    if (reduced || du <= 0) return;
    dustAcc += du * 300 * Q.parts;
    const rolls = P.getRolls();
    while (dustAcc >= 1) {
      dustAcc -= 1;
      const top = rng() < 0.5, r = top ? rolls.top : rolls.bottom;
      const p = new THREE.Vector3(rnd(-0.15, 0.15), r.center.y + (top ? -1 : 1) * r.radius * rnd(0.2, 0.9), r.center.z + r.radius * rnd(0.3, 1.0));
      rig.localToWorld(p);
      const v = new THREE.Vector3(rnd(-0.012, 0.012), (top ? 1 : -1) * rnd(0.0, 0.02), rnd(0.012, 0.05)).transformDirection(rig.matrixWorld).multiplyScalar(rnd(0.02, 0.06));
      v.y += rnd(0.004, 0.02);
      const k = rnd(1.3, 3.2);
      sparks.spawn(p, v, { color: [1.0 * k, 0.76 * k, 0.4 * k], life: rnd(1.4, 3.2), drag: 1.1, grav: 0.004, size: rnd(0.0009, 0.0024), twinkle: 0.7 });
    }
  }
  function puffDust() {
    if (reduced) return;
    const n = Math.round(90 * Q.parts);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(rnd(-0.15, 0.15), rnd(-0.015, 0.015), rnd(0.01, 0.03)); rig.localToWorld(p);
      const v = new THREE.Vector3(rnd(-0.6, 0.6), rnd(-1, 1), rnd(0.4, 1.2)).normalize().transformDirection(rig.matrixWorld).multiplyScalar(rnd(0.03, 0.12));
      const k = rnd(1.2, 2.8);
      sparks.spawn(p, v, { color: [1.0 * k, 0.78 * k, 0.45 * k], life: rnd(1.2, 2.6), drag: 1.6, grav: 0.006, size: rnd(0.0008, 0.002), twinkle: 0.6 });
    }
  }
  // y (mundo) del borde superior del cuadro a la profundidad z (plano z = const) con la cámara actual
  const _ray = new THREE.Vector3();
  function frameTopY(z) {
    _ray.set(0, 1, 0.5).unproject(camera).sub(camera.position).normalize();
    if (Math.abs(_ray.z) < 1e-4) return camera.position.y + 0.3;
    return camera.position.y + _ray.y * Math.max(0, (z - camera.position.z) / _ray.z);
  }
  function glitterRain(n) {
    if (reduced) return;
    const wx = aspect < 0.85 ? 0.22 : 0.4;
    for (let i = 0; i < n; i++) {
      const z = rnd(-0.05, 0.25);
      const p = new THREE.Vector3(rnd(-wx, wx), frameTopY(z) - rnd(0, 0.06), z);
      const k = rnd(1.2, 3.0);
      sparks.spawn(p, new THREE.Vector3(rnd(-0.004, 0.004), -rnd(0.02, 0.045), rnd(-0.004, 0.004)), { color: [1.0 * k, 0.8 * k, 0.48 * k], life: rnd(3, 6), drag: 0.2, grav: 0, size: rnd(0.0008, 0.0018), twinkle: 0.85 });
    }
  }
  let petalCursor = 0;
  function spawnPetal(burst) {
    if (reduced) return;
    let p = petals.find((x) => x.state === 0);
    if (!p) { // recicla el más antiguo que ya reposa en la mesa
      let best = null; for (const x of petals) if (x.state === 2 && (!best || x.landT > best.landT)) best = x;
      if (!best) return; best.state = 3; return;
    }
    const portrait = aspect < 0.85, wx = portrait ? 0.2 : 0.36;
    let front = rng() < 0.62;
    let x = rnd(-wx, wx);
    // ESCENA: con el pergamino abierto, los pétalos de delante caen SOLO a los lados de la columna de texto (nunca encima)
    if (front && cleanAmt > 0.01) {
      const c0 = TA.center[0] - TA.width / 2 - 0.07, c1 = TA.center[0] + TA.width / 2 + 0.07;
      const lw = Math.max(0, Math.min(c0, wx) + wx), rw = Math.max(0, wx - Math.max(c1, -wx));
      if (lw + rw < 0.03) front = false;
      else { const r = rng() * (lw + rw); x = r < lw ? -wx + r : Math.max(c1, -wx) + (r - lw); }
    }
    const z = front ? rnd(0.04, 0.17) : rnd(-0.22, -0.05);
    p.p.set(x, frameTopY(z) + (burst ? rnd(-0.012, 0.03) : rnd(0.01, 0.07)), z);
    p.v.set(0, burst ? -rnd(0.06, 0.08) : -rnd(0.02, 0.05), 0);
    p.q.setFromEuler(new THREE.Euler(rng() * 6.28, rng() * 6.28, rng() * 6.28));
    p.ax.set(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    p.w = rnd(1.2, 3.2) * (rng() < 0.5 ? -1 : 1); p.s = rnd(0.026, 0.036); p.age = 0; p.ph = rng() * 6.28;
    p.f1 = rnd(1.6, 2.6); p.f2 = rnd(0.9, 1.6); p.f3 = rnd(0.7, 1.3); p.vt = rnd(0.055, 0.09); p.wind = rnd(-0.012, 0.018); p.state = 1; p.fade = 1; p.landT = 0; p.quick = false;
    petalCursor++;
  }
  function updatePetals(dt) {
    let any = false;
    _inv.copy(rig.matrixWorld).invert();
    for (const p of petals) {
      if (p.state === 0) continue;
      any = true;
      if (p.state === 1) {
        p.age += dt;
        const fl = Math.sin(p.age * p.f1 + p.ph);
        p.v.y += (-p.vt * (0.75 + 0.5 * fl * fl) - p.v.y) * clamp(dt * 2.2);
        p.v.x += (p.wind + Math.sin(p.age * p.f2 + p.ph * 1.7) * 0.05 - p.v.x) * clamp(dt * 1.5);
        p.v.z += (Math.cos(p.age * p.f3 + p.ph) * 0.03 - p.v.z) * clamp(dt * 1.5);
        p.p.addScaledVector(p.v, dt);
        p.q.multiply(_qa.setFromAxisAngle(p.ax, p.w * dt * (0.55 + 0.6 * Math.abs(fl))));
        // no atraviesa la hoja levantada
        if (!capsuleOn()) {
          _l.copy(p.p).applyMatrix4(_inv);
          if (Math.abs(_l.x) < 0.17 && Math.abs(_l.y) < OPEN_HALF_H && _l.z > -0.014 && _l.z < 0.032) {
            _l.z = _l.z > 0.009 ? 0.032 : -0.014; p.p.copy(_l).applyMatrix4(rig.matrixWorld); p.v.z *= -0.2;
          }
          // ESCENA: un pétalo de delante que el viento acerca a la columna de texto (en pantalla) se desvanece
          if (cleanAmt > 0.5 && _l.z > 0.004) {
            _v.copy(p.p).project(camera); const N = cleanU.uCleanNdc.value, mg = 0.05 + p.s * 2.2;
            if (_v.z < 1 && _v.x > N.x - mg && _v.x < N.z + mg && _v.y > N.y - mg && _v.y < N.w + mg) { p.state = 3; p.quick = true; }
          }
        }
        if (p.p.y <= 0.0016) {
          p.p.y = 0.0016; p.state = 2; p.landT = 0;
          const zW = _v.set(0, 0, 1).applyQuaternion(p.q); const up = zW.y >= 0 ? UP : _v2.set(0, -1, 0);
          p.qT.setFromUnitVectors(zW, up).multiply(p.q);
        }
      } else if (p.state === 2) {
        p.landT += dt; p.q.slerp(p.qT, clamp(dt * 6));
      } else if (p.state === 3) {
        p.fade -= dt * (p.quick ? 7 : 2); if (p.fade <= 0) { p.state = 0; p.fade = 1; p.quick = false; petalSets[p.set].mesh.setMatrixAt(p.slot, _zero); petalSets[p.set].mesh.instanceMatrix.needsUpdate = true; continue; }
      }
      _m4.compose(p.p, p.q, _v.setScalar(p.s * (p.state === 3 ? p.fade : 1)));
      petalSets[p.set].mesh.setMatrixAt(p.slot, _m4);
      petalSets[p.set].mesh.instanceMatrix.needsUpdate = true;
    }
    return any;
  }

  // ───────── la apertura (línea de tiempo determinista, avanzada por el bucle)
  const qFrom = new THREE.Quaternion(), pFrom = new THREE.Vector3();
  function newSeq() { return { t: 0, rate: 1, fired: {}, liftT: -1, unrollT: -1, unrollAt: null, writeT: -1, petalAt: null, doneT: -1, flashT: -1, resolve: null, promise: null }; }
  // ── sincronía con la canción (si suena): el lacre se quiebra en un pulso (la secuencia previa se estira/encoge ≤ 25 %) y el
  // desenrollado y la lluvia de pétalos esperan como mucho ~0.7 s al siguiente pulso. Sin canción (o en seek) no cambia nada.
  function songOn() { try { return !silent && !reduced && !!music?.playing; } catch { return false; } }
  function beatWait(max = 0.7) {
    if (!songOn() || typeof music.getBeatPhase !== 'function') return 0;
    try { const w = music.getBeatPhase()?.toNext; return Number.isFinite(w) && w > 0.03 && w <= max ? w : 0; } catch { return 0; }
  }
  function rateToBeat(base) {
    if (!songOn()) return 1;
    try {
      const a = music.analysis, beats = a?.beats, now = music.currentTime;
      if (!Array.isArray(beats) || !Number.isFinite(now)) return 1;
      const ph = Number.isFinite(a.downbeatPhase) ? a.downbeatPhase : 0;
      let best = null;
      for (let i = 0; i < beats.length; i++) {
        const d = beats[i] - now;
        if (d < base / 1.3 || d > base / 0.78) continue;
        const sc = Math.abs(d - base) - ((((i - ph) % 4) + 4) % 4 === 0 ? 0.25 : 0);
        if (!best || sc < best.sc) best = { sc, d };
      }
      return best ? base / best.d : 1;
    } catch { return 1; }
  }
  function fire(name) { if (seq.fired[name]) return false; seq.fired[name] = true; return true; }
  function startSequence() {
    seq = newSeq();
    seq.rate = rateToBeat(TL.brk);
    seq.promise = new Promise((res) => (seq.resolve = res));
    opening = true; phase = 'approach';
    return seq.promise;
  }
  function rigPoseAfterLift(lt) {
    const k = clamp(lt / TL.liftDur);
    const kp = easeInOutCubic(k), kr = easeInOutCubic(clamp((k - 0.14) / 0.86));
    rig.position.lerpVectors(pFrom, openPos, kp);
    rig.position.y += Math.sin(Math.PI * kp) * 0.025;
    rig.quaternion.slerpQuaternions(qFrom, qOpen, kr);
    // asentamiento con peso (pequeño cabeceo amortiguado) + vaivén sutil en reposo
    const d = TL.liftDur;
    const wob = reduced ? 0 : 0.03 * sstep(d * 0.72, d, lt) * Math.exp(-Math.max(0, lt - d) * 2.6) * Math.sin((lt - d * 0.72) * 7.5);
    const sw = reduced ? 0 : sstep(d, d + 2.5, lt) * (1 - 0.75 * readK); // ESCENA: casi quieta mientras se lee
    const swayY = sw * (Math.sin(lt * 0.52) * 0.016 + Math.sin(lt * 0.23 + 1) * 0.008);
    const swayX = wob + sw * Math.sin(lt * 0.41 + 0.6) * 0.007;
    if (swayX || swayY) rig.quaternion.multiply(_q.setFromEuler(new THREE.Euler(swayX, swayY, sw * Math.sin(lt * 0.33) * 0.004)));
    rig.position.y += sw * Math.sin(lt * 0.7) * 0.0018;
  }
  function stepUnroll(dt, ut) {
    // muelle con inercia que persigue una consigna suave y choca con el tope (rebota apenas y se asienta)
    const u0 = uState.u;
    if (typeof PARCH.unrollEase === 'function') {
      uState.u = PARCH.unrollEase(clamp(ut / TL.unrollDur)); P.setUnroll(uState.u);
      return uState.u - u0;
    }
    const g = 1.065 * easeInOutSine(ut / TL.unrollDur);
    const kS = reduced ? 140 : 62, cS = 2 * Math.sqrt(kS) * 0.62;
    const n = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / n;
    for (let i = 0; i < n; i++) {
      uState.v += (kS * (g - uState.u) - cS * uState.v) * h;
      uState.u += uState.v * h;
      if (uState.u > 1) { uState.u = 1; if (uState.v > 0) uState.v = -uState.v * 0.22; }
      if (uState.u < 0) { uState.u = 0; uState.v = 0; }
    }
    P.setUnroll(uState.u);
    return uState.u - u0;
  }
  // ESCENA · ritmo = max(tiempo, scroll): la velocidad es 1× (tiempo real) o más si el scroll va por delante, con tope.
  // rate = 1 + retraso / tau (retraso en s naturales). Los objetivos salen de scrollMax (nunca retrocede).
  const SEC = P.writing?.seconds || 21.9;
  const paceRate = (lag, cap) => clamp(1 + Math.max(0, lag) / PACE.tau, 1, cap);
  const openTarget = () => (!hasScroll ? 0 : scrollMax >= PACE.sOpen ? 1e9 : (scrollMax / PACE.sOpen) * PACE.openEst);
  const writeTarget = () => (!hasScroll ? 0 : clamp((scrollMax - PACE.sOpen) / (PACE.sWrite - PACE.sOpen)) * SEC);
  const holdDur = () => (reduced ? 0.45 : READ_HOLD), backDur = () => (reduced ? 0.6 : BACK_DUR);
  const backTarget = () => (!hasScroll ? 0 : clamp((scrollMax - PACE.sWrite) / (PACE.sBack - PACE.sWrite)) * (holdDur() + backDur()));
  /** dt = s de secuencia (acelerados en la apertura) · dtR = s reales (la escritura y el alejamiento llevan su propio ritmo). */
  function updateSequence(dt, dtR = dt) {
    const t = (seq.t += dt * (seq.fired.brk ? 1 : seq.rate));
    // grietas que brillan sobre el sello entero
    if (t >= TL.crack && seq.fired.brk !== true) {
      phase = 'crack';
      const tc = t - TL.crack, grow = clamp(tc / TL.crackDur);
      setCrack(0.35 + 0.65 * grow);
      for (const m of crackMeshes) {
        const gk = clamp((tc - m.userData.delay * (TL.crackDur / 0.45)) / (TL.crackDur - m.userData.delay * (TL.crackDur / 0.45)));
        m.geometry.setDrawRange(0, Math.floor((m.userData.full * gk) / 3) * 3);
      }
      lacreMats.forEach((m) => (m.emissiveIntensity = 0.25 * grow));
    }
    if (t >= TL.crack + 0.12 && fire('crackSfx')) { sfx('sealCrack'); duck(0.5, 1.4); }
    if (t >= TL.brk && fire('brk')) { phase = 'break'; breakSeal(); }
    if (seq.fired.brk) {
      const tf = t - TL.brk;
      setCrack(Math.max(0, 1 - tf / 0.1));
      interiorMats.forEach((m) => (m.emissiveIntensity = 0.75 * Math.exp(-tf * 4.2)));
      lacreMats.forEach((m) => (m.emissiveIntensity = 0.25 * Math.exp(-tf * 6)));
      flash.intensity = 0.0035 * Math.exp(-tf * 6.5) * (tf < 0.04 ? tf / 0.04 : 1);
      if (tf > 0.35 && sealHolder.visible) sealHolder.visible = false; // los fragmentos ya viven en la escena
    }
    // el lazo se desata
    if (t >= TL.untie && fire('untie')) { phase = 'untie'; rb.untie({ duration: TL.untieDur }); }
    if (t >= TL.untie + 0.25 * (TL.untieDur / 2.2) && fire('swish')) sfx('ribbonSwish');
    // el pergamino se eleva y se pone de frente (cuando la cinta ya soltó)
    if (seq.liftT < 0 && t >= TL.liftMin && (rb.state !== 'untying' || t >= TL.liftMin + TL.liftWait)) {
      seq.liftT = t; phase = 'lift';
      rig.updateMatrixWorld(true);
      rb.detach(scene);
      pFrom.copy(rig.position); qFrom.copy(rig.quaternion);
      sfx('whoosh');
    }
    const hurry = pace.mul > 1.3; // (navegando rápido no se espera al pulso de la canción)
    if (seq.liftT >= 0) {
      const lt = t - seq.liftT;
      rigPoseAfterLift(lt);
      if (lt >= TL.unrollDelay && seq.unrollAt == null) seq.unrollAt = t + (hurry ? 0 : beatWait(0.6));
      if (seq.unrollAt != null && t >= seq.unrollAt && seq.unrollT < 0) {
        seq.unrollT = t; phase = 'unroll';
        sfx('paperUnroll', (TL.unrollDur * 0.92) / Math.max(1, pace.mul));
        puffDust();
      }
    }
    if (seq.unrollT >= 0) {
      const ut = t - seq.unrollT;
      const du = stepUnroll(dt, ut);
      emitRollDust(du);
      if (P.uniforms?.pEdgeWave && U0.edge != null) P.uniforms.pEdgeWave.value = U0.edge * (1 + 2.2 * Math.exp(-Math.max(0, ut - TL.unrollDur * 0.6) * 1.6) * sstep(0, 0.4, ut));
      if (ut >= TL.writeDelay && seq.writeT < 0) {
        seq.writeT = t; phase = 'write'; pace.gate = 0;
        if (reduced) { pace.wNat = SEC; textFade = 0; P.setTextOpacity?.(0); }
      }
    }
    if (seq.writeT >= 0) {
      // ── la escritura: reloj propio en s naturales (P.writing.seconds), max(tiempo, scroll) con tope
      if (reduced) {
        // prefers-reduced-motion: todo escrito de una vez y un fundido corto
        textFade = Math.min(1, textFade + dtR / 0.55); P.setTextOpacity?.(textFade);
      } else if (pace.wNat < SEC) {
        pace.gate += dtR;
        // con pluma visible: la escritura espera (≤ 2.5 s) a que la pluma esté suspendida sobre el primer trazo
        const waitQuill = pace.wNat <= 0 && quill && !quill.ready && pace.gate < 2.5;
        if (!waitQuill) {
          const lagW = writeTarget() - pace.wNat;
          let cap = PACE.writeCap;
          if (quill && lagW < 1.5) { try { const qc = quill.rateCap?.(pace.wt); if (Number.isFinite(qc)) cap = Math.min(cap, Math.max(1, qc)); } catch { /* */ } }
          pace.wRate = paceRate(lagW, cap);
          pace.wRateS = damp(pace.wRateS, pace.wRate, pace.wRate > pace.wRateS ? 5 : 2.5, dtR);
          pace.wNat = Math.min(SEC, pace.wNat + dtR * pace.wRateS);
        }
      }
      pace.wt = clamp(pace.wNat / SEC);
      try { P.setWriting?.(pace.wt); } catch { /* */ }
      // barrido de luz sobre el oro que acompaña a la pluma
      const sw = clamp((pace.wt - 0.01) / 0.98);
      if (P.uniforms?.pSweepGain) P.uniforms.pSweepGain.value = (U0.gain ?? 1.25) * 0.75;
      P.setLightSweep(!reduced && sw > 0 && sw < 1 ? lerp(-1.25, 1.3, sw) : -9);
      // chime cuando la pluma empieza a dorar los nombres
      let gild = false; try { gild = !!P.getPen?.()?.gilding; } catch { /* */ }
      if ((gild || (reduced && textFade > 0.5)) && fire('chime')) sfx('chime');
      // ── todo escrito: pausa breve y la cámara se aleja (encuadre final legible); CTAs al 55 % del alejamiento
      if (pace.wNat >= SEC) {
        if (pace.back < 0) { pace.back = 0; phase = 'read'; }
        const rB = reduced ? 1 : paceRate(backTarget() - pace.back, PACE.backCap);
        pace.backRate = rB;
        pace.back += dtR * rB;
        if (pace.back >= holdDur() && fire('pull')) {
          phase = 'final';
          if (P.uniforms?.pSweepGain) P.uniforms.pSweepGain.value = U0.gain ?? 1.25;
          // pétalos y brillo: ahora, a los lados de la columna (nunca delante del texto)
          if (!reduced) { seq.petalBurst = 0; seq.petalAcc = 1.5; sfx('sparkle'); glitterRain(Math.round(90 * Q.parts)); }
        }
        if (pace.back >= holdDur() + backDur() * 0.55 && !pace.ctaShown) {
          pace.ctaShown = true;
          try { onOpenedCb(); } catch (e) { console.warn('[scroll3d] onOpened:', e); }
        }
        if (pace.back >= holdDur() + backDur() && fire('done')) finishOpen();
      }
      if (seq.petalBurst != null && seq.petalBurst < 30) {
        seq.petalAcc = (seq.petalAcc || 0) + dtR * 12;
        while (seq.petalAcc >= 1 && seq.petalBurst < Math.round(30 * Math.max(0.5, Q.parts))) { seq.petalAcc -= 1; seq.petalBurst++; spawnPetal(true); }
      }
    }
  }
  function finishOpen() {
    phase = 'open'; opened = true; opening = false;
    openClock = 0; nextSweep = 4.5; nextDrizzle = 1.2;
    if (P.uniforms?.pSweepGain) P.uniforms.pSweepGain.value = U0.gain ?? 1.25;
    P.setLightSweep(-9);
    try { P.setWriting?.(1); P.setTextOpacity?.(1); } catch { /* */ }
    pace.wNat = SEC; pace.wt = 1; textFade = 1;
    const r = seq.resolve; seq.resolve = null;
    if (!pace.ctaShown) { pace.ctaShown = true; try { onOpenedCb(); } catch (e) { console.warn('[scroll3d] onOpened:', e); } }
    r?.();
  }
  function updateOpenIdle(dt) {
    openClock += dt;
    if (seq?.liftT >= 0) { seq.t += dt; rigPoseAfterLift(seq.t - seq.liftT); }
    if (seq?.petalBurst != null && seq.petalBurst < 30) { seq.petalAcc = (seq.petalAcc || 0) + dt * 12; while (seq.petalAcc >= 1 && seq.petalBurst < Math.round(30 * Math.max(0.5, Q.parts))) { seq.petalAcc -= 1; seq.petalBurst++; spawnPetal(true); } }
    // barrido de luz cada ~7 s
    if (!reduced && openClock >= nextSweep && sweepT < 0) { sweepT = 0; nextSweep = openClock + 7 + rng() * 2; }
    if (sweepT >= 0) {
      sweepT += dt; const s = sweepT / sweepDur;
      P.setLightSweep(s < 1 ? lerp(-1.3, 1.3, easeInOutSine(s)) : -9);
      if (s >= 1) sweepT = -1;
    }
    // llovizna suave de pétalos (a los lados) y brillos
    if (!reduced && openClock >= nextDrizzle) { nextDrizzle = openClock + rnd(1.3, 2.4) / Math.max(0.4, Q.parts); spawnPetal(false); glitterRain(Math.round(6 * Q.parts)); }
  }

  // ───────── cámara
  // ESCENA · pose de lectura: la columna de texto renglón a renglón (getFocus del renglón en curso, ~42 % desde arriba del
  // cuadro, sujeta a los bordes de la columna). Altura visible: escritorio ≈ 0.235 m (altura-x ≈ 25 px a 900 px de alto),
  // móvil vertical = la columna al 92 % del ancho; nunca más cerca que READ_XH_MAX. Navegando rápido el plano se abre hacia el
  // encuadre final (menos movimiento). Sigue al rig (el vaivén queda quieto respecto del texto).
  const READ_DIR = dirFrom(OPEN_TILT + 0.02, 0.05);
  function readGoal(out, rate) {
    const portrait = aspect < 0.85;
    const fovT = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let hv = portrait ? (TA.width / 0.92) / aspect : Math.max(0.235, (TA.width + 0.05) / aspect);
    hv = Math.max(hv, (XH * H) / READ_XH_MAX);
    const hvF = 2 * fovT * poses.final.dist;
    hv = lerp(hv, Math.max(hv, hvF), clamp((rate - 1.3) / 4) * 0.75);
    const y0 = TA.center[1] - TA.height / 2 - 0.012, y1 = TA.center[1] + TA.height / 2 + 0.02;
    // (sin getFocus — parchment.js antiguo — recorre la columna de arriba abajo con el progreso)
    const f = typeof P.getFocus === 'function' ? P.getFocus(pace.wt) : null;
    const lineY = f ? (f.y0 + f.y1) / 2 : lerp(y1 - 0.03, y0 + 0.03, pace.wt);
    let yc = lineY - 0.08 * hv;
    yc = y1 - y0 <= hv ? (y0 + y1) / 2 : clamp(yc, y0 + hv / 2, y1 - hv / 2);
    // en horizontal: la hoja tan centrada como permita la columna completa (con margen); en vertical, la columna centrada
    const halfW = (hv * aspect) / 2, cL = TA.center[0] - TA.width / 2 - 0.012, cR = TA.center[0] + TA.width / 2 + 0.012;
    const xc = cR - cL >= 2 * halfW ? TA.center[0] : clamp(0.02, cR - halfW, cL + halfW);
    out.tgt.set(xc, yc, 0.002); rig.localToWorld(out.tgt);
    out.dist = (hv / 2) / fovT;
    out.pos.copy(out.tgt).addScaledVector(READ_DIR, out.dist);
    out.focus.copy(out.tgt);
    out.pxPerM = H / hv;
    return out;
  }
  function updateCamera(dt, dts = dt) {
    let goal = 'closed', st = 0.6, sdt = dts;
    const lifted = opened || (seq && seq.liftT >= 0);
    if (reduced) goal = lifted ? 'final' : 'closed';      // prefers-reduced-motion: sin viaje de cámara (cortes)
    else if (soft) { goal = lifted ? 'final' : 'closed'; st = 1.6; sdt = dt; } // COMPAT-FLUIDEZ · modo suave: un acercamiento lento
    else if (opened || (seq && pace.back >= holdDur())) { goal = 'final'; st = 1.15 / Math.max(1, pace.backRate || 1); sdt = dt; }
    else if (seq && seq.writeT >= 0) { goal = 'read'; st = pace.wNat < 1.2 && seq.t - seq.writeT < 1.6 ? 0.95 : 0.62; sdt = dt; }
    else if (lifted) { goal = quill ? 'wide' : 'open'; st = TL.camOpen; }
    else if (opening) { if (seq.t < TL.brk + 0.55) { goal = 'seal'; st = TL.camSeal; } else { goal = 'medium'; st = TL.camMedium; } }
    let P0 = poses[goal];
    if (goal === 'read') {
      P0 = readGoal(poses.read, pace.wRateS);
      // con pluma visible: durante el despegue, los remojos y el regreso el plano se abre para ver el tintero
      if (wideK > 0.001) { P0.pos.lerp(poses.wide.pos, wideK); P0.tgt.lerp(poses.wide.tgt, wideK); P0.focus.lerp(poses.wide.focus, wideK); }
    }
    if (reduced) {
      if (cam.goal !== goal) { cam.goal = goal; cam.pos.copy(P0.pos); cam.tgt.copy(P0.tgt); cam.vp.set(0, 0, 0); cam.vt.set(0, 0, 0); camCut++; }
    } else {
      cam.goal = goal;
      smoothDampV(cam.pos, P0.pos, cam.vp, st, sdt);
      smoothDampV(cam.tgt, P0.tgt, cam.vt, st, sdt);
    }
    // foco (DOF): distancia al punto de interés
    const fd = cam.pos.distanceTo(goal === 'open' || goal === 'wide' ? (rig.getWorldPosition(_v), _v) : P0.focus);
    cam.focus = damp(cam.focus, fd, 6, dt);
    // respiración de cámara + parallax del puntero/giroscopio (casi quietos mientras se lee)
    const calm = 1 - 0.8 * readK;
    const breath = reduced ? 0 : (goal === 'seal' ? 0.35 : 1) * calm * (soft ? 0.35 : 1);
    pointer.sx = damp(pointer.sx, pointer.inside ? pointer.x : 0, 3, dt);
    pointer.sy = damp(pointer.sy, pointer.inside ? pointer.y : 0, 3, dt);
    const dist = cam.pos.distanceTo(cam.tgt);
    camera.position.copy(cam.pos);
    camera.position.x += breath * (Math.sin(time * 0.37) * 0.0045 + Math.sin(time * 0.71 + 1.1) * 0.0015) * dist;
    camera.position.y += breath * Math.sin(time * 0.29 + 0.7) * 0.004 * dist;
    camera.position.z += breath * Math.sin(time * 0.23 + 2.1) * 0.003 * dist;
    if (!reduced && !soft) {
      const par = 1 - 0.7 * readK;
      _v.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(pointer.sx * dist * 0.035 * par);
      _v2.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(pointer.sy * dist * 0.022 * par);
      camera.position.add(_v).add(_v2);
    }
    camera.lookAt(cam.tgt);
  }
  // ESCENA · columna de texto proyectada en pantalla (NDC y UV) para la zona limpia del posproceso, polvo, chispas y pétalos
  const _cc = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  function updateCleanRect() {
    if (cleanAmt < 0.001) { cleanU.uCleanAmt.value = 0; return; }
    camera.updateMatrixWorld();
    let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
    const hx = TA.width / 2 + 0.006, hy = TA.height / 2 + 0.008;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
      const p = _cc[i].set(TA.center[0] + sx * hx, TA.center[1] + sy * hy, 0.002);
      P.group.localToWorld(p); p.project(camera);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    cleanU.uCleanNdc.value.set(x0, y0, x1, y1);
    cleanU.uCleanAmt.value = cleanAmt;
  }
  // AJUSTES (9.4, "desde lejos no se ve"): tinta con más cuerpo cuando el renglón tiene pocos píxeles REALES (vista completa en
  // móvil a DPR 1: el trazo fino filtrado se agrisaba a 8:1); con ≥ 15 px de altura-x (lectura de cerca) queda como estaba
  const _xa = new THREE.Vector3(), _xb = new THREE.Vector3();
  function updateInkBold() {
    const u = P.uniforms?.pInkBold; if (!u) return;
    _xa.set(TA.center[0], TA.center[1], 0.0004); _xb.set(TA.center[0], TA.center[1] + XH, 0.0004);
    P.group.localToWorld(_xa); P.group.localToWorld(_xb); _xa.project(camera); _xb.project(camera);
    const xhDev = Math.abs(_xb.y - _xa.y) * H / 2 * dpr;
    const b = clamp(1.7 + (15 - xhDev) * 0.2, 1.7, 2.9);
    u.value += (b - u.value) * 0.25;
  }

  // ───────── un paso de simulación
  const _rp = new THREE.Vector3();
  let rimK = 0.22;
  function step(dt) {
    time += dt;
    // vela que titila
    const fl = 1 + (Math.sin(time * 11.3) * 0.5 + Math.sin(time * 17.9 + 1.7) * 0.3 + Math.sin(time * 6.1 + 0.4) * 0.6 + Math.sin(time * 29.3 + 2.1) * 0.15) * 0.035
      - Math.pow(Math.max(0, Math.sin(time * 0.77 + 1.3) * Math.sin(time * 1.93)), 2) * 0.1;
    // la vela y el polvo respiran con la canción (±12 %; ataque 0.1 s, caída 0.6 s): los clímax se notan, sin exagerar
    let eT = 0;
    if (!reduced && !silent) { try { if (music?.playing && music.getEnergy) { const e = music.getEnergy(); eT = clamp(e.low * 0.6 + e.rms * 0.4); } } catch { /* */ } }
    songE += (eT - songE) * (1 - Math.exp(-dt / (eT > songE ? 0.1 : 0.6)));
    const eMul = 0.9 + 0.24 * songE;
    key.intensity = KEY_I * lerp(1, KEY_READ_I, readK) * (1 + (fl - 1) * 0.75 * (1 - 0.6 * readK)) * eMul;
    key.position.lerpVectors(KEY_POS, KEY_READ_POS, readK);
    readLight.intensity = READ_I * readK * (1 + (fl - 1) * 0.15);
    candleLight.intensity = CANDLE_I * fl * eMul;
    dustMat.uniforms.uAmt.value = (reduced ? 0.5 : 1) * (0.85 + 0.35 * songE);
    flameMat.uniforms.uTime.value = time; flameMat.uniforms.uFlick.value = fl;
    glow.material.opacity = 0.75 + (fl - 1) * 2;
    const fl2 = 1 + (Math.sin(time * 12.7 + 2.3) * 0.5 + Math.sin(time * 19.1 + 0.4) * 0.3 + Math.sin(time * 5.3 + 1.9) * 0.6) * 0.035;
    flameMat2.uniforms.uTime.value = time + 17.3; flameMat2.uniforms.uFlick.value = fl2; glow2.material.opacity = 0.5 + (fl2 - 1) * 1.6;
    flame2.rotation.y = Math.atan2(camera.position.x - flamePos2.x, camera.position.z - flamePos2.z);
    waxMat.emissiveIntensity = 1.3 * fl;
    flame.rotation.y = Math.atan2(camera.position.x - flamePos.x, camera.position.z - flamePos.z);
    dustMat.uniforms.uTime.value = time; dustMat.uniforms.uFlick.value = fl;
    for (const b of bokeh) b.material.color.copy(b.userData.k).multiplyScalar(0.7 + 0.3 * Math.sin(time * 0.45 + b.userData.ph) + (fl - 1) * 1.5);
    beatPulse *= Math.exp(-dt * 4.5);

    // el foco de la vela sigue al pergamino
    rig.getWorldPosition(_rp);
    key.target.position.lerp(_rp.setY(_rp.y * 0.92), clamp(dt * 3));
    key.target.updateMatrixWorld();
    rim.target.position.copy(key.target.position); rim.target.updateMatrixWorld();
    readLight.target.position.copy(key.target.position); readLight.target.updateMatrixWorld();
    // el contraluz frío sólo cobra fuerza con el pergamino levantado (tumbado solo producía reflejos azules en la mesa)
    rimK = damp(rimK, (opened || (seq && seq.liftT >= 0)) ? 1 : 0.22, 1.5, dt);
    rim.intensity = 1.15 * rimK;
    dustMat.uniforms.uSpotPos.value.copy(key.position);
    dustMat.uniforms.uSpotDir.value.copy(key.target.position).sub(key.position).normalize();

    // halo del sello (idle: respira; hover: brilla; acercamiento: crece)
    hoverGlow = damp(hoverGlow, hovered ? 1 : 0, 8, dt);
    let auraGoal = 0;
    if (!opening && !opened) auraGoal = (coarse ? 0.42 : 0.3) + 0.12 * Math.sin(time * 1.6) + hoverGlow * 0.5 + beatPulse * 0.25;
    else if (opening && seq && !seq.fired.brk) auraGoal = 0.3 + 0.18 * clamp(seq.t / TL.brk);
    auraI = damp(auraI, auraGoal, opening && seq?.fired.brk ? 20 : 5, dt);
    auraMat.uniforms.uI.value = auraI * (reduced ? 0.6 : 1); auraMat.uniforms.uTime.value = time;
    aura.visible = auraI > 0.004;
    if (!opening && !opened) lacreMats.forEach((m) => (m.emissiveIntensity = 0.035 + hoverGlow * 0.12 + beatPulse * 0.04));
    goldGlow.value = !opening && !opened ? 0.34 + hoverGlow * 0.16 + beatPulse * 0.2 : damp(goldGlow.value, 0, 6, dt);
    // chispitas que invitan a tocar el sello
    if (!opening && !opened && !reduced && Q.parts >= 0.5) {
      idleSparkT += dt;
      if (idleSparkT > 0.75) {
        idleSparkT = 0;
        const a = rng() * Math.PI * 2, p = new THREE.Vector3(Math.cos(a) * 0.019, Math.sin(a) * 0.019, 0.004); sealHolder.localToWorld(p);
        const k = rnd(1.2, 2.4);
        sparks.spawn(p, new THREE.Vector3(rnd(-0.003, 0.003), rnd(0.006, 0.014), rnd(-0.003, 0.003)), { color: [1.0 * k, 0.78 * k, 0.42 * k], life: rnd(1.2, 2.0), drag: 0.5, grav: 0, size: rnd(0.0006, 0.0011), twinkle: 0.6 });
      }
    }

    // ESCENA · ritmo de la apertura (antes de escribir): acelera si el scroll va por delante (tope PACE.openCap)
    let dts = dt;
    if (opening && seq && !reduced && seq.writeT < 0) { pace.mul = damp(pace.mul, paceRate(openTarget() - seq.t, PACE.openCap), 3, dt); dts = dt * pace.mul; }
    else pace.mul = 1;
    if (opening && seq) updateSequence(dts, dt);
    else if (opened) updateOpenIdle(dt);

    // ESCENA · lectura: luz pareja y zona limpia (suben al elevarse/desenrollarse el pergamino)
    readK = damp(readK, opened || (seq && seq.liftT >= 0) ? 1 : 0, 1.4, dt);
    cleanAmt = damp(cleanAmt, opened || (seq && seq.unrollT >= 0) ? 1 : 0, 2.5, dt);
    if (quill && !reduced) {
      const m = quill.mode;
      const want = opening && seq && seq.writeT >= 0 && pace.wNat < SEC && pace.wRateS < 2.6 && ((quill.dipping || 0) > 0 || m === 'takeoff' || m === 'return') ? 1 : 0;
      wideK = damp(wideK, want, want ? 2.4 : 1.6, dt);
    } else wideK = 0;

    rig.updateMatrixWorld(true);
    updateFragments(dts);
    sparks.update(dt, time);
    updatePetals(dt);

    // lazo: gravedad y mesa en coordenadas locales del pergamino
    if (!rb.detached) {
      _inv.copy(rig.matrixWorld).invert();
      env.gravityLocal.set(0, -9.81, 0).transformDirection(_inv).multiplyScalar(9.81);
      env.groundPlaneLocal.copy(tablePlane).applyMatrix4(_inv);
    }
    // (ribbon.js recorta dt a 1/15 s: con la apertura acelerada, en tramos)
    for (let r = dts, k = 0; r > 1e-6 && k < 6; r -= 1 / 20, k++) rb.update(Math.min(r, 1 / 20), time, env);
    P.update(time, dt);
    const rolls = P.getRolls();
    rodTop.position.copy(rolls.top.center); rodTop.rotation.x = rolls.top.angle;
    rodBot.position.copy(rolls.bottom.center); rodBot.rotation.x = rolls.bottom.angle;

    updateCamera(dt, dts);
    updateGrade(dt);
    updateCleanRect();
    updateInkBold();
    // ESCENA · pluma (js/pluma.js, attachQuill): después de mover el rig, setWriting y la cámara
    if (quill) {
      try { quill.update(dt, time, pace.wt, { phase: quillPhase(), camera, light: key, rate: pace.wRateS }); }
      catch (e) { console.warn('[scroll3d] pluma:', e?.message || e); detachQuill(); }
    }
  }
  function quillPhase() {
    if (!seq || (!opening && !opened)) return 'rest';
    if (opened) return 'done';
    if (seq.writeT >= 0) return pace.wNat < SEC ? 'write' : 'done';
    if (seq.unrollT >= 0) return 'ready';
    return 'rest';
  }
  function updateGrade(dt) {
    let sepia = 0.1, grain = 0.026, vig = 0.5, expo = 1, dofA = 0.85, bloom = 0.5;
    if (opening && seq) {
      const t = seq.t;
      const o = sstep(TL.crack - 0.5, TL.brk + 1.2, t);
      // ESCENA: al empezar a escribir la película antigua se retira (la columna además queda limpia en la composición)
      const w = seq.writeT >= 0 ? sstep(0, 1.6, t - seq.writeT) : seq.unrollT >= 0 ? 0.6 * sstep(0, TL.unrollDur, t - seq.unrollT) : 0;
      sepia = lerp(lerp(0.1, 0.34, o), 0.12, w);
      grain = lerp(lerp(0.026, 0.055, o), 0.024, w);
      vig = lerp(0.5, 0.62, o * (1 - w)) * lerp(1, 0.6, w); // AJUSTES: escrita la hoja, borde apenas tostado (todo crema)
      expo = 1 + o * (1 - w) * (Math.sin(time * 31) * 0.012 + Math.sin(time * 13.7) * 0.01);
      dofA = goalIsSeal() ? 1 : 0.8;
    } else if (opened) { sepia = 0.12; grain = 0.024; vig = 0.3; dofA = 0.75; bloom = 0.55; }
    if (reduced) { grain *= 0.6; expo = 1; }
    const k = clamp(dt * 2.5);
    grade.sepia = lerp(grade.sepia, sepia, k); grade.grain = lerp(grade.grain, grain, k); grade.vig = lerp(grade.vig, vig, k);
    grade.expo = expo; grade.dof = lerp(grade.dof, dofA, k); grade.bloom = lerp(grade.bloom, bloom, k);
    grade.fade = Math.min(1, grade.fade + dt / 0.9);
    focusK = lerp(focusK, (opened || (seq && seq.liftT >= 0)) ? 0.5 : 0.3, k);
  }
  const goalIsSeal = () => opening && seq && seq.t < TL.brk + 0.55;
  let focusK = 0.3;

  function renderFrame() {
    // PERF (L3/L4): las sombras solo se redibujan si algo que las proyecta se mueve (apertura, cinta cayendo)
    // ESCENA: durante la lectura (larga y casi quieta) basta 1 de cada 4 cuadros
    if (Q.lazySh) {
      const calm = opening && seq && seq.writeT >= 0 && seq.t - seq.writeT > 1.5;
      if ((opening && (!calm || (++shN & 3) === 0)) || (rb.state !== 'tied' && rb.state !== 'settled')) renderer.shadowMap.needsUpdate = true;
    }
    if (post && Q.post > 0) {
      const U = post.uniforms;
      U.uSepia.value = grade.sepia; U.uGrain.value = grade.grain; U.uVig.value = grade.vig; U.uExpo.value = grade.expo;
      U.uBloom.value = grade.bloom; U.uTime.value = time; U.uFade.value = 1; U.uWarm.value = grade.warm;
      U.uDof.value = Q.post >= 2 ? grade.dof : 0; U.uFocus.value = cam.focus; U.uFocusRange.value = Math.max(0.08, cam.focus * focusK);
      // ESCENA: la columna de texto sin DOF, bloom, sepia, viñeta ni grano (UV = NDC/2 + 0.5)
      const N = cleanU.uCleanNdc.value;
      U.uClean.value.set(N.x * 0.5 + 0.5, N.y * 0.5 + 0.5, N.z * 0.5 + 0.5, N.w * 0.5 + 0.5);
      U.uCleanFeather.value.set(0.035, 0.035 * aspect); U.uCleanAmt.value = cleanU.uCleanAmt.value;
      post.render(scene, camera, { dof: Q.post >= 2 });
      if (cssSepia) { canvas.style.filter = ''; cssSepia = 0; }
    } else {
      const sp = Math.round(grade.sepia * 0.9 * (1 - cleanU.uCleanAmt.value) * 50) / 50;
      if (sp !== cssSepia) { cssSepia = sp; canvas.style.filter = sp > 0 ? `sepia(${sp}) saturate(${(1 + sp * 0.4).toFixed(2)})` : ''; }
      const vo = (1 - 0.85 * cleanU.uCleanAmt.value).toFixed(2);
      if (vignetteEl.style.opacity !== vo) vignetteEl.style.opacity = vo;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }
  let cssSepia = 0, shN = 0;

  // ───────── bucle (solo cuando es visible)
  let raf = 0, lastT = 0;
  function loop(now) {
    raf = 0;
    if (disposed) return;
    if (!(active && inView && !document.hidden)) { lastT = 0; return; }
    raf = requestAnimationFrame(loop);
    // FIX: la apertura avanza con el tiempo REAL (antes dt se recortaba a 0.05 s y por debajo de 20 fps todo iba en cámara
    // lenta: a 2 fps la apertura duraba 20 veces más). La física da subpasos de ≤ 1/30 s; fps y adapt() usan el tiempo sin recortar.
    const raw = lastT ? Math.max(0.0005, (now - lastT) / 1000) : 1 / 60;
    lastT = now;
    const dt = Math.min(0.25, raw);
    if (!frozen) { const n = Math.min(4, Math.ceil(dt * 30 - 1e-6)); for (let i = 0; i < n; i++) step(dt / n); }
    // PERF-RETOMA: calidad antes de dibujar (applyQuality → setSize borra el lienzo: si fuera después, un cuadro vacío)
    adapt(raw);
    renderFrame();
  }
  // PERF: nada se dibuja hasta que el montaje y el calentamiento terminan (ready). Antes, si la sección entraba en pantalla
  // a mitad del montaje, el IntersectionObserver arrancaba el bucle y el primer renderFrame enlazaba todos los programas y
  // subía todas las texturas de golpe: la página se congelaba 2–2.7 s (también en escritorio).
  function wake() { if (ready && !raf && !disposed && active && inView && !document.hidden) { lastT = 0; fpsWin.warm = Math.max(fpsWin.warm, 1.2); raf = requestAnimationFrame(loop); } }
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { for (const e of es) inView = e.isIntersecting; wake(); }, { rootMargin: '120px' }) : null;
  io?.observe(container);
  const onVis = () => wake();
  document.addEventListener('visibilitychange', onVis);
  // (PERF-RETOMA: el ResizeObserver corre después de los rAF y antes de pintar: si el bucle está vivo se vuelve a dibujar ya,
  // si no el lienzo recién redimensionado se pintaba vacío un cuadro)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { applySize(); if (frozen || (ready && raf)) renderFrame(); }) : null;
  ro?.observe(container);
  const onWinResize = () => { applySize(); if (frozen) renderFrame(); };
  addEventListener('resize', onWinResize);

  // ───────── calentamiento: compila todos los programas antes de mostrar (sin tirones al abrir)
  // FIX: (1) las texturas se decodifican fuera del hilo y suben a la GPU de una en una, en ratos ociosos;
  // (2) se compilan las DOS variantes de cada programa: la del destino HDR del posproceso (lineal, sin tone mapping), que es
  // la que se usa, y la de pantalla (sRGB + ACES, niveles L3/L4). Antes solo se compilaba la de pantalla y el primer cuadro
  // recompilaba todo de forma síncrona (tarea de ~2.6 s mientras se veía la puerta);
  // (3) el primer cuadro (sombras incluidas) también en un rato ocioso.
  // PERF · compilación en tandas con mallas SUSTITUTAS (comparten geometría y material con las originales: mismas claves
  // de programa; three.compile() no filtra por visibilidad y un objeto no puede estar en dos escenas a la vez).
  const compiledVariants = new Set();
  let issueChain = Promise.resolve();
  const quadProxy = (m) => { const q = new THREE.Mesh(post.materials.quad, m); q.frustumCulled = false; return q; };
  function proxyOf(o, material = o.material) {
    let p = null;
    if (o.isSkinnedMesh) return null;
    if (o.isInstancedMesh) { p = new THREE.InstancedMesh(o.geometry, material, 1); if (o.instanceColor) p.instanceColor = o.instanceColor; }
    else if (o.isMesh) p = new THREE.Mesh(o.geometry, material);
    else if (o.isPoints) p = new THREE.Points(o.geometry, material);
    else if (o.isSprite) p = new THREE.Sprite(material);
    else if (o.isLineSegments) p = new THREE.LineSegments(o.geometry, material);
    else if (o.isLine) p = new THREE.Line(o.geometry, material);
    if (!p) return null;
    p.frustumCulled = false; p.receiveShadow = o.receiveShadow; p.castShadow = o.castShadow;
    if (o.morphTargetInfluences) { p.morphTargetInfluences = o.morphTargetInfluences.slice(); p.morphTargetDictionary = o.morphTargetDictionary; }
    return p;
  }
  const geoSig = (g) => (g ? Object.keys(g.attributes).sort().join('|') + (g.morphAttributes?.position ? '+m' : '') : '');
  function sceneProxies() {
    const out = [], seen = new Set();
    scene.traverse((o) => {
      const m = o.material;
      if (!m || Array.isArray(m)) return;
      const k = [m.uuid, o.type, !!o.instanceColor, geoSig(o.geometry)].join();
      if (seen.has(k)) return; seen.add(k);
      const p = proxyOf(o); if (p) out.push(p);
    });
    return out;
  }
  // pasada de sombras: lo mismo que WebGLShadowMap.getDepthMaterial() (lado, map/alphaMap/alphaTest/desplazamiento)
  function shadowProxies() {
    const list = [], tmp = [], seen = new Set();
    const SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
    scene.traverse((o) => {
      if (!o.isMesh || !o.castShadow || !o.material || Array.isArray(o.material)) return;
      const m = o.material, custom = o.customDepthMaterial;
      const side = m.shadowSide != null ? m.shadowSide : SIDE[m.side];
      const k = [custom ? custom.uuid : 'depth', side, !!m.map, !!m.alphaMap, m.alphaTest > 0, !!(m.displacementMap && m.displacementScale !== 0), o.type, geoSig(o.geometry)].join();
      if (seen.has(k)) return; seen.add(k);
      let dm = custom;
      if (!dm) { dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); tmp.push(dm); }
      dm.side = side; dm.alphaMap = m.alphaMap; dm.alphaTest = m.alphaTest; dm.map = m.map;
      dm.displacementMap = m.displacementMap; dm.displacementScale = m.displacementScale; dm.displacementBias = m.displacementBias;
      dm.clipShadows = m.clipShadows; dm.clippingPlanes = m.clippingPlanes; dm.clipIntersection = m.clipIntersection;
      const p = proxyOf(o, dm); if (p) list.push(p);
    });
    return { list, dispose: () => tmp.forEach((m) => m.dispose()) };
  }
  let shadowRTc = null;
  const shadowRT = () => shadowRTc || (shadowRTc = new THREE.WebGLRenderTarget(4, 4));
  /** Emite compileAsync en tandas (una por rato ocioso, en cola con las demás llamadas) y resuelve cuando la GPU terminó. */
  // (lights = false: pases de posproceso, que se dibujan en su propia escena sin luces ni niebla)
  function compileBatched(list, target, cam, { noFog = false, batch = 6, lights = true } = {}) {
    const done = [];
    const issued = issueChain.then(async () => {
      for (let i = 0; i < list.length; i += batch) {
        // (la compilación en segundo plano espera a que termine una apertura en curso: nada que compita con ella)
        while (opening && !disposed) await new Promise((r) => setTimeout(r, 500));
        await idle();
        if (disposed) return;
        const sub = new THREE.Scene();
        for (const p of list.slice(i, i + batch)) sub.add(p);
        const prev = renderer.getRenderTarget(), fogSave = scene.fog;
        renderer.setRenderTarget(target);
        if (noFog) scene.fog = null; // (la pasada de sombras dibuja sin escena → sin niebla)
        try { done.push(renderer.compileAsync(sub, cam, lights ? scene : null).then(() => sub.clear(), () => sub.clear())); } catch { /* */ }
        finally { scene.fog = fogSave; renderer.setRenderTarget(prev); }
      }
    });
    issueChain = issued.catch(() => {});
    return issued.then(() => Promise.all(done));
  }
  /** Tras quedar listo: la otra variante (pantalla ↔ destino HDR), para que un cambio de calidad no recompile en vivo. */
  function compileOtherVariant() {
    if (!post || disposed || !renderer.compileAsync) return;
    const want = compiledVariants.has('hdr') ? 'screen' : 'hdr';
    if (compiledVariants.has(want)) return;
    compiledVariants.add(want);
    const ps = [];
    if (want === 'screen') ps.push(compileBatched(sceneProxies(), null, camera, { batch: 2 }));
    else {
      ps.push(compileBatched(sceneProxies(), post.sceneTarget, camera, { batch: 2 }));
      ps.push(compileBatched(post.materials.toTarget.map(quadProxy), post.sceneTarget, camera, { batch: 2, lights: false }));
      ps.push(compileBatched(post.materials.toScreen.map(quadProxy), null, camera, { batch: 2, lights: false }));
    }
    Promise.all(ps).then(() => { variantReady[want] = true; }, () => {});
  }
  await idle(); // PERF-RETOMA (3.er corte: applyQuality → setSize y destinos del posproceso)
  applyQuality();
  report(0.8);
  {
    const restore = [], afterFirstFrame = [];
    const show = (o) => { restore.push([o, o.visible]); o.visible = true; };
    frags.forEach(show); crackMeshes.forEach(show);
    const pc = petalSets.map((s) => s.mesh.count);
    crumbs.count = 1; crumbs.setMatrixAt(0, _zero);
    sparks.spawn(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), { color: [0, 0, 0], life: 0.01, size: 0.001 });
    const texs = new Set();
    const addTex = (v) => { if (v && v.isTexture && !v.isRenderTargetTexture && v.image) texs.add(v); };
    scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { for (const k in m) addTex(m[k]); if (m.uniforms) for (const u of Object.values(m.uniforms)) addTex(u?.value); }
    });
    for (const u of Object.values(P.uniforms || {})) addTex(u?.value);
    const uploaded = (t) => { try { const p = renderer.properties.get(t); return !!p.__webglTexture && p.__version === t.version; } catch { return false; } };
    timing.tex = [];
    timing.texStart = Math.round(performance.now()) - timing.t0;
    let ti = 0; // PERF-RETOMA: progreso fino 0.80 → 0.88 durante la subida (main.js vigila que el montaje avance)
    for (const t of texs) {
      report(0.8 + 0.08 * (ti++ / texs.size), false);
      if (uploaded(t)) continue; // (p. ej. parchment.js ya la subió)
      const img = t.image;
      const tag = `${img.naturalWidth || img.width}x${img.naturalHeight || img.height} ${img.constructor?.name || '?'}`;
      // PERF: imágenes ≥ 0.25 Mpx decodificadas fuera del hilo y subidas por franjas en ratos ociosos
      let done = false;
      const a = performance.now();
      try { done = await uploadInStrips(THREE, renderer, t, idle); } catch (e) { done = false; console.warn('[scroll3d] subida por franjas:', e?.message || e); }
      if (done) { timing.tex.push(`${tag} franjas ${Math.round(performance.now() - a)}ms`); continue; }
      if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && img.decode) { try { await img.decode(); } catch { /* */ } }
      await idle();
      const b = performance.now();
      try { renderer.initTexture(t); } catch { /* */ }
      timing.tex.push(`${tag} directa ${Math.round(performance.now() - b)}ms`);
    }
    timing.texEnd = Math.round(performance.now()) - timing.t0;
    report(0.88);
    await idle();
    try {
      if (renderer.compileAsync) {
        // PERF: (1) solo la variante del nivel de calidad actual (destino HDR del posproceso en L0–L2, pantalla en L3/L4);
        // la otra se compila después de quedar listo, en segundo plano (compileOtherVariant). (2) En tandas de ~6 programas
        // por rato ocioso (la parte síncrona de compile() cuesta ~4 ms por programa: antes eran ~180 ms de una vez).
        // (3) Programas de la pasada de SOMBRAS (MeshDepthMaterial y el customDepthMaterial del pergamino): three los
        // compilaba al dibujar el primer mapa de sombras, de forma síncrona (primer cuadro de 360–450 ms en escritorio).
        const ps = [];
        if (post && Q.post > 0) {
          ps.push(compileBatched(sceneProxies(), post.sceneTarget, camera));
          ps.push(compileBatched(post.materials.toTarget.map(quadProxy), post.sceneTarget, camera, { lights: false }));
          ps.push(compileBatched(post.materials.toScreen.map(quadProxy), null, camera, { lights: false }));
          compiledVariants.add('hdr'); variantReady.hdr = true;
        } else { ps.push(compileBatched(sceneProxies(), null, camera)); compiledVariants.add('screen'); variantReady.screen = true; }
        const shadowSet = shadowProxies();
        ps.push(compileBatched(shadowSet.list, shadowRT(), key.shadow.camera, { noFog: true }));
        await Promise.all(ps);
        // los materiales sustitutos se liberan DESPUÉS del primer cuadro (si no, three borra sus programas antes de reusarlos)
        afterFirstFrame.push(() => shadowSet.dispose());
        timing.shadowPrograms = shadowSet.list.length;
      }
    } catch (e) { console.warn('[scroll3d] precompilación:', e?.message || e); }
    report(0.92);
    await idle();
    const progs0 = renderer.info.programs?.length ?? -1, f0 = performance.now();
    try { renderFrame(); } catch (e) { console.warn('[scroll3d] primer render:', e?.message || e); }
    timing.firstFrame = Math.round(performance.now() - f0);
    timing.firstFramePrograms = (renderer.info.programs?.length ?? -1) - progs0;
    if (timing.firstFramePrograms > 0) timing.firstFrameKeys = renderer.info.programs.slice(progs0).map((p) => p.name + ' ' + p.cacheKey.replace(/(false,)+/g, 'F*,').slice(0, 220));
    afterFirstFrame.forEach((f) => { try { f(); } catch { /* */ } });
    restore.forEach(([o, v]) => (o.visible = v));
    crumbs.count = 0; sparks.clear(); petalSets.forEach((s, i) => (s.mesh.count = pc[i]));
  }
  report(1);
  // PERF: listo → recién ahora el bucle puede arrancar; la calidad adaptativa no mide los primeros 2 s
  ready = true;
  timing.ready = Math.round(performance.now() - timing.t0);
  fpsWin.warm = 2.0; fpsWin.t = 0; fpsWin.n = 0; fpsWin.max = 0; fpsWin.good = 0;
  requestAnimationFrame(() => { canvas.style.opacity = '1'; });
  wake();
  setTimeout(compileOtherVariant, 1200);

  // ───────── API
  function open() {
    if (opened) return Promise.resolve();
    if (opening && seq?.promise) return seq.promise;
    const p = startSequence();
    hovered = false; canvas.style.cursor = '';
    wake();
    return p;
  }
  function reset() {
    if (seq?.resolve) { const r = seq.resolve; seq.resolve = null; r(); }
    seq = null; opening = false; opened = false; phase = 'idle';
    rng = mulberry32(20261224); // seek() determinista
    sweepT = -1;
    // pergamino
    updateClosedQuat();
    rig.position.copy(closedPos); rig.quaternion.copy(qClosed); rig.updateMatrixWorld(true);
    uState.u = 0; uState.v = 0; P.setUnroll(0); P.setLightSweep(-9);
    try { P.setWriting?.(0); P.setTextOpacity?.(1); } catch { /* */ }
    // ESCENA: ritmo, lectura y luces
    Object.assign(pace, { mul: 1, wNat: 0, wRate: 1, wRateS: 1, back: -1, backRate: 1, ctaShown: false, gate: 0, wt: 0 });
    scrollMax = 0; hasScroll = false; readK = 0; cleanAmt = 0; wideK = 0; textFade = 1;
    key.position.copy(KEY_POS); readLight.intensity = 0; cleanU.uCleanAmt.value = 0;
    try { quill?.reset?.(); } catch { /* */ }
    if (P.uniforms?.pEdgeWave && U0.edge != null) P.uniforms.pEdgeWave.value = U0.edge;
    if (P.uniforms?.pSweepGain && U0.gain != null) P.uniforms.pSweepGain.value = U0.gain;
    // lazo
    if (rb.group.parent !== rig) rig.add(rb.group);
    rb.group.position.set(0, 0, 0); rb.group.quaternion.identity(); rb.group.scale.setScalar(1);
    rb.reset();
    // sello
    sealHolder.visible = true; rimK = 0.22;
    if (entero) entero.visible = true;
    frags.forEach((f, i) => { (sealRoot || sealHolder).add(f); f.position.copy(fragRest[i].p); f.quaternion.copy(fragRest[i].q); f.visible = false; });
    fragState.length = 0;
    setCrack(0); crackMeshes.forEach((m) => m.geometry.setDrawRange(0, 0));
    interiorMats.forEach((m) => (m.emissiveIntensity = 0)); lacreMats.forEach((m) => (m.emissiveIntensity = 0));
    flash.intensity = 0;
    crumbN = 0; crumbs.count = 0; sparks.clear();
    petals.forEach((p) => { p.state = 0; petalSets[p.set].mesh.setMatrixAt(p.slot, _zero); });
    petalSets.forEach((s) => (s.mesh.instanceMatrix.needsUpdate = true));
    // cámara
    computePoses();
    cam.pos.copy(poses.closed.pos); cam.tgt.copy(poses.closed.tgt); cam.vp.set(0, 0, 0); cam.vt.set(0, 0, 0);
    renderer.shadowMap.needsUpdate = true; // (L3/L4 con sombras perezosas)
    wake();
  }
  function seek(t, scroll = null) {
    reset();
    silent = true;
    startSequence();
    if (Number.isFinite(scroll)) { hasScroll = true; scrollMax = clamp(scroll); }
    const n = Math.round(Math.max(0, t) * 60);
    for (let i = 0; i < n; i++) step(1 / 60);
    silent = false;
    frozen = true;
    renderFrame();
    return { phase, u: +uState.u.toFixed(3), ribbon: rb.state, t: seq ? +seq.t.toFixed(2) : t, wt: +pace.wt.toFixed(3) };
  }
  // ESCENA · gancho de la pluma (js/pluma.js de PLUMA-WEB). Precompila sus programas antes de mostrarla (sin compilación síncrona
  // en el primer cuadro), coloca el tintero en su lugar reservado y la mueve cada cuadro con el mismo wt de setWriting.
  async function attachQuill(q) {
    if (!q || disposed) return false;
    if (quill) detachQuill();
    try { if (reduced) q.setReducedMotion?.(true); } catch { /* */ }
    try { q.setQuality?.(clamp(qLevel, 0, 4)); } catch { /* */ }
    quillSheen = qLevel <= 2;
    if (q.inkwell) { q.inkwell.position.copy(inkSpot.pos); q.inkwell.rotation.y = inkSpot.rotY; }
    const roots = [q.group, q.inkwell, q.debug?.paperStrip?.mesh].filter(Boolean);
    try {
      if (renderer.compileAsync) {
        const tmp = new THREE.Scene();
        for (const r of roots) { r.updateMatrixWorld(true); r.traverse((o) => { const px = o.material && !Array.isArray(o.material) ? proxyOf(o) : null; if (px) tmp.add(px); }); }
        // las dos variantes (destino HDR del posproceso y pantalla): un cambio de calidad no recompila la pluma en vivo
        const targets = post ? (Q.post > 0 ? [post.sceneTarget, null] : [null, post.sceneTarget]) : [null];
        for (const tg of targets) {
          const prev = renderer.getRenderTarget();
          renderer.setRenderTarget(tg);
          let pr = null;
          try { pr = renderer.compileAsync(tmp, camera, scene); } finally { renderer.setRenderTarget(prev); }
          await pr;
          if (disposed) break;
          await idle();
        }
        tmp.clear();
      }
    } catch (e) { console.warn('[scroll3d] precompilar pluma:', e?.message || e); }
    if (disposed) { try { q.dispose?.(); } catch { /* */ } return false; }
    if (q.group && !q.group.parent) scene.add(q.group);
    if (q.inkwell && !q.inkwell.parent) scene.add(q.inkwell);
    quill = q;
    computePoses();
    renderer.shadowMap.needsUpdate = true;
    wake();
    return true;
  }
  function detachQuill() {
    const q = quill; quill = null; wideK = 0;
    if (!q) return;
    try { q.group?.removeFromParent(); q.inkwell?.removeFromParent(); q.dispose?.(); } catch { /* */ }
    renderer.shadowMap.needsUpdate = true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    io?.disconnect(); ro?.disconnect();
    disposeExtra.forEach((f) => { try { f(); } catch { /* */ } });
    removeEventListener('resize', onWinResize);
    document.removeEventListener('visibilitychange', onVis);
    removeEventListener('deviceorientation', onOrient);
    canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp);
    try { unsubBeat?.(); } catch { /* */ }
    if (seq?.resolve) { const r = seq.resolve; seq.resolve = null; r(); }
    try { rb.dispose(); } catch { /* */ }
    try { quill?.dispose?.(); quill = null; } catch { /* */ }
    try { P.dispose(); } catch { /* */ }
    sparks.dispose();
    const seen = new Set();
    scene.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        if (seen.has(m)) continue; seen.add(m);
        for (const k in m) { const v = m[k]; if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); } }
        m.dispose();
      }
    });
      [tAlb, tNrm, tRgh, tPet1, tPet2, glowTex, waxGlow].forEach((t) => t?.dispose());
    flameMat2.dispose(); glow2.material.dispose();
    post?.dispose(); envRT.dispose(); pmrem.dispose(); shadowRTc?.dispose();
    renderer.dispose();
    canvas.remove(); vignetteEl.remove();
  }

  const api = {
    open, reset, dispose,
    setActive(on) { active = !!on; if (active) { gpuWake(); wake(); } },
    /** COMPAT-FLUIDEZ: libera los destinos de render (sección lejos); setActive(true) o wake() los recrean. */
    sleep() { return gpuSleep(); },
    wake() { gpuWake(); },
    get asleep() { return gpuAsleep; },
    get isOpen() { return opening || opened; },
    get fps() { return fps; },
    /** PERF: siempre true cuando main.js recibe la API (mountScroll resuelve al terminar el montaje); el bucle no dibuja antes. */
    get ready() { return ready; },
    /** PERF: coste de GPU en ms por cuadro de la calidad actual (n cuadros con sincronización forzada). Solo como
     *  confirmación puntual (main.js antes de cambiar a la tarjeta HTML): bloquea ~n cuadros. */
    gpuCost(n = 3) { return api.debug.bench(Math.max(1, n | 0)); },
    // extras
    get opening() { return opening; },
    get opened() { return opened; },
    get phase() { return phase; },
    get quality() { return qLevel; },
    setQuality(n) { if (n == null) { forcedQ = null; return; } forcedQ = qLevel = clamp(n | 0, 0, LEVELS.length - 1); applyQuality(); },
    /** ESCENA: zona que tapa la interfaz (px) en la lectura y el encuadre final: { top, bottom, left, right } (CTA, música). */
    setSafeArea(s = {}) {
      const n = { top: +s.top || 0, bottom: +s.bottom || 0, left: +s.left || 0, right: +s.right || 0 };
      if (n.top === readSafe.top && n.bottom === readSafe.bottom && n.left === readSafe.left && n.right === readSafe.right) return;
      Object.assign(readSafe, n); computePoses();
    },
    /** ESCENA: progreso del recorrido fijo de la sección (0..1, main.js en cada scroll). Ritmo = max(tiempo, scroll) con tope;
     *  solo cuenta el máximo alcanzado (la secuencia nunca retrocede). */
    setScrollProgress(p) { if (!Number.isFinite(p)) return; hasScroll = true; const v = clamp(p); if (v > scrollMax) { scrollMax = v; if (opening) wake(); } },
    /** ESCENA: estado de la secuencia para main.js (freno de la sección, CTAs) y pruebas. */
    get sequence() {
      return { phase, opening, opened, ctaShown: pace.ctaShown, done: opened, wt: +pace.wt.toFixed(4), wNat: +pace.wNat.toFixed(2),
        rate: +(seq && seq.writeT < 0 ? pace.mul : pace.wRateS).toFixed(2), back: +pace.back.toFixed(2), scroll: +scrollMax.toFixed(3),
        finalMode, readK: +readK.toFixed(2), clean: +cleanAmt.toFixed(2), sWrite: PACE.sWrite, sBack: PACE.sBack };
    },
    /** ESCENA · lugar reservado del tintero (mundo, sobre la mesa: y = 0) y su giro; se recalcula con el tamaño (responsive). */
    get inkwell() { return { position: inkSpot.pos.clone(), rotationY: inkSpot.rotY }; },
    attachQuill, detachQuill, get quill() { return quill; },
    /** ESCENA: legibilidad (px de pantalla por metro de hoja en el encuadre actual y altura-x del cuerpo). */
    get legibility() {
      camera.updateMatrixWorld(); const a = new THREE.Vector3(TA.center[0], TA.center[1], 0.0004), b = a.clone().setY(a.y + XH);
      P.group.localToWorld(a); P.group.localToWorld(b); a.project(camera); b.project(camera);
      return { xHeightPx: +(Math.abs(b.y - a.y) * H / 2).toFixed(2), finalMode, dpr };
    },
    seek, live() { frozen = false; wake(); },
    setMusic(m) { bindMusic(m); },
    get state() { return { phase, u: uState.u, ribbon: rb.state, quality: qLevel, dpr, fps, seqT: seq?.t ?? 0, post: !!(post && Q.post > 0) }; },
    scene, camera, renderer, parchment: P, ribbon: rb,
    debug: {
      render: renderFrame, post, key, timing,
      get level() { return Q; },
      get adapt() { return { recovered, lockAt, lockUp, upgrades, warm: +fpsWin.warm.toFixed(2), good: fpsWin.good }; },
      get loopFlags() { return { ready, active, inView, raf: !!raf, disposed, frozen, hidden: document.hidden }; },
      get variants() { return { ...variantReady, issued: [...compiledVariants] }; },
      /** Prueba determinista de la calidad adaptativa: alimenta adapt() con cuadros sintéticos [[fps, s], …]. */
      feed(seq) {
        foreignLong = 0; const out = [];
        for (const [f, s] of seq) { const dt = 1 / f; for (let i = 0, n = Math.round(f * s); i < n; i++) { time += dt; adapt(dt); } out.push(`${f}fps×${s}s→L${qLevel}`); }
        return { out, recovered, lockAt };
      },
      // ms por cuadro con sincronización forzada (readPixels) para medir el coste de GPU de la configuración actual
      bench(n = 30) {
        const gl = renderer.getContext(), px = new Uint8Array(4);
        renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) renderFrame();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return +((performance.now() - t0) / n).toFixed(2);
      },
    },
  };
  return api;
}
