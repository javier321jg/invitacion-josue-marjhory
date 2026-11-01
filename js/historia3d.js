// HISTORIA · «Nuestra historia» mágica (SPEC, decisión del usuario n.º 6). Módulo auto-montable: no lo llama main.js.
//
// La foto de la pareja (STORY.photo) SE FORMA con decenas de miles de partículas con forma de flor (5 pétalos), coloreadas por
// la propia foto, que llegan en remolinos como pétalos llevados por el viento y se ensamblan dentro del marco de arco mientras
// se hace scroll (progreso ligado al scroll y reversible: al subir, la foto se deshace en flores). Cada flor tiene profundidad
// (mapa de profundidad de rostros/cascos/cuerpos) y la cámara es «de ventana» (proyección fuera de eje anclada al marco del DOM):
// el plano de la foto queda clavado al layout y lo que está más cerca o más lejos se desplaza → parallax 3D real con el scroll,
// el mouse o el giroscopio. Al completarse, la foto nítida aparece bajo las flores (con el mismo parallax por mapa de
// profundidad), un destello dorado la recorre y quedan flores vivas formando una guirnalda en el arco. Flores 3D que se abren,
// pétalos (assets/tex/petalo*.png) que flotan delante y detrás del marco, polvo de oro y un destello sutil en cada pulso de la
// canción (window.__inv.music.onBeat). Todo el movimiento de partículas se calcula en la GPU (ninguna posición se actualiza en
// CPU por cuadro). Calidad automática: 110 mil partículas en escritorio, 36 mil en móvil; baja sola si cae el fps.
// Sin WebGL, con ?nogl=1 o con render por software → la <img> del HTML con un revelado CSS. Movimiento reducido → foto con
// fundido suave. Las letras (antetítulo, título y firma en oro; párrafo con revelado elegante) se animan aunque no haya WebGL;
// el título y la firma los escribe a mano js/escritura.js (data-escritura) si está disponible.
//
// API: window.__inv.historia = { fps, quality, progress, done, mode, debug: { force(p|null), tier(n), state() }, dispose() }
// Parámetros: ?nogl=1 · ?reduced=1 · ?sw=1 (permite render por software) · ?historia=off (fuerza la imagen) ·
//             ?hq=0..3 (fija el nivel de calidad) · ?hp=0..1 (fija el progreso, para capturas)
import { STORY } from './content.js';

const QS = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); } })();
// COMPAT-FLUIDEZ: con html.soft-motion (preferencia del sistema → modo suave de main.js) la foto se forma con flores igual
const REDUCED = QS.has('reduced') || (matchMedia('(prefers-reduced-motion: reduce)').matches && !document.documentElement.classList.contains('soft-motion'));
const NO_GL = QS.has('nogl') || QS.get('historia') === 'off';
const ALLOW_SW = QS.get('sw') === '1';
const COARSE = matchMedia('(pointer: coarse)').matches;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

// Niveles de calidad (n = partículas totales). El búfer se crea para el nivel inicial; los niveles bajos usan un prefijo
// (orden de Bayer: cualquier prefijo cubre la foto de forma pareja) y flores un poco más grandes para no dejar huecos.
const TIERS = [
  { n: 20000, dpr: 1.0, petals: 22, blooms: 6, dust: 110 },
  { n: 36000, dpr: 1.5, petals: 36, blooms: 9, dust: 190 },
  { n: 72000, dpr: 1.5, petals: 64, blooms: 12, dust: 300 },
  { n: 110000, dpr: 1.75, petals: 96, blooms: 16, dust: 440 },
];

// Profundidad de referencia-1.jpg (96×111, 8 bits): fondo lejos, cuerpos al medio, rostros y cascos cerca.
// Hecha con OpenCV (rostros Haar + GrabCut + relieves suavizados): shots/historia/depth.py
const DEPTH_PNG = 'data:image/png;base64,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';

// Rostros (coordenadas de la foto, 0..1 desde arriba a la izquierda): chico y chica (OpenCV Haar).
const FACES = [[0.645, 0.305], [0.275, 0.412]];
// Encuadre de la foto dentro del marco 4:5 («cover» + sobreescaneo para el parallax): centro y fracción visible.
const PHOTO_ASPECT = 480 / 555, FRAME_ASPECT = 4 / 5, OVERSCAN = 1.09;
const CROP = { cx: 0.5, cy: 0.49, sx: (FRAME_ASPECT / PHOTO_ASPECT) / OVERSCAN, sy: 1 / OVERSCAN };

/* ======================================================================================================================== */
/* Shaders                                                                                                                   */
/* ======================================================================================================================== */
const GLSL_PHOTO = /* glsl */`
uniform sampler2D uPhoto;
uniform sampler2D uDepth;
uniform vec4 uCrop;      // cx, cy (desde arriba), sx, sy
// q: coordenadas del marco (0..1, y hacia abajo) → uv de la textura (flipY: v hacia arriba)
vec2 photoUV(vec2 q) { return vec2(uCrop.x + (q.x - .5) * uCrop.z, 1. - (uCrop.y + (q.y - .5) * uCrop.w)); }
// misma gradación que tenía la <img> (sepia .16, saturación .92, contraste 1.04, brillo .96) + luz cálida de vela
vec3 grade(vec3 c) {
  vec3 sep = vec3(dot(c, vec3(.393, .769, .189)), dot(c, vec3(.349, .686, .168)), dot(c, vec3(.272, .534, .131)));
  c = mix(c, sep, .14);
  float l = dot(c, vec3(.2126, .7152, .0722));
  c = mix(vec3(l), c, .95);
  c = (c - .5) * 1.05 + .5;
  c *= vec3(1.02, .985, .94) * .98;
  return clamp(c, 0., 1.);
}
// sombra inferior y viñeta del marco (como el ::after de la <img>)
vec3 frameShade(vec3 c, vec2 q) {
  // CREMA: viñeta cálida y suave (sobre el papel crema el pie oscuro de la foto pesaba como un hueco)
  float g = smoothstep(.62, 1.02, q.y) * .2;
  vec2 d = (q - vec2(.5, .34)) * vec2(1., 1.18);
  float v = smoothstep(.45, .92, length(d)) * .18;
  float k = 1. - (1. - g) * (1. - v);
  return mix(c, vec3(.36, .26, .16), k);
}
`;

// Arco del marco (CSS: border-radius 50% 50% 16px 16px / 40% 40% 16px 16px con aspecto 4:5 → semicírculo arriba)
const GLSL_ARCH = /* glsl */`
uniform vec2 uFrame;     // ancho, alto del marco (px)
float sdArch(vec2 p) {   // p: px desde el centro del marco, y hacia arriba
  vec2 hs = uFrame * .5;
  float R = hs.x, cy = hs.y - R;
  if (p.y > cy) return length(p - vec2(0., cy)) - R;
  float rb = 16.;
  vec2 b = vec2(hs.x, (cy + 3000. + hs.y) * .5);
  vec2 c = vec2(0., (cy + 3000. - hs.y) * .5);
  vec2 d = abs(p - c) - b + rb;
  return length(max(d, 0.)) + min(max(d.x, d.y), 0.) - rb;
}
`;

const PARTICLE_VS = /* glsl */`
${GLSL_PHOTO}
uniform float uTime, uProg, uDone, uBeat, uDPR, uD, uZAmp, uS, uEdge, uLod;
uniform vec2 uFrame;
uniform vec4 uV[4];      // remolinos: x, y (en anchos del marco, desde su centro), z (px), radio (anchos)
attribute vec2 aT;       // destino en el marco (0..1, y hacia abajo)
attribute vec4 aR;       // azar
attribute vec4 aD;       // retraso, duración, tamaño/10, guirnalda (0/1)
attribute vec2 aG;       // destino en la guirnalda (codificado: g = aG*1.5 - .25)
varying vec4 vCol;
varying vec4 vSpr;       // cos, sin (giro del sprite), 1/aplastado, vuelo
void main() {
  float delay = aD.x, dur = max(aD.y, .04), sizeMul = aD.z * 10., keep = aD.w;
  float big = step(3., sizeMul);
  // jinetes del viento: todas las grandes y un tercio de las medianas pasan por los remolinos
  float rider = big * max(step(6., sizeMul), step(aR.z, .36));
  float lp = clamp((uProg - delay) / dur, 0., 1.);
  float e = rider > .5 ? smoothstep(.36, 1., lp) : 1. - pow(1. - lp, 2.2);
  float inv = 1. - e;

  vec2 q = aT;
  vec2 uv = photoUV(q);
  float dep = textureLod(uDepth, uv, 0.).r;
  vec3 T = vec3((q.x - .5) * uFrame.x, (.5 - q.y) * uFrame.y, (dep - .55) * uZAmp);
  vec3 P;
  if (rider > .5) {
    // remolino 3D con dos brazos en espiral logarítmica que gira (vivo aunque el scroll se detenga); luego vuelo en arco
    float k = floor(aR.w * 3.999);
    vec4 v = k < 1. ? uV[0] : k < 2. ? uV[1] : k < 3. ? uV[2] : uV[3];
    float vr = v.w * uFrame.x;
    float u = .12 + .88 * sqrt(aR.y);
    float rr = vr * u;
    float ang = step(.5, fract(aR.x * 7.)) * 3.14159 + 3.1 * log(u / .12) * -1. + (aR.x - .5) * .32
              + uTime * (.85 + .25 * sin(k * 2.1)) * (mod(k, 2.) < .5 ? 1. : -1.) + inv * 1.6;
    float tilt = .52 + .2 * sin(k * 1.7);       // casi de frente: se ve la espiral (muy inclinado parecía una barra)
    vec3 orb = vec3(cos(ang) * rr, sin(ang) * rr * cos(tilt), sin(ang) * rr * sin(tilt));
    orb.y += (aR.z - .5) * vr * .25;
    vec3 S = vec3(v.xy * uFrame.x, v.z) + orb;
    vec3 dl = T - S;
    vec3 perp = vec3(-dl.y, dl.x, 0.) * (.18 + .18 * aR.y) * (mod(k, 2.) < .5 ? 1. : -1.);
    P = mix(S, T, e) + perp * sin(3.14159 * e);
  } else {
    // el resto: una bruma de flores que se condensa girando cerca de su sitio (las medianas, desde algo más lejos)
    vec2 rnd = vec2(cos(aR.x * 6.2832), sin(aR.x * 6.2832));
    float Rf = uFrame.x * (big > .5 ? .08 + .32 * aR.y : .03 + .2 * aR.y * aR.y);
    float th = 2.8 * inv * inv;
    float cs = cos(th), sn = sin(th);
    P = T + vec3(mat2(cs, sn, -sn, cs) * rnd * Rf * inv, (aR.z - .5) * (big > .5 ? 420. : 260.) * inv);
  }
  // aleteo de pétalo en el aire (cero al salir y al llegar)
  float fl = sin(3.14159 * e) * (.35 + .65 * big);
  P += vec3(sin(uTime * 1.7 + aR.x * 40.), cos(uTime * 1.3 + aR.y * 40.), sin(uTime * 1.1 + aR.z * 30.)) * vec3(16., 13., 40.) * fl;
  // ya en su sitio: un respiro mínimo
  P.xy += vec2(sin(uTime * .9 + aR.y * 50.), cos(uTime * .8 + aR.x * 50.)) * .3 * e;

  // flores vivas: tras completarse, algunas se van al arco y forman una guirnalda
  float kd = keep * smoothstep(0., 1., uDone);
  vec2 g = aG * 1.5 - .25;
  vec3 G = vec3((g.x - .5) * uFrame.x, (.5 - g.y) * uFrame.y, 10. + 30. * aR.z);
  G.xy += vec2(sin(uTime * .5 + aR.x * 30.), cos(uTime * .43 + aR.w * 30.)) * 2.2;
  P = mix(P, G, kd * (.6 + .4 * smoothstep(.2, 1., uDone)));

  // color: la foto (con mip según el tamaño de la flor) + tono de pétalo en el aire + paleta marfil/rubor/oro en la guirnalda
  float lod = clamp(log2(max(uS * sizeMul * uLod, 1.)), 0., 5.);
  vec3 col = frameShade(grade(textureLod(uPhoto, uv, lod).rgb), q);
  vec3 petal = mix(vec3(.98, .92, .85), vec3(.94, .74, .72), aR.y);
  petal = mix(petal, vec3(.95, .80, .52), step(.8, aR.w));
  col = mix(col, petal, inv * .36) + inv * .05;
  vec3 gar = mix(mix(vec3(.99, .95, .88), vec3(.96, .76, .74), step(.55, aR.y)), vec3(.98, .84, .55), step(.78, aR.x));
  col = mix(col, gar, kd * .9);

  float a = smoothstep(0., .1, lp);
  a *= mix(.22 + .74 * e * e, mix(.75 + .2 * e, .95, rider), big);   // la bruma es tenue hasta posarse
  a *= 1. - uDone * (1. - keep);
  a *= mix(1., .82 + .18 * sin(uTime * 2.3 + aR.z * 40.) + uBeat * .5, kd);

  // tamaño en pantalla (px de dispositivo): crece en el aire, flor visible en la guirnalda
  float sz = uS * sizeMul * mix(1., 1. + .055 * sizeMul, inv);
  sz = mix(sz, (7. + 7. * aR.y) * (uFrame.x / 470.) * (1. + uBeat * .25), kd);
  vec4 mv = modelViewMatrix * vec4(P, 1.);
  gl_Position = projectionMatrix * mv;
  float dz = max(-mv.z, 60.);
  gl_PointSize = max(sz * uD / dz * uDPR, 1.2);
  // muy cerca de la cámara: se desvanece (sin desenfoque caro); al fondo: se funde con la noche
  a *= smoothstep(uD * .82, uD * .55, P.z);
  col = mix(col, vec3(.07, .05, .04), smoothstep(-80., -900., P.z) * .55);
  // bordes superior e inferior del lienzo (la sección): sin cortes duros
  float ny = gl_Position.y / gl_Position.w;
  a *= smoothstep(1., 1. - uEdge, abs(ny));
  vCol = vec4(col, a);
  float ang = aR.w * 6.2832 + inv * (aR.x - .5) * 9. + uTime * (aR.y - .5) * 2.4 * inv + kd * uTime * .2 * (aR.z - .5);
  float flip = mix(1., abs(cos(uTime * (1.3 + aR.z * 1.7) + aR.x * 9.)), inv * .8 * big);
  vSpr = vec4(cos(ang), sin(ang), 1. / max(flip, .2), max(inv, kd));
  if (a < .004) gl_Position = vec4(2., 2., 2., 1.);   // invisible: fuera del recorte (sin coste de fragmentos)
}
`;

const PARTICLE_FS = /* glsl */`
uniform sampler2D uFlower;
varying vec4 vCol;
varying vec4 vSpr;
void main() {
  vec2 p = mat2(vSpr.x, vSpr.y, -vSpr.y, vSpr.x) * (gl_PointCoord - .5);
  p.x *= vSpr.z;
  if (abs(p.x) > .5) discard;
  vec4 f = texture2D(uFlower, p + .5);
  float a = vCol.a * f.a;
  if (a < .008) discard;
  vec3 col = vCol.rgb * (.84 + .26 * f.r);
  col = mix(col, col * vec3(1.14, 1.02, .76) + vec3(.07, .045, 0.), f.g * (.3 + .55 * vSpr.w));
  gl_FragColor = vec4(col, a);
}
`;

const FRAME_VS = /* glsl */`
varying vec2 vP;
void main() { vP = (modelMatrix * vec4(position, 1.)).xy; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 0., 1.); }
`;

const FRAME_FS = /* glsl */`
${GLSL_PHOTO}
${GLSL_ARCH}
uniform float uPhotoA, uLine, uTime, uBeat, uSweep, uFill, uZAmp, uD, uLift;
uniform vec3 uEye;
varying vec2 vP;
vec4 over(vec4 dst, vec4 src) { return src + dst * (1. - src.a); }   // premultiplicado
vec2 toQ(vec2 p) { return vec2(p.x / uFrame.x + .5, .5 - p.y / uFrame.y); }
void main() {
  vec2 p = vP;
  vec2 hs = uFrame * .5;
  float d = sdArch(p);
  vec4 acc = vec4(0.);

  // sombra suave bajo el marco
  float sd = sdArch(p + vec2(0., 26.));
  // CREMA: sombra cálida y suave sobre el papel (negra al 55 % ensuciaba el crema)
  float sh = (1. - smoothstep(-30., 70., sd)) * .3 * max(uPhotoA, uFill * .5);
  acc = over(acc, vec4(vec3(.36, .25, .12) * sh, sh));

  float inside = smoothstep(.75, -.75, d);
  // lienzo donde se ensamblan las flores (CREMA: papel algo más hondo que la página, no un hueco oscuro)
  acc = over(acc, vec4(vec3(.89, .84, .74) * .6, .6) * inside * uFill);

  // foto nítida con parallax por mapa de profundidad: se marcha el rayo ojo→píxel sobre el relieve (oclusión correcta,
  // sin ondas en los bordes de los rostros). Punto del rayo a la altura h: X = S + (E - S)·h/D.
  if (uPhotoA > .001 && inside > 0.) {
    vec2 q = toQ(p);
    vec2 dir = (uEye.xy - p) / uD;
    float zmax = .45 * uZAmp, dh = uZAmp / 10.;
    float h = zmax, ph = h;
    float df = (textureLod(uDepth, photoUV(toQ(p + dir * h)), 0.).r - .55) * uZAmp - h, pdf = df;
    for (int i = 0; i < 10; i++) {
      if (df >= 0.) break;
      ph = h; pdf = df; h -= dh;
      df = (textureLod(uDepth, photoUV(toQ(p + dir * h)), 0.).r - .55) * uZAmp - h;
    }
    h = df >= 0. && pdf < 0. ? mix(ph, h, pdf / (pdf - df)) : h;
    vec2 P2 = p + dir * h;
    vec3 col = frameShade(grade(texture2D(uPhoto, clamp(photoUV(toQ(P2)), .002, .998)).rgb), q);
    // destello dorado que recorre la foto al completarse
    float sw = (q.x * .8 + q.y * .55) - (uSweep * 2.1 - .35);
    col += exp(-sw * sw * 38.) * vec3(1., .85, .58) * .2 * step(.001, uSweep) * (1. - step(.999, uSweep));
    col *= 1. + uLift;
    acc = over(acc, vec4(col, 1.) * inside * uPhotoA);
  }

  // línea dorada del arco (a 12 px del borde) que se dibuja sola, con una chispa en la punta y un brillo que la recorre
  float off = 12.;
  float R2 = hs.x + off, cy = hs.y - hs.x;
  float Ltop = 1.5708 * R2, Lside = cy + hs.y + off - 22., Lbot = hs.x + off - 22.;
  float Ltot = Ltop + Lside + Lbot + 34.6;
  vec2 ap = vec2(abs(p.x), p.y);
  float s;
  if (ap.y > cy) s = atan(ap.x, ap.y - cy) * R2;
  else if (ap.y > -hs.y - off + 22.) s = Ltop + (cy - ap.y);
  else s = Ltop + Lside + 34.6 + max(0., hs.x + off - 22. - ap.x);
  s /= Ltot;
  float dl = abs(d - off);
  float line = smoothstep(1.35, .35, dl);
  float glow = exp(-dl * dl * .045) * .22;
  float drawn = 1. - smoothstep(uLine - .006, uLine, s);
  float tip = exp(-pow((s - uLine) * Ltot / 7., 2.)) * step(.002, uLine) * (1. - step(.998, uLine));
  float gap = smoothstep(10., 14., ap.x) + step(ap.y, cy);      // hueco para la estrella de arriba
  float gl = (line + glow) * drawn * min(gap, 1.);
  float shine = .5 + .5 * sin(s * 40. - uTime * 1.6);
  vec3 gold = mix(vec3(.80, .66, .42), vec3(1., .92, .72), shine * .6 + uBeat * .4);
  acc = over(acc, vec4(gold, 1.) * clamp(gl * (.8 + .2 * uBeat), 0., 1.));
  acc = over(acc, vec4(vec3(1., .9, .66), 1.) * clamp(tip * (1. + exp(-dl * .5)) * .9 * exp(-dl * .25), 0., 1.));

  // estrella ✦ en la clave del arco
  vec2 sp = p - vec2(0., hs.y + off);
  float k = pow(abs(sp.x), .55) + pow(abs(sp.y), .55);
  float rs = 2.75 + .35 * uBeat;
  float star = smoothstep(rs + .25, rs - .25, k) * smoothstep(.0, .25, uLine);
  float sg = exp(-dot(sp, sp) * .03) * .35 * smoothstep(.0, .25, uLine) * (1. + uBeat);
  acc = over(acc, vec4(vec3(1., .9, .68), 1.) * clamp(star + sg, 0., 1.));
  gl_FragColor = acc;
}
`;

// Flores 3D: dos coronas de 5 pétalos (forma analítica que se abre en la GPU) + centro dorado
const BLOOM_VS = /* glsl */`
attribute vec4 aP;       // s (a lo largo), t (a lo ancho -1..1), ángulo del pétalo, corona (0 exterior, 1 interior, 2 centro)
attribute vec4 iA;       // x, y, z, radio (px)
attribute vec4 iB;       // euler x, y, z, paleta
attribute vec4 iC;       // fase, retraso de apertura, giro, deriva
uniform float uTime, uOpen, uBeat;
varying vec3 vN;
varying vec3 vW;
varying vec4 vPet;       // s, t, corona, paleta
varying float vFog;
vec3 petal(float s, float t, float ring, float open) {
  float len = ring < .5 ? 1. : .72;
  float w = (ring < .5 ? 1.02 : .86) * len * pow(sin(3.14159 * clamp(s * .78 + .22, 0., 1.)), .5) * (1. - .1 * s);
  float x = t * w * .5;
  float y = s * len;
  float z = t * t * .17 * len * (.35 + s);
  float tilt = mix(ring < .5 ? 1.18 : 1.4, ring < .5 ? .2 : .52, open);
  float a = tilt - s * s * .42 * open;
  float ca = cos(a), sa = sin(a);
  return vec3(x, y * ca - z * sa, y * sa + z * ca);
}
vec3 rotZ(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z); }
mat3 euler(vec3 e) {
  float cx = cos(e.x), sx = sin(e.x), cy = cos(e.y), sy = sin(e.y), cz = cos(e.z), sz = sin(e.z);
  mat3 rx = mat3(1., 0., 0., 0., cx, sx, 0., -sx, cx);
  mat3 ry = mat3(cy, 0., -sy, 0., 1., 0., sy, 0., cy);
  mat3 rz = mat3(cz, sz, 0., -sz, cz, 0., 0., 0., 1.);
  return rz * ry * rx;
}
void main() {
  float s = aP.x, t = aP.y, ang = aP.z, ring = aP.w;
  float o = smoothstep(0., 1., clamp((uOpen - iC.y) / max(1. - iC.y, .05), 0., 1.));
  vec3 p, n;
  if (ring > 1.5) {
    float r = s * .2, a = t * 6.2832;
    p = vec3(r * cos(a), r * sin(a), .05 + .06 * (1. - s * s) * (.4 + .6 * o));
    n = normalize(vec3(p.xy * 1.6, 1.));
  } else {
    vec3 p0 = petal(s, t, ring, o);
    vec3 ps = petal(s + .02, t, ring, o);
    vec3 pt = petal(s, t + .04, ring, o);
    n = normalize(cross(ps - p0, pt - p0));
    p = rotZ(p0, ang);
    n = rotZ(n, ang);
  }
  float spin = uTime * iC.z + iC.x * 6.2832;
  p = rotZ(p, spin); n = rotZ(n, spin);
  mat3 R = euler(iB.xyz + vec3(sin(uTime * .4 + iC.x * 9.) * .12, cos(uTime * .33 + iC.x * 7.) * .12, 0.));
  p = R * p; n = R * n;
  float sc = iA.w * (.55 + .45 * o);
  vec3 bob = vec3(sin(uTime * .35 + iC.x * 11.), cos(uTime * .3 + iC.x * 13.), sin(uTime * .25 + iC.x * 5.)) * iC.w;
  vec3 W = iA.xyz + bob + p * sc;
  vW = W; vN = n; vPet = vec4(s, t, ring, iB.w);
  vFog = smoothstep(-40., -700., W.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(W, 1.);
}
`;

const BLOOM_FS = /* glsl */`
uniform float uAlpha, uBeat, uTime;
uniform vec3 uEyeW;
varying vec3 vN;
varying vec3 vW;
varying vec4 vPet;
varying float vFog;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uEyeW - vW);
  vec3 L = normalize(vec3(-.45, .6, .68));
  float s = vPet.x, t = vPet.y, ring = vPet.z, pal = vPet.w;
  vec3 col; float a = 1.;
  if (ring > 1.5) {
    float g = fract(sin(dot(floor(vW.xy * .9), vec2(12.9898, 78.233))) * 43758.5453);
    col = mix(vec3(.72, .52, .24), vec3(1., .86, .5), g * .7 + .3 * s);
    col *= .75 + .45 * max(dot(n, L), 0.);
    col += vec3(1., .85, .5) * uBeat * .35 * g;
  } else {
    vec3 inner = pal < .34 ? vec3(.93, .66, .66) : pal < .67 ? vec3(.92, .76, .5) : vec3(.83, .47, .52);
    vec3 outer = pal < .34 ? vec3(.99, .95, .9) : pal < .67 ? vec3(.99, .94, .84) : vec3(.97, .8, .78);
    col = mix(inner, outer, smoothstep(.02, .7, s));
    col *= 1. - .07 * (1. - abs(sin(t * 7.5))) * s;                    // nervaduras
    float ndl = dot(n, L);
    float diff = smoothstep(-.35, 1., ndl);
    float trans = max(-ndl, 0.) * .28;                                   // luz que atraviesa el pétalo
    float rim = pow(1. - abs(dot(n, V)), 2.5) * .3;
    // sombras de color (rubor cálido), nunca grises
    col = col * mix(vec3(.84, .66, .62), vec3(1.06, 1.02, .97), diff) + trans * vec3(1., .78, .62) * col + rim * vec3(1., .92, .8);
    col *= mix(1., .86, ring) * (.9 + .1 * s);                           // la corona interior y la base, algo en sombra
    a = smoothstep(1., .8, abs(t)) * smoothstep(1., .9, s);
  }
  col = mix(col, vec3(.07, .05, .04), vFog * .45);
  a *= uAlpha;
  if (a < .01) discard;
  gl_FragColor = vec4(col, a);
}
`;

// Pétalos de rosa (texturas de Blender) instanciados, con el viento calculado en la GPU
const PETAL_VS = /* glsl */`
attribute vec4 iA;       // x, y, z, tamaño (px)
attribute vec4 iB;       // fase, giro, velocidad, textura (0/1)
attribute vec3 iC;       // eje de giro
uniform float uTime, uGust, uAvoid;
uniform vec3 uBox, uBoxC;
uniform vec2 uFrameH;    // medio ancho/alto del marco
varying vec2 vUv;
varying float vA;
varying float vShade;
varying float vTex;
mat3 rotAxis(vec3 a, float t) {
  float c = cos(t), s = sin(t), k = 1. - c;
  return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
              a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
              a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}
void main() {
  vec3 local = position;
  local.z += (local.x * local.x * .9 + local.y * .22) * .45;           // pétalo curvado
  float t = uTime * (.55 + iB.z);
  mat3 R = rotAxis(normalize(iC), iB.x * 6.2832 + uTime * (iB.y - .5) * 2.4);
  vec3 lp = R * (local * iA.w);
  float gust = 1. + uGust * 2.2;
  vec3 drift = vec3(t * 30. * gust, -t * 16. + sin(t * .7 + iB.x * 9.) * 24., sin(t * .45 + iB.x * 7.) * 46.);
  vec3 pos = mod(iA.xyz + drift - uBoxC + uBox, 2. * uBox) - uBox + uBoxC;
  vec3 e = smoothstep(uBox, uBox * .72, abs(pos - uBoxC));
  vA = e.x * e.y * e.z;
  // los de delante no tapan los rostros: se apagan sobre el centro de la foto
  vec2 fq = abs(pos.xy) / max(uFrameH, vec2(1.));
  vA *= 1. - uAvoid * (1. - smoothstep(.55, .95, max(fq.x, fq.y * 1.05)));
  vec3 n = R * vec3(0., 0., 1.);
  vShade = .72 + .26 * abs(n.z) + .22 * pow(1. - abs(n.z), 2.);
  vUv = uv; vTex = iB.w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + lp, 1.);
}
`;

const PETAL_FS = /* glsl */`
uniform sampler2D uTexA, uTexB;
uniform float uAlpha;
varying vec2 vUv;
varying float vA;
varying float vShade;
varying float vTex;
void main() {
  vec4 t = vTex < .5 ? texture2D(uTexA, vUv) : texture2D(uTexB, vUv);
  float a = t.a * vA * uAlpha;
  if (a < .01) discard;
  gl_FragColor = vec4(t.rgb * vShade * vec3(1.03, .98, .95), a);
}
`;

// Polvo de oro (aditivo)
const DUST_VS = /* glsl */`
attribute vec4 aP;       // x, y, z (-1..1 en la caja), tamaño
attribute vec4 aR;       // fase, velocidad, titileo, tipo
uniform vec3 uBox, uBoxC;
uniform float uTime, uBeat, uAlpha, uDPR, uD;
varying float vA;
varying float vK;
void main() {
  float t = uTime * (.12 + .22 * aR.y);
  vec3 p = aP.xyz * uBox + vec3(sin(t * 2. + aR.x * 6.28) * 28., t * 46., cos(t * 1.6 + aR.x * 5.) * 40.);
  p = mod(p + uBox, 2. * uBox) - uBox;
  vec3 e = smoothstep(uBox, uBox * .7, abs(p));
  p += uBoxC;
  float big = step(.62, aR.w);
  float tw = .3 + .7 * pow(.5 + .5 * sin(uTime * (.9 + aR.z * 2.6) + aR.x * 30.), 3.);
  vA = uAlpha * tw * e.x * e.y * e.z * (1. + uBeat * 1.4 * big);
  vK = aR.w;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aP.w * uD / max(-mv.z, 60.) * uDPR * (1. + uBeat * .5 * big);
}
`;

const DUST_FS = /* glsl */`
varying float vA;
varying float vK;
void main() {
  vec2 c = gl_PointCoord - .5;
  float r2 = dot(c, c);
  float core = exp(-r2 * 70.), halo = exp(-r2 * 14.) * .3;
  float star = vK > .86 ? (exp(-abs(c.x) * 42.) * exp(-abs(c.y) * 7.) + exp(-abs(c.y) * 42.) * exp(-abs(c.x) * 7.)) * .7 : 0.;
  float a = (core + halo + star) * vA;
  if (a < .004) discard;
  gl_FragColor = vec4(vec3(.8, .58, .26) * a, a * .9);   // CREMA: polvo de oro viejo (el brillo aditivo no se veía sobre crema)
}
`;

/* ======================================================================================================================== */
/* Utilidades                                                                                                                */
/* ======================================================================================================================== */
function mulberry32(seed) {
  const st = new Int32Array([seed]);   // estado en un arreglo tipado: sin números «en caja» (ni basura) en cada llamada
  return () => { const a = (st[0] = (st[0] + 0x6D2B79F5) | 0); let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const bayer8 = (x, y) => { let v = 0; for (let b = 0; b < 3; b++) { const xb = (x >> b) & 1, yb = (y >> b) & 1; v = (v << 2) | ((xb ^ yb) << 1) | yb; } return v; };
const loadImage = src => new Promise((res, rej) => {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => res(im));
  im.onerror = () => rej(new Error('no se pudo cargar ' + src.slice(0, 60)));
  im.src = src;
});
const idle = (fn, timeout = 1200) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 60));

/** Sprite de flor de 5 pétalos (R: sombreado del pétalo, G: centro dorado, A: forma). */
function flowerSprite(THREE) {
  const S = 128, data = new Uint8Array(S * S * 4), seg = Math.PI * 2 / 5, L = 0.47;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = (x + 0.5) / S - 0.5, py = (y + 0.5) / S - 0.5;
    const r = Math.hypot(px, py), a = Math.atan2(py, px) + Math.PI / 2;
    const da = ((a % seg) + seg) % seg - seg / 2;
    const pr = r * Math.cos(da), pt = r * Math.sin(da);
    let alpha = 0, shade = 0.55;
    if (pr > 0) {
      const s = pr / L;
      const w = 0.2 * Math.pow(Math.sin(Math.PI * Math.min(s * 0.88 + 0.12, 1)), 0.7) * (1 - 0.12 * s) + 0.01;
      const notch = 0.018 * Math.exp(-Math.pow(pt / 0.03, 2)) * Math.exp(-Math.pow((s - 1) / 0.12, 2)); // muesca en la punta
      const edge = (w - Math.abs(pt)) * S, tip = ((1 - s) * L - notch) * S;
      alpha = clamp(Math.min(edge, tip) / 1.3 + 0.5);
      const across = Math.abs(pt) / w;
      shade = 0.62 + 0.38 * Math.sin(Math.PI * Math.min(s, 1) * 0.85) - 0.18 * across * across - 0.08 * Math.exp(-Math.pow(pt / 0.006, 2)) * s;
    }
    const center = clamp((0.075 - r) * S / 1.3 + 0.5);
    alpha = Math.max(alpha, center);
    const i = (y * S + x) * 4;
    data[i] = Math.round(clamp(shade) * 255);
    data[i + 1] = Math.round(clamp(center + 0.35 * clamp(1 - r / 0.16)) * 255);
    data[i + 2] = 0;
    data[i + 3] = Math.round(alpha * 255);
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** ¿Está (u, v) dentro del arco? (coordenadas del marco 0..1; alto = 1.25 × ancho) */
function inArch(u, v) {
  const x = u - 0.5, y = (0.5 - v) * 1.25, cy = 0.125;
  if (y > cy) return x * x + (y - cy) * (y - cy) < 0.25;
  const rb = 0.035;
  if (y < -0.625 + rb && Math.abs(x) > 0.5 - rb) { const dx = Math.abs(x) - (0.5 - rb), dy = (-0.625 + rb) - y; return dx * dx + dy * dy < rb * rb; }
  return Math.abs(x) < 0.5 && y > -0.625;
}
/** Punto del contorno del arco más cercano a (u, v), desplazado `off` hacia afuera (unidades del ancho). */
function archNearest(u, v, off) {
  const x = u - 0.5, y = (0.5 - v) * 1.25, cy = 0.125;
  let px, py, dist;
  if (y > cy) {
    const a = Math.atan2(y - cy, x), R = 0.5 + off;
    px = Math.cos(a) * R; py = cy + Math.sin(a) * R; dist = 0.5 - Math.hypot(x, y - cy);
  } else {
    const dSide = 0.5 - Math.abs(x), dBot = y + 0.625;
    if (dSide < dBot) { px = Math.sign(x || 1) * (0.5 + off); py = y; dist = dSide; } else { px = x; py = -0.625 - off; dist = dBot; }
  }
  return { u: px + 0.5, v: 0.5 - py / 1.25, dist };
}

/** Cede el hilo principal (la generación se reparte en trozos de ~8 ms: nunca bloquea un cuadro). */
const yieldNow = () => new Promise(r => { const s = globalThis.scheduler; if (s?.yield) s.yield().then(r, r); else setTimeout(r, 0); });

/** Partículas por clase: grande (pocas, llegan primero), media y fina (detalle, llegan al final). Asíncrona: cede cada ~8 ms. */
async function buildParticles(nTotal, seed = 7) {
  const rng = mulberry32(seed);
  let tSlice = performance.now();
  const slice = async () => { if (performance.now() - tSlice > 8) { await yieldNow(); tSlice = performance.now(); } };
  // ruido de valor suave para que las regiones lleguen juntas (frentes orgánicos)
  const NG = 9, W1 = NG + 1, grid = new Float32Array(W1 * W1);
  for (let k = 0; k < grid.length; k++) grid[k] = rng();
  const vnoise = (u, v) => {
    const x = clamp(u) * NG, y = clamp(v) * NG, i = Math.min(NG - 1, x | 0), j = Math.min(NG - 1, y | 0), fx = smooth(x - i), fy = smooth(y - j);
    const o = j * W1 + i;
    return lerp(lerp(grid[o], grid[o + 1], fx), lerp(grid[o + W1], grid[o + W1 + 1], fx), fy);
  };
  const faces = FACES.map(([fx, fy]) => [(fx - CROP.cx) / CROP.sx + 0.5, (fy - CROP.cy) / CROP.sy + 0.5]);
  const classes = [
    { key: 'large', frac: 0.03, size: 8.2, delay: [0.0, 0.3], dur: [0.4, 0.5] },
    { key: 'medium', frac: 0.19, size: 4.4, delay: [0.1, 0.5], dur: [0.33, 0.42] },
    { key: 'fine', frac: 0.78, size: 2.35, delay: [0.25, 0.7], dur: [0.26, 0.3] },
  ];
  const AREA = 1.1427; // área del arco en unidades de ancho²
  const BAYER = new Uint8Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) BAYER[y * 8 + x] = bayer8(x, y);
  const [f0, f1] = faces;
  const out = {};
  for (const cl of classes) {
    const N = Math.max(200, Math.round(nTotal * cl.frac));
    const g = Math.sqrt(AREA / N), gv = g / 1.25;
    const nx = Math.ceil(1 / g), ny = Math.ceil(1 / gv);
    // rejilla con jitter dentro del arco (arreglos tipados, sin objetos por punto)
    const cap = nx * ny, U = new Float32Array(cap), V = new Float32Array(cap), B = new Uint8Array(cap);
    let m = 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const u = (i + 0.5 + (rng() - 0.5) * 0.9) * g, v = (j + 0.5 + (rng() - 0.5) * 0.9) * gv;
        if (u < 0 || u > 1 || v < 0 || v > 1 || !inArch(u, v)) continue;
        U[m] = u; V[m] = v; B[m] = BAYER[(j & 7) * 8 + (i & 7)]; m++;
      }
      if ((j & 7) === 7) await slice();
    }
    // orden de Bayer (cualquier prefijo cubre la foto parejo) con azar dentro de cada nivel: ordenación por conteo
    const start = new Uint32Array(65);
    for (let k = 0; k < m; k++) start[B[k] + 1]++;
    for (let b = 0; b < 64; b++) start[b + 1] += start[b];
    const fill = start.slice(0, 64), ord = new Uint32Array(m);
    for (let k = 0; k < m; k++) ord[fill[B[k]]++] = k;
    for (let b = 0; b < 64; b++) for (let k = start[b + 1] - 1; k > start[b]; k--) {
      const r = start[b] + ((rng() * (k - start[b] + 1)) | 0), t = ord[k]; ord[k] = ord[r]; ord[r] = t;
    }
    const n = m;
    const aT = new Uint16Array(n * 2), aR = new Uint8Array(n * 4), aD = new Uint8Array(n * 4), aG = new Uint16Array(n * 2);
    let keeps = 0;
    for (let k = 0; k < n; k++) {
      if ((k & 1023) === 1023) await slice();
      const u = U[ord[k]], v = V[ord[k]];
      aT[k * 2] = Math.round(u * 65535); aT[k * 2 + 1] = Math.round(v * 65535);
      aR[k * 4] = (rng() * 256) | 0; aR[k * 4 + 1] = (rng() * 256) | 0; aR[k * 4 + 2] = (rng() * 256) | 0; aR[k * 4 + 3] = (rng() * 256) | 0;
      const d0x = u - f0[0], d0y = (v - f0[1]) * 1.25, d1x = u - f1[0], d1y = (v - f1[1]) * 1.25;
      const f = Math.min(1, Math.sqrt(Math.min(d0x * d0x + d0y * d0y, d1x * d1x + d1y * d1y)) / 0.5);
      // FIX (arte): antes las caras se formaban AL FINAL (0.5·(1−f)) y entre p 0.45 y 0.95 se veían como un mosaico
      // "censurado" (indefinidamente si el invitado se detenía); ahora se asientan algo antes que los bordes
      const w = clamp(0.22 * f + 0.36 * vnoise(u, v) + 0.2 * rng());
      const delay = lerp(cl.delay[0], cl.delay[1], w);
      const dur = Math.min(lerp(cl.dur[0], cl.dur[1], rng()), 1 - delay);
      let keep = 0, gu = u, gv2 = v;
      if (cl.key === 'medium') {
        const nb = archNearest(u, v, 0);
        if (nb.dist < 0.1) {
          const o = archNearest(u, v, (12 + (rng() - 0.35) * 18) / 470);
          // racimos: hombro superior izquierdo y esquina inferior derecha del arco (+ unas pocas sueltas)
          const ax = o.u - 0.5, ay = (0.5 - o.v) * 1.25;
          const dA = Math.hypot(ax + 0.41, ay - 0.41), dB = Math.hypot(ax - 0.5, ay + 0.6);
          const dens = 0.035 + Math.exp(-dA * dA / (2 * 0.13 * 0.13)) + 0.85 * Math.exp(-dB * dB / (2 * 0.11 * 0.11));
          if (rng() < dens * 0.3) { keep = 1; gu = o.u; gv2 = o.v; keeps++; }
        }
      }
      aD[k * 4] = Math.round(delay * 255); aD[k * 4 + 1] = Math.round(dur * 255);
      aD[k * 4 + 2] = Math.round(cl.size / 10 * 255); aD[k * 4 + 3] = keep * 255;
      aG[k * 2] = Math.round(clamp((gu + 0.25) / 1.5) * 65535); aG[k * 2 + 1] = Math.round(clamp((gv2 + 0.25) / 1.5) * 65535);
    }
    out[cl.key] = { n, aT, aR, aD, aG, keeps, frac: cl.frac };
  }
  return out;
}

/** Geometría de flor 3D (instanciable): pétalos parametrizados (s, t) que el shader curva y abre. */
function bloomGeometry(THREE) {
  const NU = 7, NV = 5, P = [], I = [];
  for (const ring of [0, 1]) for (let k = 0; k < 5; k++) {
    const ang = (k / 5 + (ring ? 0.1 : 0)) * Math.PI * 2, base = P.length / 4;
    for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) P.push(i / NU, (j / NV) * 2 - 1, ang, ring);
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = base + i * (NV + 1) + j, b = a + NV + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  const base = P.length / 4, NR = 3, NA = 14;
  P.push(0, 0, 0, 2);
  for (let i = 1; i <= NR; i++) for (let j = 0; j < NA; j++) P.push(i / NR, j / NA, 0, 2);
  for (let j = 0; j < NA; j++) I.push(base, base + 1 + j, base + 1 + ((j + 1) % NA));
  for (let i = 1; i < NR; i++) for (let j = 0; j < NA; j++) {
    const a = base + 1 + (i - 1) * NA + j, b = base + 1 + (i - 1) * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
    I.push(a, c, b, b, c, d);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aP', new THREE.Float32BufferAttribute(P, 4));
  g.setIndex(I);
  return g;
}

/* ======================================================================================================================== */
/* Letras: antetítulo y firma en oro, título escrito a mano (escritura.js) y párrafo con revelado elegante                   */
/* ======================================================================================================================== */
function setupText(root, { reduced }) {
  const copy = root.querySelector('.story__copy');
  if (!copy) return { setInk() {}, dispose() {} };
  const eyebrow = copy.querySelector('.story__eyebrow'), title = copy.querySelector('.story__title');
  const body = copy.querySelector('.story__body'), sig = copy.querySelector('.signature');
  // el párrafo, palabra por palabra (el texto sigue en el DOM tal cual)
  if (body && !body.querySelector('.h3d-w')) {
    const words = body.textContent.trim().split(/\s+/);
    body.textContent = '';
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.className = 'h3d-w'; s.style.setProperty('--i', i); s.textContent = w;
      body.append(s, i < words.length - 1 ? ' ' : '');
    });
  }
  root.classList.add('h3d-text');
  if (reduced) root.classList.add('h3d-rm');
  // ¿Escribe js/escritura.js el título y la firma (data-escritura)? Si no, revelado dorado propio: tinta que corre.
  const ink = [...copy.querySelectorAll('[data-escritura]')];
  const setInk = on => ink.forEach(el => el.classList.toggle('h3d-ink', on));
  const scripted = escrituraActive();
  setInk(!scripted);
  // orden de lectura: antetítulo → título escrito a mano → párrafo (mientras la pluma escribe «en nuestra historia») → firma
  const t2 = copy.querySelector('[data-escritura="historia-titulo-2"]');
  let titleDone = reduced || !scripted || !t2, bodySeen = false, fallback = 0;
  const revealBody = () => { if (titleDone && bodySeen && body) body.classList.add('is-in'); };
  const onT2 = () => { titleDone = true; clearTimeout(fallback); revealBody(); };
  if (body && !titleDone) body.style.setProperty('--bd', '1.2s');
  t2?.addEventListener('escritura:inicio', onT2, { once: true });
  // Secuencia de la pluma, determinista: si las piezas entran a la vez en pantalla (escritorio, scroll rápido), la cola
  // automática de escritura.js puede arrancarlas en paralelo (depende del orden en que cargó cada pieza). Con este módulo
  // activo, «en nuestra historia» y la firma pasan a modo manual y se escriben aquí: línea 1 → línea 2 → firma (+0.9 s).
  // Sin este módulo, el atributo no se pone y escritura.js las escribe solo (modo «vista»).
  const t1 = copy.querySelector('[data-escritura="historia-titulo-1"]');
  const timers = [];
  let seq = null;
  if (scripted && !reduced) {
    const play = el => { try { window.__escritura?.play?.(el)?.catch?.(() => {}); } catch {} };
    const st = el => el?.dataset.escrituraEstado;
    [t2, sig].forEach(el => { if (el?.hasAttribute('data-escritura')) el.dataset.escrituraModo = 'manual'; });
    seq = { t2Started: false, t2Done: false, sigSeen: false, sigStarted: false };
    seq.startT2 = () => { if (seq.t2Started || !t2) return; seq.t2Started = true; play(t2); };
    seq.trySig = () => {
      if (seq.sigStarted || !sig || !seq.sigSeen || !(seq.t2Done || !t2)) return;
      seq.sigStarted = true; timers.push(setTimeout(() => play(sig), 900));
    };
    seq.onT1 = () => seq.startT2();
    seq.onT2 = () => { seq.t2Done = true; seq.trySig(); };
    t1?.addEventListener('escritura:fin', seq.onT1);
    t2?.addEventListener('escritura:fin', seq.onT2);
    seq.onTitle = () => {
      const s1 = st(t1);
      if (t1 && (!s1 || s1 === 'armado' || s1 === 'pendiente')) play(t1);   // este observador se notifica antes que el suyo
      else if (!t1 || s1 === 'escrito' || s1 === 'error') seq.startT2();
      // vigías: si una pieza falla y no avisa, la siguiente se escribe igual
      timers.push(setTimeout(seq.startT2, 9000), setTimeout(() => { seq.t2Done = true; seq.trySig(); }, 15000));
    };
  }
  const io = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      if (e.target === body) { bodySeen = true; revealBody(); continue; }
      e.target.classList.add('is-in');
      if (e.target === title && !titleDone) fallback = setTimeout(onT2, 7500);   // por si la escritura no avisa
      if (e.target === title) seq?.onTitle();
      if (e.target === sig && seq) { seq.sigSeen = true; seq.trySig(); }
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.2 });
  [eyebrow, title, body, sig].forEach(el => el && io.observe(el));
  return {
    setInk,
    dispose() {
      io.disconnect(); clearTimeout(fallback); timers.forEach(clearTimeout); t2?.removeEventListener('escritura:inicio', onT2);
      if (seq) { t1?.removeEventListener('escritura:fin', seq.onT1); t2?.removeEventListener('escritura:fin', seq.onT2); }
    },
  };
}
/** js/escritura.js montado (escribe a mano los [data-escritura] cuando entran en pantalla) */
function escrituraActive() {
  return !!(window.__escritura || window.__inv?.escritura);
}

/* ======================================================================================================================== */
/* Montaje                                                                                                                   */
/* ======================================================================================================================== */
export function mountHistoria(root = document.getElementById('historia'), opts = {}) {
  const reduced = opts.reducedMotion ?? REDUCED;
  const api = {
    mode: 'img', fps: 0, quality: -1, progress: 0, done: 0, ready: false, error: null,
    debug: { force: p => { forced = p == null ? null : clamp(+p); }, tier: n => setTier(n, true), state: () => state() },
    dispose,
  };
  if (!root) return api;
  const figure = root.querySelector('.story__photo');
  const frameEl = root.querySelector('.story__frame');
  const text = setupText(root, { reduced });
  let forced = QS.has('hp') ? clamp(+QS.get('hp')) : null;
  let disposed = false, gl = null, initStarted = false;
  const cleanups = [() => text.dispose()];

  // ---- foto sin WebGL: revelado CSS (o fundido suave con movimiento reducido) ----
  let giveUp = false;
  const useImg = () => {
    giveUp = true;
    root.classList.remove('is-gl', 'h3d-wait');
    if (root.classList.contains('h3d-img')) return;
    root.classList.add('h3d-img');
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { figure?.classList.add('is-in'); io.disconnect(); } }, { threshold: 0.18 });
    if (figure) io.observe(figure);
    cleanups.push(() => io.disconnect());
  };

  if (reduced || NO_GL || !frameEl) { useImg(); api.mode = 'img'; publish(); return api; }

  // Mientras se prepara el WebGL, la <img> no se muestra (si no, se vería la foto y luego se desharía para formarse):
  // queda el arco vacío. Si a los 8 s de tener la foto en pantalla el lienzo aún no pintó, se usa la imagen.
  root.classList.add('h3d-wait');
  const watch = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    watch.disconnect();
    const tm = setTimeout(() => { if (!gl?.shown && !giveUp) { api.error = 'WebGL tardó demasiado'; useImg(); } }, 8000);
    cleanups.push(() => clearTimeout(tm));
  }, { threshold: 0.15 });
  if (figure) watch.observe(figure);
  cleanups.push(() => watch.disconnect());

  // ---- WebGL perezoso: se prepara cuando la sección se acerca (2 pantallas), en un rato ocioso ----
  const near = new IntersectionObserver(es => {
    if (es.some(e => e.isIntersecting) && !initStarted) {
      initStarted = true; near.disconnect();
      idle(() => initGL().catch(e => {
        api.error = String(e?.message || e);
        console.info('[historia] sin WebGL, uso la imagen:', api.error);
        useImg();
      }), 900);
    }
  }, { rootMargin: '200% 0px 200% 0px' });
  near.observe(root);
  cleanups.push(() => near.disconnect());
  publish();
  return api;

  function publish() {
    try { (window.__inv ||= {}).historia = api; } catch {}
  }
  function state() {
    return gl ? { tier: gl.tier, n: gl.activeN, dpr: gl.renderer.getPixelRatio(), prog: gl.prog, done: gl.done, target: gl.target, fps: api.fps,
      canvas: [gl.L.W, gl.L.H], frame: [gl.L.fw, gl.L.fh], visible: gl.visible } : { mode: api.mode, error: api.error };
  }
  function setTier(n, manual) { if (gl) gl.setTier(n, manual); }
  function dispose() {
    disposed = true;
    for (const f of cleanups.splice(0)) { try { f(); } catch {} }
    if (gl) { try { gl.dispose(); } catch {} gl = null; }
    root.classList.remove('is-gl');
  }

  async function initGL() {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/+esm'); // FIX: sin import maps (iOS < 16.4)
    if (disposed) return;
    const wrap = document.createElement('div');
    wrap.className = 'story__gl';
    wrap.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    wrap.append(canvas);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, premultipliedAlpha: true, depth: true, stencil: false,
        powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !ALLOW_SW });
    } catch (e) { throw new Error('WebGL no disponible: ' + (e?.message || e)); }
    const fail = e => { try { renderer.dispose(); renderer.forceContextLoss(); } catch {} wrap.remove(); throw e; };
    if (!renderer.capabilities.isWebGL2) fail(new Error('se requiere WebGL2'));
    try {
      const ctx = renderer.getContext(), dbg = ctx.getExtension('WEBGL_debug_renderer_info');
      const name = String((dbg && ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || ctx.getParameter(ctx.RENDERER) || '');
      if (!ALLOW_SW && /SwiftShader|llvmpipe|softpipe|Basic Render|Software Rasterizer/i.test(name)) fail(new Error('render por software (' + name + ')'));
    } catch (e) { if (/software/.test(e.message)) throw e; }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);

    // ---- texturas ----
    const [photoImg, depthImg, petA, petB] = await Promise.all([
      loadImage(STORY.photo), loadImage(DEPTH_PNG),
      loadImage('assets/tex/petalo.png').catch(() => null), loadImage('assets/tex/petalo_2.png').catch(() => null),
    ]).catch(fail);
    if (disposed) return fail(new Error('desmontado'));
    const tex = (img, mips = true) => {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = mips;
      t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      return t;
    };
    const tPhoto = tex(photoImg), tDepth = tex(depthImg, false), tFlower = flowerSprite(THREE);
    const tPetA = petA ? tex(petA) : tFlower, tPetB = petB ? tex(petB) : tPetA;

    // ---- nivel de calidad inicial ----
    const narrow = innerWidth < 720 || COARSE;
    const cores = navigator.hardwareConcurrency || 4;
    let tier = QS.has('hq') ? clamp(+QS.get('hq') | 0, 0, 3) : narrow ? 1 : cores <= 4 ? 2 : 3;
    const maxTier = tier;
    const parts = await buildParticles(TIERS[tier].n);
    if (disposed) return fail(new Error('desmontado'));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    camera.matrixAutoUpdate = true;

    const shared = {
      uTime: { value: 0 }, uProg: { value: 0 }, uDone: { value: 0 }, uBeat: { value: 0 }, uDPR: { value: 1 }, uD: { value: 1000 },
      uZAmp: { value: 60 }, uFrame: { value: new THREE.Vector2(470, 587) }, uEye: { value: new THREE.Vector3(0, 0, 1000) },
      uPhoto: { value: tPhoto }, uDepth: { value: tDepth }, uCrop: { value: new THREE.Vector4(CROP.cx, CROP.cy, CROP.sx, CROP.sy) },
    };

    // ---- partículas de flor (3 clases, 3 llamadas) ----
    const pMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uS: { value: 2 }, uEdge: { value: 0.12 }, uLod: { value: 1 },
        uV: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uFlower: { value: tFlower } },
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.NormalBlending,
    });
    const points = {};
    let order = 6;
    for (const key of ['large', 'medium', 'fine']) {
      const P = parts[key], g = new THREE.BufferGeometry();
      g.setAttribute('aT', new THREE.BufferAttribute(P.aT, 2, true));
      g.setAttribute('aR', new THREE.BufferAttribute(P.aR, 4, true));
      g.setAttribute('aD', new THREE.BufferAttribute(P.aD, 4, true));
      g.setAttribute('aG', new THREE.BufferAttribute(P.aG, 2, true));
      g.setDrawRange(0, P.n);
      const o = new THREE.Points(g, pMat);
      o.frustumCulled = false; o.renderOrder = order++;
      scene.add(o);
      points[key] = { obj: o, n: P.n, frac: P.frac };
    }

    // ---- marco: foto nítida, lienzo, sombra, línea dorada y estrella ----
    const fMat = new THREE.ShaderMaterial({
      uniforms: { ...shared, uPhotoA: { value: 0 }, uLine: { value: 0 }, uSweep: { value: 0 }, uFill: { value: 0 }, uLift: { value: 0 } },
      vertexShader: FRAME_VS, fragmentShader: FRAME_FS, transparent: true, premultipliedAlpha: true, depthTest: false, depthWrite: false,
    });
    const frameMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fMat);
    frameMesh.renderOrder = 5; frameMesh.frustumCulled = false;
    scene.add(frameMesh);

    // ---- flores 3D ----
    const rng = mulberry32(11);
    const bGeo = bloomGeometry(THREE);
    const bMat = new THREE.ShaderMaterial({
      uniforms: { uTime: shared.uTime, uBeat: shared.uBeat, uOpen: { value: 0 }, uAlpha: { value: 0 }, uEyeW: shared.uEye },
      vertexShader: BLOOM_VS, fragmentShader: BLOOM_FS, transparent: true, depthTest: true, depthWrite: true, side: THREE.DoubleSide,
    });
    const BMAX = TIERS[maxTier].blooms;
    const bA = new Float32Array(BMAX * 4), bB = new Float32Array(BMAX * 4), bC = new Float32Array(BMAX * 4);
    bGeo.setAttribute('iA', new THREE.InstancedBufferAttribute(bA, 4));
    bGeo.setAttribute('iB', new THREE.InstancedBufferAttribute(bB, 4));
    bGeo.setAttribute('iC', new THREE.InstancedBufferAttribute(bC, 4));
    const bloomBack = new THREE.Mesh(bGeo, bMat);
    bloomBack.frustumCulled = false; bloomBack.renderOrder = 3;
    scene.add(bloomBack);
    // reparto (en anchos del marco desde su centro, y hacia arriba; se escala en layout()): racimos en el arco + flotantes.
    // Nunca sobre la columna del texto (a la derecha en escritorio, debajo en móvil).
    const bloomSpec = [];
    const clusterA = [[-0.45, 0.46, 0.06, 0.11], [-0.33, 0.6, 0.1, 0.075], [-0.56, 0.3, 0.05, 0.068], [-0.22, 0.56, 0.16, 0.05]];
    const clusterB = [[0.5, -0.64, 0.07, 0.1], [0.37, -0.69, 0.11, 0.068], [0.57, -0.5, 0.05, 0.062], [0.27, -0.66, 0.16, 0.048]];
    clusterA.forEach(c => bloomSpec.push({ pos: c.slice(0, 3), r: c[3], kind: 'arch' }));
    clusterB.forEach(c => bloomSpec.push({ pos: c.slice(0, 3), r: c[3], kind: 'arch' }));
    const floats = [[-0.86, 0.12, -0.5], [-0.8, -0.55, -0.9], [-0.95, 0.66, -1.1], [0.1, 0.92, -0.8], [-0.4, -0.95, -0.6],
      [-1.05, -0.2, -0.35], [0.55, 0.8, -1.2], [-0.62, 0.9, -0.7]];
    for (let k = 0; bloomSpec.length < BMAX; k++) {
      const f = floats[k % floats.length];
      bloomSpec.push({ pos: [f[0] + (rng() - 0.5) * 0.1, f[1] + (rng() - 0.5) * 0.1, f[2]], r: 0.06 + rng() * 0.04, kind: 'float' });
    }
    // orientación, paleta, fases: fijas desde el inicio (layout() solo mueve y escala)
    bloomSpec.forEach((b, i) => {
      b.B = [0.35 + (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.9, rng() * 6.28, i % 3 === 2 ? 0.5 : i % 5 === 4 ? 0.85 : 0.15];
      b.C = [rng(), b.kind === 'arch' ? 0.2 + rng() * 0.25 : rng() * 0.3, (rng() - 0.5) * 0.12, b.kind === 'arch' ? 2 : 10 + rng() * 14];
    });

    // ---- pétalos (delante y detrás) ----
    const petGeo = new THREE.PlaneGeometry(1, 1, 3, 3);
    const mkPetals = (count, front) => {
      const g = new THREE.InstancedBufferGeometry();
      g.index = petGeo.index; g.setAttribute('position', petGeo.attributes.position); g.setAttribute('uv', petGeo.attributes.uv);
      const A = new Float32Array(count * 4), B = new Float32Array(count * 4), C = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        A.set([(rng() * 2 - 1) * 900, (rng() * 2 - 1) * 900, (rng() * 2 - 1) * 400, 0], i * 4);
        B.set([rng(), rng(), rng() * 0.6, rng() < 0.5 ? 0 : 1], i * 4);
        C.set([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1], i * 3);
      }
      g.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
      g.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
      g.setAttribute('iC', new THREE.InstancedBufferAttribute(C, 3));
      g.instanceCount = count;
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uGust: { value: 0 }, uAvoid: { value: front ? 0.85 : 0 }, uAlpha: { value: 0 },
          uBox: { value: new THREE.Vector3(800, 600, 300) }, uBoxC: { value: new THREE.Vector3() }, uFrameH: { value: new THREE.Vector2(235, 293) },
          uTexA: { value: tPetA }, uTexB: { value: tPetB } },
        vertexShader: PETAL_VS, fragmentShader: PETAL_FS, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false; mesh.renderOrder = front ? 11 : 1;
      scene.add(mesh);
      return { mesh, A, count, front };
    };
    const PMAX = TIERS[maxTier].petals;
    const petBack = mkPetals(Math.round(PMAX * 0.6), false), petFront = mkPetals(Math.round(PMAX * 0.4), true);

    // ---- polvo de oro (delante y detrás) ----
    const mkDust = (count, front) => {
      const g = new THREE.BufferGeometry();
      const P = new Float32Array(count * 4), R = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        P.set([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, (front ? 2.2 : 1.6) + rng() * rng() * (front ? 5.5 : 4)], i * 4);
        R.set([rng(), rng(), rng(), rng()], i * 4);
      }
      g.setAttribute('aP', new THREE.BufferAttribute(P, 4));
      g.setAttribute('aR', new THREE.BufferAttribute(R, 4));
      g.setDrawRange(0, count);
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: shared.uTime, uBeat: shared.uBeat, uDPR: shared.uDPR, uD: shared.uD, uAlpha: { value: 0 },
          uBox: { value: new THREE.Vector3(800, 600, 200) }, uBoxC: { value: new THREE.Vector3() } },
        vertexShader: DUST_VS, fragmentShader: DUST_FS, transparent: true, depthTest: false, depthWrite: false,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
        blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      const o = new THREE.Points(g, m);
      o.frustumCulled = false; o.renderOrder = front ? 12 : 2;
      scene.add(o);
      return { obj: o, count };
    };
    const DMAX = TIERS[maxTier].dust;
    const dustBack = mkDust(Math.round(DMAX * 0.6), false), dustFront = mkDust(Math.round(DMAX * 0.4), true);

    // ---- layout (medido en reposo; por cuadro solo scrollY) ----
    root.prepend(wrap);
    const L = { W: 1, H: 1, wrapDocTop: 0, wrapLeft: 0, fw: 470, fh: 587, fcx: 0, fcy: 0 };
    const docEl = document.documentElement;
    const layout = () => {
      const wr = wrap.getBoundingClientRect(), fr = frameEl.getBoundingClientRect();
      if (!wr.width || !fr.width) return false;
      const sy = scrollY;
      const changed = Math.abs(wr.width - L.W) > 0.5 || Math.abs(wr.height - L.H) > 0.5;
      Object.assign(L, { W: wr.width, H: wr.height, wrapDocTop: wr.top + sy, wrapLeft: wr.left, fw: fr.width, fh: fr.height,
        fcx: fr.left - wr.left + fr.width / 2, fcy: fr.top - wr.top + fr.height / 2 });
      if (changed) renderer.setSize(Math.round(L.W), Math.round(L.H), false);
      const fw = L.fw, fh = L.fh, k = fw / 470;
      shared.uFrame.value.set(fw, fh);
      shared.uZAmp.value = 0.115 * fw;
      frameMesh.scale.set(fw + 180, fh + 180, 1);
      frameMesh.position.set(0, -10, 0);
      pMat.uniforms.uEdge.value = Math.min(0.5, 110 / L.H);
      // pétalos y polvo: cajas alrededor del marco (en móvil, el ancho de la pantalla)
      const vw = docEl.clientWidth, halfW = Math.max(vw * 0.55, fw * 0.9);
      for (const pp of [petBack, petFront]) {
        const u = pp.mesh.material.uniforms;
        u.uBox.value.set(halfW, Math.max(fh * 0.95, 420), pp.front ? 230 : 380);
        u.uBoxC.value.set(L.W / 2 - L.fcx, 0, pp.front ? 260 : -480);
        u.uFrameH.value.set(fw * 0.5, fh * 0.5);
        for (let i = 0; i < pp.count; i++) pp.A[i * 4 + 3] = (pp.front ? 15 : 12) * k * (0.75 + 0.9 * ((i * 0.618) % 1));
        pp.mesh.geometry.attributes.iA.needsUpdate = true;
      }
      for (const dd of [dustBack, dustFront]) {
        const u = dd.obj.material.uniforms;
        u.uBox.value.set(halfW, Math.max(fh * 0.9, 400), dd === dustFront ? 200 : 450);
        u.uBoxC.value.set(L.W / 2 - L.fcx, 0, dd === dustFront ? 160 : -380);
      }
      // remolinos: a la izquierda/arriba/abajo del marco en escritorio; en las esquinas del marco en móvil (no hay márgenes)
      const narrowNow = vw < 900 || fw > vw * 0.62;
      const V = narrowNow
        ? [[-0.36, 0.5, 120, 0.3], [0.4, 0.3, -160, 0.26], [-0.34, -0.55, 60, 0.3], [0.38, -0.72, -90, 0.26]]
        : [[-0.84, -0.22, 120, 0.32], [-0.7, 0.5, -180, 0.28], [-0.32, -1.0, 60, 0.3], [0.32, -1.02, -120, 0.26]];
      V.forEach((v, i) => pMat.uniforms.uV.value[i].set(v[0], v[1], v[2] * k, v[3]));
      // flores 3D: posiciones en px (racimos sobre el arco, flotantes alrededor sin tocar el texto)
      bloomSpec.forEach((b, i) => {
        if (i >= BMAX) return;
        let [x, y, z] = b.pos;
        if (b.kind === 'float' && narrowNow) {
          // móvil: arriba del marco o en sus costados, por detrás (la columna de texto está debajo)
          const side = i % 2 ? 1 : -1;
          x = side * (0.38 + (i % 3) * 0.06); y = 0.62 + ((i * 0.37) % 0.3); z = -0.6 - (i % 4) * 0.25;
        }
        bA.set([x * fw, y * fw, z * fw, b.r * fw * (narrowNow ? 1.12 : 1)], i * 4);
        bB.set(b.B, i * 4);
        bC.set([b.C[0], b.C[1], b.C[2], b.C[3] * k], i * 4);
      });
      bGeo.attributes.iA.needsUpdate = bGeo.attributes.iB.needsUpdate = bGeo.attributes.iC.needsUpdate = true;
      return true;
    };

    // ---- calidad ----
    let raf = 0, running = false;
    const G = gl = {
      THREE, renderer, scene, camera, L, tier, activeN: 0, prog: 0, done: 0, target: 0, visible: false,
      setTier(n, manual) {
        n = clamp(n | 0, 0, maxTier);
        if (manual) G.locked = true;
        G.tier = tier = n;
        const T = TIERS[n], ratio = T.n / TIERS[maxTier].n;
        let active = 0;
        for (const key of ['large', 'medium', 'fine']) { const p = points[key]; const c = Math.max(50, Math.round(p.n * ratio)); p.obj.geometry.setDrawRange(0, c); active += c; }
        G.activeN = active;
        // flores un poco más grandes cuando hay menos (sin huecos)
        G.sizeK = Math.sqrt(1 / ratio);
        petBack.mesh.geometry.instanceCount = Math.round(petBack.count * T.petals / PMAX);
        petFront.mesh.geometry.instanceCount = Math.round(petFront.count * T.petals / PMAX);
        bGeo.instanceCount = Math.min(BMAX, T.blooms);
        dustBack.obj.geometry.setDrawRange(0, Math.round(dustBack.count * T.dust / DMAX));
        dustFront.obj.geometry.setDrawRange(0, Math.round(dustFront.count * T.dust / DMAX));
        const dpr = Math.min(devicePixelRatio || 1, narrow ? Math.min(1.5, T.dpr) : T.dpr);
        if (Math.abs(renderer.getPixelRatio() - dpr) > 0.01) { renderer.setPixelRatio(dpr); renderer.setSize(Math.round(L.W), Math.round(L.H), false); }
        shared.uDPR.value = renderer.getPixelRatio();
        api.quality = n;
      },
      dispose() {
        cancelAnimationFrame(raf); running = false;
        scene.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        [tPhoto, tDepth, tFlower, tPetA, tPetB].forEach(t => t?.dispose?.());
        renderer.dispose(); try { renderer.forceContextLoss(); } catch {}
        wrap.remove();
      },
    };
    layout();
    G.setTier(tier);

    // ---- compilar sin bloquear (KHR_parallel_shader_compile) ----
    try { await renderer.compileAsync(scene, camera); } catch {}
    if (disposed || giveUp) { G.dispose(); gl = null; return; }
    // AJUSTES (fluidez pergamino → historia): las texturas y los búferes se subían en el PRIMER cuadro, que caía justo al
    // soltarse el pergamino (tirón junto con el montaje del final). Se suben antes, en ratos ociosos, y se dibuja un cuadro
    // de calentamiento (el lienzo aún está oculto: h3d-wait)
    for (const t of new Set([tPhoto, tDepth, tFlower, tPetA, tPetB])) {
      await new Promise(r => idle(r, 800));
      if (disposed || giveUp) break;
      try { renderer.initTexture(t); } catch {}
    }
    if (!disposed && !giveUp) { await new Promise(r => idle(r, 800)); try { if (!G.shown) { renderer.render(scene, camera); renderer.clear(); } } catch {} }
    if (disposed || giveUp) { G.dispose(); gl = null; return; }

    // ---- estado de la animación ----
    let last = 0, t = 0, beat = 0, sweep = 0, line = 0, open = 0, energyK = 0;
    let lowWin = 0, highWin = 0, downAt = 0, upAt = 0, noUpUntil = 0, winT0 = 0, winFrames = 0, warm = 0, measureAt = 0, hooked = null, unBeat = null;
    // ?hgpu=1: tiempo de GPU del cuadro (EXT_disjoint_timer_query_webgl2) en api.gpuMs, para medir sin el ruido de la CPU
    const gpuT = QS.has('hgpu') ? (() => {
      const g2 = renderer.getContext(), ext = g2.getExtension('EXT_disjoint_timer_query_webgl2');
      if (!ext) { api.gpuMs = 'sin EXT_disjoint_timer_query_webgl2'; return null; }
      const pend = [], samples = []; let cur = null;
      return {
        begin() { if (pend.length < 4) { cur = g2.createQuery(); g2.beginQuery(ext.TIME_ELAPSED_EXT, cur); } },
        end() {
          if (cur) { g2.endQuery(ext.TIME_ELAPSED_EXT); pend.push(cur); cur = null; }
          while (pend.length && g2.getQueryParameter(pend[0], g2.QUERY_RESULT_AVAILABLE)) {
            const q = pend.shift();
            if (!g2.getParameter(ext.GPU_DISJOINT_EXT)) {
              samples.push(g2.getQueryParameter(q, g2.QUERY_RESULT) / 1e6);
              if (samples.length > 60) samples.shift();
              const s = [...samples].sort((a, b) => a - b);
              api.gpuMs = { min: +s[0].toFixed(2), med: +s[s.length >> 1].toFixed(2), n: s.length };
            }
            g2.deleteQuery(q);
          }
        },
      };
    })() : null;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 }, eye = { x: 0, y: 0, init: false };
    let gyro0 = null;
    const onPtr = e => { if (e.pointerType !== 'mouse') return; ptr.tx = clamp((e.clientX / innerWidth - 0.5) * 2, -1, 1); ptr.ty = clamp((e.clientY / innerHeight - 0.5) * 2, -1, 1); };
    const onGyro = e => {
      if (e.beta == null || e.gamma == null) return;
      if (!gyro0) gyro0 = { b: e.beta, g: e.gamma };
      gyro0.b += (e.beta - gyro0.b) * 0.008; gyro0.g += (e.gamma - gyro0.g) * 0.008;
      ptr.tx = clamp((e.gamma - gyro0.g) / 22, -1, 1); ptr.ty = clamp((e.beta - gyro0.b) / 22, -1, 1);
    };
    addEventListener('pointermove', onPtr, { passive: true });
    addEventListener('deviceorientation', onGyro, { passive: true });
    const hookMusic = () => {
      const m = window.__inv?.music;
      if (!m || hooked === m || typeof m.onBeat !== 'function') return;
      hooked = m;
      try { unBeat?.(); } catch {}
      try { unBeat = m.onBeat((i, time, info) => { const s = info?.strength ?? 0.6; beat = Math.max(beat, (info?.downbeat ? 0.55 : 0.32) + 0.45 * s); }); } catch {}
    };

    let visFor = 0;
    // AJUSTES (hallazgo 48, iOS en modo de bajo consumo: rAF a 30 Hz): ritmo FIJO de ~33 ms ≠ GPU lenta (criterio de
    // cap30() en scroll3d.js); sin esto bajaba el nivel (menos flores, foto más blanda) sin necesidad
    const dts = new Float32Array(64); let dtN = 0;
    const cap30 = () => {
      const n = Math.min(dtN, 64);
      if (n < 40) return false;
      const a = Array.from(dts.subarray(0, n)).sort((x, y) => x - y);
      const med = a[n >> 1], p90 = a[Math.floor(n * 0.9)];
      return med > 0.031 && med < 0.0355 && p90 < 0.038;
    };
    const targetFromScroll = vh => {
      const frameTopV = L.wrapDocTop - scrollY + L.fcy - L.fh / 2;
      return clamp((vh - frameTopV) / (0.38 * vh + L.fh / 2));   // 0: asoma por abajo · 1: la foto entera a la vista
    };

    const frame = now => {
      raf = 0;
      if (!running) return;
      if (giveUp) { running = false; return; }   // se pasó a la imagen (WebGL tardó o se perdió el contexto)
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      if (last && now - last > 0 && now - last < 200) dts[(dtN++) & 63] = (now - last) / 1000;
      last = now; t += dt;
      // medida de respaldo cada ~0.5 s (por si el layout de arriba cambió)
      if (now - measureAt > 500) {
        measureAt = now;
        const wr = wrap.getBoundingClientRect();
        if (Math.abs(wr.top + scrollY - L.wrapDocTop) > 0.5 || Math.abs(wr.height - L.H) > 0.5 || Math.abs(wr.width - L.W) > 0.5) layout();
        hookMusic();
        publish();
      }
      const vw = docEl.clientWidth, vh = innerHeight;
      // progreso: ligado al scroll, suavizado y con velocidad máxima (siempre se ve formarse)
      // FIX: además del scroll, el tiempo: con la foto ≥ 70 % a la vista durante 2.5 s se termina de formar aunque el
      // invitado no siga bajando (antes quedaba a medio formar con las caras en mosaico mientras no se moviera)
      {
        const ft = L.wrapDocTop - scrollY + L.fcy - L.fh / 2, fb = ft + L.fh;
        const frac = L.fh > 0 ? (Math.min(vh, fb) - Math.max(0, ft)) / L.fh : 0;
        visFor = frac >= 0.7 ? visFor + dt : 0;
      }
      const target = forced ?? Math.max(targetFromScroll(vh), Math.min(1, visFor / 2.5));
      G.target = target;
      const diff = target - G.prog;
      const step = diff * (1 - Math.exp(-dt * 4.2));
      const maxUp = dt * 0.62, maxDown = dt * 0.9;
      G.prog = clamp(G.prog + clamp(step, -maxDown, maxUp));
      if (Math.abs(target - G.prog) < 0.0005) G.prog = target;
      const doneT = G.prog > 0.985 ? 1 : G.prog < 0.93 ? 0 : G.done > 0.5 ? 1 : 0;
      G.done += (doneT - G.done) * (1 - Math.exp(-dt * (doneT ? 1.5 : 3.2)));
      if (G.done < 0.002 && !doneT) G.done = 0;
      // destello dorado: una sola pasada al completarse
      if (doneT && G.done > 0.08 && sweep === 0) sweep = 0.0001;
      if (sweep > 0 && sweep < 1) sweep = Math.min(1, sweep + dt / 1.7);
      if (!doneT && G.done < 0.05) sweep = 0;
      line = clamp(line + (clamp(G.prog * 1.6) - line) * (1 - Math.exp(-dt * 3)));
      open += (clamp((G.prog - 0.45) / 0.55) * 0.85 + 0.15 * G.done - open) * (1 - Math.exp(-dt * 2.2));
      beat *= Math.exp(-dt * 4.5);
      // energía de la canción: respiración muy leve de la luz
      try { const en = hooked?.getEnergy?.(); if (en) energyK += ((en.rms || 0) - energyK) * (1 - Math.exp(-dt * 3)); } catch {}

      // cámara de ventana: ojo en el centro de la pantalla (+ mouse/giroscopio), proyección fuera de eje anclada al lienzo
      ptr.x += (ptr.tx - ptr.x) * (1 - Math.exp(-dt * 3)); ptr.y += (ptr.ty - ptr.y) * (1 - Math.exp(-dt * 3));
      const wrapTopV = L.wrapDocTop - scrollY;
      const vcx = vw / 2 - L.wrapLeft, vcy = vh / 2 - wrapTopV;
      let ex = vcx - L.fcx + ptr.x * 0.13 * vw, ey = L.fcy - vcy - ptr.y * 0.1 * vh;
      if (!eye.init) { eye.x = ex; eye.y = ey; eye.init = true; }
      eye.x += (ex - eye.x) * (1 - Math.exp(-dt * 10)); eye.y += (ey - eye.y) * (1 - Math.exp(-dt * 10));
      const D = clamp(vh * 1.12, 640, 1400);
      const xL = -L.fcx, xR = L.W - L.fcx, yT = L.fcy, yB = L.fcy - L.H, n = 12, f = D + 3000;
      camera.position.set(eye.x, eye.y, D);
      camera.updateMatrixWorld();
      camera.projectionMatrix.makePerspective((xL - eye.x) * n / D, (xR - eye.x) * n / D, (yT - eye.y) * n / D, (yB - eye.y) * n / D, n, f);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

      // uniformes
      const inFlight = clamp(Math.sin(Math.PI * clamp(G.prog)) * 1.4) * (1 - G.done);
      shared.uTime.value = t; shared.uProg.value = G.prog; shared.uDone.value = G.done; shared.uBeat.value = beat; shared.uD.value = D;
      shared.uEye.value.set(eye.x, eye.y, D);
      pMat.uniforms.uS.value = Math.sqrt(1.1427 * L.fw * L.fw / (TIERS[maxTier].n * 0.78)) * G.sizeK;
      pMat.uniforms.uLod.value = photoImg.naturalWidth / (L.fw * CROP.sx > 0 ? L.fw / CROP.sx : L.fw);
      const fu = fMat.uniforms;
      fu.uPhotoA.value = smooth(clamp(G.done * 1.15));
      fu.uLine.value = line; fu.uSweep.value = sweep; fu.uFill.value = clamp(G.prog * 3) * (1 - G.done) * 0.9;
      fu.uLift.value = beat * 0.035 + energyK * 0.03;
      bMat.uniforms.uOpen.value = open; bMat.uniforms.uAlpha.value = clamp(G.prog * 2.2);
      const petA = clamp(G.prog * 2.5) * (0.55 + 0.45 * inFlight);
      for (const pp of [petBack, petFront]) { pp.mesh.material.uniforms.uAlpha.value = petA * (pp.front ? 0.9 : 0.8); pp.mesh.material.uniforms.uGust.value = inFlight; }
      dustBack.obj.material.uniforms.uAlpha.value = clamp(G.prog * 2) * 0.9;
      dustFront.obj.material.uniforms.uAlpha.value = clamp(G.prog * 2) * 0.75;

      if (gpuT) gpuT.begin();
      renderer.render(scene, camera);
      if (gpuT) gpuT.end();
      if (!G.shown) {
        G.shown = true;
        // el lienzo ya pintó: oculta el marco del HTML (sin hueco)
        root.classList.add('is-gl'); root.classList.remove('h3d-wait');
        api.mode = 'gl'; api.ready = true;
      }
      api.progress = G.prog; api.done = G.done;

      // fps y calidad automática (ventanas de 1.2 s, tras 2 s de calentamiento). Mientras el pergamino 3D de arriba sigue
      // en pantalla, la lentitud es suya: no se baja la calidad de las flores por eso. Sube de nuevo si sobra margen.
      winFrames++;
      if (!winT0) winT0 = now;
      if (now - winT0 > 1200) {
        const fps = winFrames * 1000 / (now - winT0);
        api.fps = Math.round(fps * 10) / 10;
        winT0 = now; winFrames = 0; warm++;
        if (warm > 1 && !G.locked) {
          const lim = cap30() ? 26 : (narrow ? 38 : 48);
          const busy = !!window.__inv?.shell?.state?.parchVisible;
          if (fps < lim && tier > 0 && !busy) {
            if (++lowWin >= 3) {
              if (now - upAt < 4000) noUpUntil = now + 30000;   // subió y no aguantó: no reintentar por un rato
              G.setTier(tier - 1); lowWin = 0; warm = 0; downAt = now;
            }
          } else lowWin = 0;
          if (fps > 57 && tier < maxTier && !busy && now - downAt > 5000 && now > noUpUntil) {
            if (++highWin >= 3) { G.setTier(tier + 1); highWin = 0; warm = 0; upAt = now; }
          } else highWin = 0;
        }
      }
    };
    const start = () => {
      if (running || disposed || document.hidden || !G.visible) return;
      running = true; last = 0; winT0 = 0; winFrames = 0; warm = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    // al llegar ya con la foto en pantalla (recarga a media página): se arma ya formada
    {
      const tg = forced ?? targetFromScroll(innerHeight);
      if (tg > 0.98) { G.prog = 1; G.done = 1; line = 1; open = 1; sweep = 1; }
    }
    const vis = new IntersectionObserver(es => {
      for (const e of es) G.visible = e.isIntersecting;
      if (G.visible) start(); else stop();
    }, { rootMargin: '60px 0px 60px 0px' });
    vis.observe(root);
    const onVis = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', onVis);
    const ro = new ResizeObserver(() => { layout(); });
    ro.observe(root); ro.observe(frameEl);
    const onResize = () => layout();
    addEventListener('resize', onResize, { passive: true });
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); stop(); api.error = 'contexto WebGL perdido'; useImg(); }, false);
    cleanups.push(() => {
      vis.disconnect(); ro.disconnect(); stop();
      removeEventListener('pointermove', onPtr); removeEventListener('deviceorientation', onGyro); removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      try { unBeat?.(); } catch {}
    });
    api.mode = 'gl-ready';
  }
}

// Montaje automático (una sola vez) cuando el DOM está listo
if (typeof document !== 'undefined' && !window.__historia3d) {
  window.__historia3d = true;
  const go = () => mountHistoria(document.getElementById('historia'));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true }); else go();
}
