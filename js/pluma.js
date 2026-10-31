// js/pluma.js — PLUMA-WEB · la pluma de ave VISIBLE que escribe el pergamino (SPEC.md, decisión n.º 5).
// pluma.glb + tintero.glb (BL-PLUMA, Blender). La punta sigue EXACTAMENTE el recorrido de la escritura por trazos de parchment.js
// (getPenAt) mientras la pluma está apoyada, en mundo vía parchment.group.matrixWorld. Una mano invisible de diestro la sostiene:
// ~50° sobre el papel, el cuerpo se alza hacia la derecha por encima del papel EN BLANCO (no tapa lo ya escrito: renglones de
// arriba y lo escrito a la izquierda de la punta), los dedos hacen pivotar la pluma con cada trazo
// mientras la mano se desliza suave por el renglón, se levanta entre trazos, se anticipa al siguiente (ventana adelantada) y
// tiembla apenas (temblor fisiológico ~9 Hz + respiración). Sale del tintero al empezar, MOJA en los remojos del guion
// (writing.dips: vuelve al tintero, entra en la tinta, escurre en el borde y regresa) y vuelve al tintero al terminar.
// Sombra suave proyectada sobre el papel y sobre la mesa (franja de 4 columnas cuya penumbra crece con la altura; sin mapas de
// sombras ni cubemaps), sombra de contacto del tintero, destello de tinta húmeda en la punta y ondas en la tinta al mojar.
// Raspado de pluma: llama a music.sfx.quill(intensidad) solo con la canción sonando (ver js/music.js).
//
// ─────────────────────────────── CONTRATO ───────────────────────────────
//   import { createQuill } from './pluma.js';
//   const quill = await createQuill({
//     THREE, parchment,            // parchment = await createParchment(...) (necesita getPenAt / writing)
//     reducedMotion?: false,       // true → la pluma queda quieta en el tintero (sin viaje ni sonido)
//     quality?: 0..4,              // como los niveles de scroll3d (0 máx.). Por defecto: táctil 3, escritorio 1.
//                                  //   0–2: brillo sedoso en las barbas y capa brillante en el cañón · 3: sin ellos · 4: sin ondas ni
//                                  //   sombra en la mesa, franja de sombra más corta. El vidrio es siempre el barato (sin pase de
//                                  //   transmisión) salvo glass: 'transmission' con quality 0 (+9–15 ms de GPU: no recomendado)
//     glass?: 'simple',            // 'transmission' = vidrio físico de BL-PLUMA (solo con quality 0; caro)
//     music?,                      // objeto de main.js (__inv.music / song). Usa music.sfx.quill(x) si existe y music.playing.
//     light?,                      // Object3D o Vector3 (mundo): la luz clave para la sombra proyectada (p. ej. el SpotLight de la vela)
//     hand?: { azimuth?: -0.42, azimuthPortrait?: -0.8, elevation?: 0.87, roll?: -0.45 }, // rad: rumbo en el papel desde +X hacia +Y
//                                  //   (apaisado / vertical según state.camera.aspect), inclinación sobre el papel, giro sobre su eje
//     base?: 'assets/models/',     // carpeta de los GLB (por defecto, relativa a este archivo)
//     loader?,                     // GLTFLoader propio (opcional)
//   });
//   scene.add(quill.group, quill.inkwell);      // los dos en coordenadas de MUNDO (hijos de la escena; otro padre también vale)
//   quill.inkwell.position.set(x, 0, z);        // sobre la mesa: y = altura de la mesa; rotation.y libre (la bisagra mira a −Z local,
//                                               // la pluma en reposo se recuesta hacia +X local)
//   // cada cuadro, DESPUÉS de mover el rig del pergamino y de parchment.setWriting(wt):
//   quill.update(dt, time, wt, { phase, camera?, light?, rate? });
//
//   update(dt: s reales, time: s (reloj continuo), writingT: 0..1 (el mismo valor de parchment.setWriting), state)
//     state.phase (o state como string):
//       'rest'  (o las de scroll3d 'idle','crack','break','untie','lift')  → la pluma descansa en el tintero (o vuelve a él)
//       'ready' (o 'unroll')  → sale del tintero y espera suspendida sobre el primer trazo (tarda quill.leadTime ≈ 1.45 s)
//       'write'               → escribe siguiendo writingT; al terminar el último trazo vuelve sola al tintero
//       'done'  (o 'open')    → vuelve al tintero y descansa
//     state.camera  (recomendado): su aspect elige el rumbo (vertical: la pluma baja más y cabe en cuadro); baja la inclinación si el
//                   extremo se acerca demasiado a la cámara; en el remojo las barbas miran a la cámara; el destello húmedo la busca
//     state.light   (opcional): igual que opts.light, por cuadro
//     state.rate    (opcional): s naturales de escritura por s real; si falta se estima de writingT
//   Si writingT avanza sin la fase 'ready' previa, la pluma despega rápido y alcanza la punta en vuelo (sin saltos).
//   Scroll rápido: la punta se clava al guion mientras su velocidad < 2.2 m/s; por encima lo alcanza con un resorte crítico
//   (50 ms) y vuelve a clavarse; la mano se vuelve más ágil (filtros ∝ velocidad^-0.7); el giro nunca pasa de ~430°/s.
//
//   Devuelve { group, inkwell, update, dispose, setQuality(n), quality, setReducedMotion(on), reset() (a su reposo al instante),
//              setMusic(m) (si la música se crea después), setShadow(k 0..2) (intensidad de la sombra proyectada; opts.shadow = false → 0),
//              rateCap(t 0..1) → número: velocidad máxima (s naturales / s reales) que mantiene natural la mano en ese instante
//                 (1 en los remojos y en cambios de renglón largos, 6 en el resto): la escena DEBE acotar con min(suTope, rateCap)
//                 para que el remojo se vea a velocidad natural,
//              ready (true cuando la pluma ya espera sobre el primer trazo o está escribiendo: la escena puede retener wt = 0
//                 hasta entonces), mode ('rest'|'takeoff'|'hover'|'write'|'return'), dipping (0..1 progreso del remojo o 0),
//              leadTime (s), tip (Vector3 mundo de la punta, solo lectura), wet (0..1), rate (velocidad estimada), debug }
//   La sombra sobre el papel es un hijo de parchment.group (se crea y se quita aquí). dispose() libera todo.
//   Medidas: punta = origen local de la pluma, eje +Y, largo 0.3177 m; tintero Ø 0.056 m, boca en y 0.0466, tinta en y 0.0272.

import { DIMENSIONS } from './parchment.js';

// ───────────────────────────── utilidades ─────────────────────────────
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const minJerk = (t) => { t = clamp(t); return t * t * t * (10 + t * (-15 + 6 * t)); };
const seg = (k, a, b) => clamp((k - a) / (b - a));
const TAU2 = Math.PI * 2;

const PHASES = { rest: 'rest', idle: 'rest', crack: 'rest', break: 'rest', untie: 'rest', lift: 'rest', closed: 'rest', reset: 'rest',
  ready: 'ready', unroll: 'ready', write: 'write', writing: 'write', done: 'done', open: 'done' };

const GRIP = 0.05;            // m: distancia punta → pivote de los dedos
const LAG_K = 0.5;            // fracción del movimiento fino que hacen los dedos (la mano hace el resto)
const LAG_MAX = 0.0065;       // m: pivote máximo (≈ 7°)
const V_UNLOCK = 2.2;         // m/s
const TAU_CATCH = 0.05;       // s
const W_MAX = 7.5;            // rad/s: velocidad angular máxima de la pluma
const CAP_MAX = 6;
const V_AIR = 1.0;            // m/s: velocidad cómoda de la mano en el aire (para rateCap)
const LEAD_S = 1.45;          // s: despegue desde el tintero hasta quedar suspendida sobre el primer trazo
const RETURN_S = 1.6;

const QLV = [
  { glass: 'simple', sheen: true, ripples: true, rows: 22, table: true },
  { glass: 'simple', sheen: true, ripples: true, rows: 22, table: true },
  { glass: 'simple', sheen: true, ripples: true, rows: 18, table: true },
  { glass: 'simple', sheen: false, ripples: true, rows: 16, table: true },
  { glass: 'simple', sheen: false, ripples: false, rows: 12, table: false },
];

// la franja se acerca uPull metros a la cámara A LO LARGO DEL RAYO de vista: en pantalla queda exactamente donde estaba (sin
// paralaje), pero gana la prueba de profundidad contra el relieve del papel (cockling, comba y respiración de parchment.js: ±2–3 mm)
const VS_STRIP = /* glsl */`
uniform float uPull; attribute vec2 aE; varying vec2 vE; varying vec3 vP;
void main(){ vE = aE; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xyz *= 1.0 - uPull / max(length(mv.xyz), 0.02); gl_Position = projectionMatrix * mv; }`;
const FS_STRIP_PAPER = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform vec4 uClip; varying vec2 vE; varying vec3 vP;
void main(){
  float e = smoothstep(0.0, 1.0, vE.x);
  float c = smoothstep(uClip.x, uClip.x + 0.004, vP.x) * (1.0 - smoothstep(uClip.y - 0.004, uClip.y, vP.x))
          * smoothstep(uClip.z, uClip.z + 0.004, vP.y) * (1.0 - smoothstep(uClip.w - 0.004, uClip.w, vP.y));
  float a = e * vE.y * c * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}`;
const FS_STRIP_TABLE = /* glsl */`
uniform vec3 uColor; uniform float uOpacity; uniform vec4 uClip; varying vec2 vE; varying vec3 vP;
void main(){
  float e = smoothstep(0.0, 1.0, vE.x);
  float r = length(vP.xz - uClip.xy);
  float a = e * vE.y * (1.0 - smoothstep(uClip.z, uClip.w, r)) * uOpacity;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}`;
const FS_RIPPLE = /* glsl */`
uniform vec4 uAge; uniform vec2 uC; uniform vec3 uColor; varying vec2 vUv2;
float ring(float r, float age){
  if (age < 0.0 || age > 1.6) return 0.0;
  float R = 0.0012 + 0.021 * pow(age, 0.75);
  float w = 0.0007 + 0.0012 * age;
  return exp(-pow((r - R) / w, 2.0)) * exp(-2.4 * age);
}
void main(){
  float r = length(vUv2 - uC);
  float s = ring(r, uAge.x) + 0.6 * ring(r, uAge.x - 0.13) + ring(r, uAge.y) + 0.6 * ring(r, uAge.y - 0.13) + ring(r, uAge.z);
  s *= 1.0 - smoothstep(0.0125, 0.0162, length(vUv2));
  if (s < 0.004) discard;
  gl_FragColor = vec4(uColor * s, 1.0);
}`;
const VS_RIPPLE = /* glsl */`varying vec2 vUv2; void main(){ vUv2 = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function radialCanvas(stops, n = 64, opaque = false) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  if (opaque) { g.fillStyle = '#000'; g.fillRect(0, 0, n, n); }   // alphaMap: el valor va en RGB (canal G), no en el alfa
  g.fillStyle = gr; g.fillRect(0, 0, n, n); return c;
}

// ───────────────────────────── API ─────────────────────────────
export async function createQuill(opts = {}) {
  const THREE = opts.THREE;
  if (!THREE) throw new Error('createQuill: falta opts.THREE');
  const P = opts.parchment;
  if (!P || typeof P.getPenAt !== 'function' || !P.writing) throw new Error('createQuill: falta opts.parchment (createParchment con getPenAt)');
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  let qLevel = Number.isInteger(opts.quality) ? clamp(opts.quality, 0, 4) : coarse ? 3 : 1;
  let Q = QLV[qLevel];
  let reduced = !!opts.reducedMotion;
  let music = opts.music || null;
  const base = opts.base ?? new URL('../assets/models/', import.meta.url).href;
  let loader = opts.loader;
  if (!loader) { const m = await import('three/addons/loaders/GLTFLoader.js'); loader = new m.GLTFLoader(); }
  const [gp, gt] = await Promise.all([loader.loadAsync(base + 'pluma.glb'), loader.loadAsync(base + 'tintero.glb')]);
  const pluma = gp.scene.getObjectByName('Pluma');
  const tintero = gt.scene.getObjectByName('Tintero');
  if (!pluma || !tintero) throw new Error('createQuill: pluma.glb / tintero.glb sin los nodos Pluma / Tintero');
  const exP = pluma.userData || {}, exT = tintero.userData || {};
  const LEN = exP.largo_total || 0.3177;
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const Q4 = () => new THREE.Quaternion();

  // ── jerarquía: group (pluma, mundo) y inkwell (tintero, mundo)
  const group = new THREE.Group(); group.name = 'pluma_rig';
  pluma.removeFromParent(); pluma.position.set(0, 0, 0); pluma.quaternion.identity(); group.add(pluma);
  const inkwell = new THREE.Group(); inkwell.name = 'tintero_rig';
  tintero.removeFromParent(); tintero.position.set(0, 0, 0); tintero.quaternion.identity(); inkwell.add(tintero);
  const tapa = tintero.getObjectByName('tintero_tapa');
  if (tapa && exT.bisagra?.abierta_rad != null) tapa.rotation.x = exT.bisagra.abierta_rad;

  // ── materiales
  const owned = [];   // recursos a liberar
  const mats = {};
  const maxAniso = 8;
  for (const root of [pluma, tintero]) root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false; o.receiveShadow = true;
    const m = o.material; mats[m.name] = mats[m.name] || m;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) { m[k].anisotropy = Math.min(maxAniso, m[k].anisotropy || maxAniso); owned.push(m[k]); }
    owned.push(o.geometry, m);
  });
  // latón y tapa sí proyectan en el mapa de sombras de la escena (piezas pequeñas y opacas)
  tintero.traverse((o) => { if (o.isMesh && /laton/i.test(o.material.name)) o.castShadow = true; });
  if (tapa) tapa.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const barbs = pluma.getObjectByName('pluma_barbas'); const canon = pluma.getObjectByName('pluma_canon');
  const nibInk = pluma.getObjectByName('pluma_tinta');
  if (barbs) {
    const m = barbs.material; m.alphaToCoverage = true; m.color.setRGB(0.97, 0.91, 0.82);
    // translucidez de las barbas y del plumón (tarjetas finas): a contraluz no se ven negras/azules sino cálidas, como pluma real
    m.emissive = new THREE.Color(0.25, 0.19, 0.125); if (m.map) m.emissiveMap = m.map; m.emissiveIntensity = 1;
    m.needsUpdate = true;
  }
  // cañón y raquis de queratina: brillo de capa (clearcoat) en calidad alta; en baja, el material estándar del GLB
  const canonStd = canon?.material || null;
  let canonGloss = null;
  const mkGloss = () => {
    if (canonGloss || !canonStd) return canonGloss;
    const c = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(c, canonStd); c.defines = { STANDARD: '', PHYSICAL: '' };
    c.clearcoat = 0.55; c.clearcoatRoughness = 0.28; c.name = 'pluma_canon_brillo';
    canonGloss = c; owned.push(c); return c;
  };
  const barbsStd = barbs?.material || null;
  let barbsSheen = null;
  const mkSheen = () => {
    if (barbsSheen || !barbsStd) return barbsSheen;
    const s = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(s, barbsStd);   // copia mapas, alphaTest, lado
    s.defines = { STANDARD: '', PHYSICAL: '' };                     // (la copia estándar los pisa)
    s.sheen = 0.4; s.sheenColor = new THREE.Color(0xf0e2c8); s.sheenRoughness = 0.5; s.alphaToCoverage = true; s.name = 'pluma_barbas_sheen';
    barbsSheen = s; owned.push(s); return s;
  };
  const glassMesh = tintero.getObjectByName('tintero_vidrio') || (() => { let g = null; tintero.traverse((o) => { if (o.isMesh && /vidrio/i.test(o.material.name)) g = o; }); return g; })();
  const glassPhys = glassMesh?.material || null;
  let glassSimple = null;
  const mkGlassSimple = () => {
    if (glassSimple) return glassSimple;
    const g = new THREE.MeshPhysicalMaterial({ name: 'vidrio_simple', color: 0xf4f8f3, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.2,
      ior: 1.52, specularIntensity: 1, envMapIntensity: 1.5, depthWrite: false });
    // vidrio grueso: los cantos (ángulo rasante) se ven más densos y verdosos, como el prensado real
    g.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `
        { float fr = pow(1.0 - saturate(abs(dot(normalize(normal), normalize(vViewPosition)))), 2.2);
          outgoingLight += vec3(0.010, 0.016, 0.012) * fr; diffuseColor.a = mix(diffuseColor.a, 0.62, fr); }
        #include <opaque_fragment>`);
    };
    g.customProgramCacheKey = () => 'pluma-vidrio-simple-v1';
    glassSimple = g; owned.push(g); return g;
  };
  function applyQuality() {
    Q = QLV[qLevel];
    // vidrio con transmisión física SOLO si se pide (opts.glass = 'transmission'): obliga a three a redibujar toda la escena opaca
    // en un pase extra (medido: +9.5 ms con el tintero en primer plano y +15 ms en plano general en Iris Xe) → por defecto, vidrio barato
    if (glassMesh) glassMesh.material = opts.glass === 'transmission' && qLevel === 0 && glassPhys ? glassPhys : mkGlassSimple();
    if (barbs && barbsStd) barbs.material = Q.sheen ? mkSheen() || barbsStd : barbsStd;
    if (canon && canonStd) canon.material = Q.sheen ? mkGloss() || canonStd : canonStd;
    if (ripple) ripple.visible = false;
    if (tableStrip) tableStrip.mesh.visible = Q.table;
  }

  // ── perfil de la silueta (de la geometría real) para la sombra proyectada
  const PROF_N = 22;
  const prof = (() => {
    const ys = []; for (let i = 0; i <= PROF_N; i++) ys.push(LEN * (i / PROF_N) ** 1.2);
    const B = ys.slice(0, -1).map(() => ({ x0: Infinity, x1: -Infinity, z: 0, n: 0, vane: 0 }));
    const v = new THREE.Vector3();
    pluma.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position; if (!pos) return;
      const isVane = o === barbs;
      o.updateMatrix();
      const step = Math.max(1, Math.floor(pos.count / 6000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrix);
        let b = 0; while (b < B.length - 1 && v.y > ys[b + 1]) b++;
        const s = B[b]; s.x0 = Math.min(s.x0, v.x); s.x1 = Math.max(s.x1, v.x); s.z += v.z; s.n++; if (isVane) s.vane++;
      }
    });
    const rows = [{ y: 0, x0: -0.0004, x1: 0.0004, z: 0, d: 1, r: 0.0004 }];
    B.forEach((s, i) => {
      if (!s.n) return;
      const y = (ys[i] + ys[i + 1]) / 2, vane = s.vane / s.n;
      const cx = (s.x0 + s.x1) / 2, hw = ((s.x1 - s.x0) / 2) * (vane > 0.5 ? 0.9 : 1);
      // zonas medidas en el GLB (extras): cañón hasta 0.072, plumón 0.063–0.10, barbas desde 0.083. Densidad de la sombra: cañón
      // opaco; plumón 0.16 (apenas vela); vexilo 0.3 (la luz pasa entre las barbas). r: radio del cuerpo redondo (cañón; más allá, el
      // raquis): su sombra mide 2r desde cualquier ángulo de luz (el ancho en X del plumón/vexilo puede verse de canto)
      const canonEnd = exP.canon?.fin_y ?? 0.072, downY = exP.barbas?.plumon_y ?? [0.063, 0.1], vaneY = exP.barbas?.inicio_y ?? 0.083;
      const isCanon = y < Math.min(canonEnd, downY[0]);
      const isDown = !isCanon && y < Math.max(vaneY, downY[1]);
      void vane;
      rows.push({ y, x0: isCanon ? cx - Math.min(0.0034, hw) : cx - hw, x1: isCanon ? cx + Math.min(0.0034, hw) : cx + hw, z: s.z / s.n,
        d: isCanon ? 0.85 : isDown ? 0.16 : 0.3, r: isCanon ? Math.min(0.0034, hw) : 0.0016 });
    });
    return rows;
  })();

  // ── franja de sombra proyectada (genérica: plano z = 0 del papel o plano y = 0 de la mesa)
  function makeStrip(kind, maxRows) {
    const R = maxRows + 2, nV = R * 4;
    const pos = new Float32Array(nV * 3), e = new Float32Array(nV * 2);
    const idx = [];
    for (let r = 0; r < R - 1; r++) for (let c = 0; c < 3; c++) { const a = r * 4 + c, b = a + 1, d = a + 4, f = d + 1; idx.push(a, d, b, b, d, f); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aE', new THREE.BufferAttribute(e, 2).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.035, 0.02, 0.012) }, uOpacity: { value: 0 }, uClip: { value: new THREE.Vector4(-1, 1, -1, 1) },
        uPull: { value: kind === 'paper' ? 0.0035 : 0.0012 } },
      vertexShader: VS_STRIP, fragmentShader: kind === 'paper' ? FS_STRIP_PAPER : FS_STRIP_TABLE,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.name = 'pluma_sombra_' + kind;
    owned.push(geo, mat);
    return { mesh, geo, mat, pos, e, R, kind };
  }
  const paperStrip = makeStrip('paper', PROF_N + 1);
  P.group.add(paperStrip.mesh);
  let tableStrip = makeStrip('table', PROF_N + 1);
  inkwell.add(tableStrip.mesh);
  tableStrip.mat.uniforms.uClip.value.set(0, 0, 0.16, 0.36);

  // sombra de contacto del tintero (disco radial, estática)
  const contactTex = new THREE.CanvasTexture(radialCanvas([[0, '#fff'], [0.5, '#d2d2d2'], [0.68, '#5a5a5a'], [1, '#000']], 64, true));
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.085), new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTex, transparent: true,
    opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.0004; contact.renderOrder = 1; contact.name = 'tintero_contacto';
  inkwell.add(contact); owned.push(contact.geometry, contact.material, contactTex);

  // ondas en la tinta del tintero
  let ripple = null;
  {
    const lvl = exT.tinta?.nivel_y ?? 0.0272;
    const g = new THREE.CircleGeometry(exT.tinta?.radio_pozo ?? 0.0165, 40); g.rotateX(-Math.PI / 2);
    const m = new THREE.ShaderMaterial({ uniforms: { uAge: { value: new THREE.Vector4(9, 9, 9, 9) }, uC: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0.26, 0.21, 0.16) } },
      vertexShader: VS_RIPPLE, fragmentShader: FS_RIPPLE, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    ripple = new THREE.Mesh(g, m); ripple.position.y = lvl + 0.00012; ripple.renderOrder = 4; ripple.visible = false; ripple.name = 'tintero_ondas';
    tintero.add(ripple); owned.push(g, m);
  }
  const rippleAges = [9, 9, 9]; let rippleNext = 0;
  function rippleAt(worldTip) {
    if (!Q.ripples || reduced) return;
    const loc = tintero.worldToLocal(_v.copy(worldTip));
    ripple.material.uniforms.uC.value.set(clamp(loc.x, -0.008, 0.008), clamp(loc.z, -0.008, 0.008));
    rippleAges[rippleNext] = 0; rippleNext = (rippleNext + 1) % 3;
  }

  // destello de tinta húmeda en la punta
  const glintTex = new THREE.CanvasTexture(radialCanvas([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,215,.75)'], [0.55, 'rgba(255,215,170,.12)'], [1, 'rgba(255,200,150,0)']], 32));
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, color: new THREE.Color(1.25, 1.05, 0.85), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0 }));
  glint.position.set(0, 0.0012, 0.0019); glint.scale.setScalar(0.0038); glint.renderOrder = 5; glint.name = 'pluma_destello';
  group.add(glint); owned.push(glint.material, glintTex);
  const nibMat = nibInk?.material || null;

  applyQuality();

  // ── reposo en el tintero (marco del tintero)
  const REST = exT.pose_pluma_reposo || { position: [-0.00849, 0.01325, 0.00711], quaternion: [-0.04283, 0.00872, -0.19928, 0.97897] };
  const restPl = V3().fromArray(REST.position), restQl = Q4().fromArray(REST.quaternion);
  const MOUTH = V3(...(exT.boca?.centro || [0, 0.0466, 0])); MOUTH.y += 0.0002;
  const DIPPT = V3(...(exT.punto_mojado || [0, 0.0232, 0]));
  const INK_Y = exT.tinta?.nivel_y ?? 0.0272;

  // ── guion de escritura
  const W = P.writing; const SEC = W.seconds || 21.89;
  const items = W.strokes?.items || [];
  const tFirst = items.length ? items[0].start : 0, tLast = items.length ? items[items.length - 1].end : 1;
  const tFirstS = tFirst * SEC, tEndS = tLast * SEC + 0.15;
  const dipsS = (W.dips || []).map((d) => ({ s: d.start * SEC, e: d.end * SEC, n0: d.start, n1: d.end }));
  // rumbo −0.42 rad: el cuerpo sale del papel (~50°) hacia la DERECHA y algo hacia abajo de la página → solo cubre papel en blanco
  // (lo ya escrito queda arriba y a la izquierda de la punta); giro −0.45 rad: las barbas se ven de tres cuartos.
  const TUNE = opts._tune || {};   // (ajuste fino para el banco de pruebas)
  const HAND = { az: opts.hand?.azimuth ?? -0.42, azP: opts.hand?.azimuthPortrait ?? opts.hand?.azimuth ?? -0.8,
    el: opts.hand?.elevation ?? 0.87, roll: opts.hand?.roll ?? -0.45 };
  // en pantallas verticales la pluma baja más (−46°): la pluma de 32 cm queda en cuadro y sobre papel en blanco
  const handAz = () => lerp(HAND.azP, HAND.az, sstep(0.62, 1.25, S.aspect));

  // copia de getPenAt (devuelve un objeto reutilizado)
  const mkPen = () => ({ pos: V3(), tx: 1, ty: 0, down: false, pressure: 0, lift: 1, dip: 0, speed: 0, gold: false, line: 0, stroke: -1 });
  function readPen(t, out) {
    const p = P.getPenAt(clamp(t));
    out.pos.copy(p.pos); out.tx = p.tangent.x; out.ty = p.tangent.y; out.down = !!p.down; out.pressure = p.pressure || 0; out.lift = p.lift || 0;
    out.dip = p.dip || 0; out.speed = p.speed || 0; out.gold = !!p.gold; out.line = p.lineIndex; out.stroke = p.strokeIndex;
    return out;
  }
  const pen = mkPen(), penA = mkPen(), penB = mkPen();
  // huecos entre trazos (para rateCap): duración natural y distancia
  const gaps = [];
  for (let i = 0; i + 1 < items.length; i++) {
    readPen(items[i].end - 1e-7, penA); readPen(items[i + 1].start + 1e-7, penB);
    gaps.push({ s: items[i].end * SEC, e: items[i + 1].start * SEC, d: Math.hypot(penB.pos.x - penA.pos.x, penB.pos.y - penA.pos.y) });
  }
  readPen(tFirst + 1e-7, penA);
  const firstLocal = penA.pos.clone();

  // ── estado
  const S = {
    mode: 'rest', modeT: 0, tip: V3(), q: Q4(), vel: V3(), locked: false,
    tgtP: V3(), tgtQ: Q4(), prevTgt: V3(), hasPrev: false,
    hand: new THREE.Vector2(), handV: new THREE.Vector2(), handInit: false, lag: new THREE.Vector2(), tan: new THREE.Vector2(1, 0), down: 0,
    rate: 1, lastTs: null, ts: 0, wet: 1, elAdj: 0, hoverT: 0, dipK: 0, aspect: 1.6,
    dip: { idx: -1, A: V3(), qA: Q4(), a1: 0.3, a4: 0.62, rippleIn: false, rippleOut: false, side: V3() },
    flight: null, settle: 0, snd: 0, sndT: 0, time: 0, shadowK: opts.shadow === false ? 0 : 1,
  };
  // temporales
  const _v = V3(), _v2 = V3(), _v3 = V3(), _b0 = V3(), _b1 = V3(), _b2 = V3(), _b3 = V3();
  const _X = V3(), _Y = V3(), _Z = V3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _qa = Q4(), _qb = Q4(), _s = V3(1, 1, 1);
  const paperQ = Q4(), nW = V3(), upW = V3(), lightW = V3(), mouthW = V3(), dipW = V3(), restP = V3(), restQ = Q4(), restAx = V3();
  const qDip = Q4(), camPos = V3(); let hasCam = false;

  function frames(state) {
    P.group.updateWorldMatrix(true, false); inkwell.updateWorldMatrix(true, true);
    P.group.getWorldQuaternion(paperQ);
    nW.set(0, 0, 1).applyQuaternion(paperQ).normalize();
    tintero.getWorldQuaternion(_qa); upW.set(0, 1, 0).applyQuaternion(_qa).normalize();
    mouthW.copy(MOUTH).applyMatrix4(tintero.matrixWorld);
    dipW.copy(DIPPT).applyMatrix4(tintero.matrixWorld);
    _m.compose(restPl, restQl, _s).premultiply(tintero.matrixWorld); _m.decompose(restP, restQ, _v);
    restAx.set(0, 1, 0).applyQuaternion(restQ);
    const L = state?.light ?? opts.light;
    if (L && L.isVector3) lightW.copy(L);
    else if (L && L.isObject3D) L.getWorldPosition(lightW);
    else lightW.set(-0.44, 0.58, 0.72).applyMatrix4(P.group.matrixWorld);
    const cam = state?.camera; hasCam = !!(cam && cam.isCamera);
    if (hasCam) { cam.getWorldPosition(camPos); if (cam.aspect > 0) S.aspect += (cam.aspect - S.aspect) * 0.2; }
  }
  const toWorld = (local, out) => out.copy(local).applyMatrix4(P.group.matrixWorld);

  // orientación de escritura (marco local del papel → mundo)
  function writeQuat(az, el, roll, lagX, lagY, out) {
    const ce = Math.cos(el);
    _Y.set(Math.cos(az) * ce, Math.sin(az) * ce, Math.sin(el)).multiplyScalar(TUNE.grip ?? GRIP);
    _Y.x += lagX; _Y.y += lagY; _Y.normalize();
    _Z.set(-_Y.z * _Y.x, -_Y.z * _Y.y, 1 - _Y.z * _Y.z).normalize();
    if (roll) _Z.applyAxisAngle(_Y, roll);
    _X.crossVectors(_Y, _Z);
    _m2.makeBasis(_X, _Y, _Z);
    out.setFromRotationMatrix(_m2);
    return out.premultiply(paperQ);
  }
  // borde superior del rollo (local): la pluma no lo atraviesa mientras se desenrolla
  const rollTopY = () => (DIMENSIONS.LfMin + (DIMENSIONS.LfMax - DIMENSIONS.LfMin) * clamp(P.u ?? 1, 0, 1.04)) / 2;

  // mano: filtra la punta (ventana adelantada = anticipa el trazo siguiente) y calcula pivote y orientación
  function handPose(dt, tipL, down, pressure, tx, ty, out) {
    const ts = S.ts, rateK = Math.pow(clamp(S.rate, 1, 8), 0.7);
    // ventana: 25 % atrás, 40 % ahora, 35 % adelante (≈ 60 ms naturales)
    readPen((ts - 0.04) / SEC, penA); readPen((ts + 0.06) / SEC, penB);
    let hx = 0.25 * penA.pos.x + 0.4 * tipL.x + 0.35 * penB.pos.x, hy = 0.25 * penA.pos.y + 0.4 * tipL.y + 0.35 * penB.pos.y;
    if (penA.dip > 0 || penB.dip > 0) { hx = tipL.x; hy = tipL.y; }
    if (!S.handInit) { S.hand.set(hx, hy); S.handV.set(0, 0); S.lag.set(0, 0); S.handInit = true; }
    const st = 0.085 / rateK, om = 2 / st, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    for (const k of ['x', 'y']) {
      const g = k === 'x' ? hx : hy; const ch = S.hand[k] - g, tmp = (S.handV[k] + om * ch) * dt;
      S.handV[k] = (S.handV[k] - om * tmp) * ex; S.hand[k] = g + (ch + tmp) * ex;
    }
    const LK = TUNE.lagK ?? LAG_K;
    let lx = (S.hand.x - tipL.x) * LK, ly = (S.hand.y - tipL.y) * LK;
    const ll = Math.hypot(lx, ly); if (ll > LAG_MAX) { lx *= LAG_MAX / ll; ly *= LAG_MAX / ll; }
    // el pivote de los dedos es más lento que la punta (la pluma no "zumba" con cada trazo de 25 ms)
    const kl = (TUNE.lagTau ?? 0.02) > 0 ? 1 - Math.exp(-dt / ((TUNE.lagTau ?? 0.02) / Math.sqrt(rateK))) : 1;
    S.lag.x += (lx - S.lag.x) * kl; S.lag.y += (ly - S.lag.y) * kl; lx = S.lag.x; ly = S.lag.y;
    // dirección del trazo suavizada (gira la pluma levemente)
    const kt = 1 - Math.exp(-dt * 25 * rateK);
    if (down) { S.tan.x += (tx - S.tan.x) * kt; S.tan.y += (ty - S.tan.y) * kt; }
    S.down += ((down ? 1 : 0) - S.down) * (1 - Math.exp(-dt * 30));
    const tl = Math.hypot(S.tan.x, S.tan.y) || 1, tux = S.tan.x / tl, tuy = S.tan.y / tl;
    const az0 = handAz(), hxD = Math.cos(az0), hyD = Math.sin(az0);
    const cross = hxD * tuy - hyD * tux, dot = hxD * tux + hyD * tuy;
    const t = S.time;
    const trem = reduced ? 0 : 1;
    const az = az0 + 0.05 * cross * S.down + trem * (0.018 * Math.sin(TAU2 * 0.23 * t + 1.1) + 0.0009 * Math.sin(TAU2 * 9.6 * t + 0.6));
    // cerca del rollo superior, un poco más erguida (el cañón pasa por encima del rollo)
    const nearTop = sstep(0.05, 0.018, rollTopY() - tipL.y);
    const el = HAND.el + S.elAdj + 0.12 * nearTop - 0.055 * pressure + trem * (0.012 * Math.sin(TAU2 * 0.31 * t + 0.4) + 0.0008 * Math.sin(TAU2 * 8.7 * t) + 0.0006 * Math.sin(TAU2 * 11.3 * t + 1.7));
    const roll = HAND.roll + 0.06 * dot * S.down;
    return writeQuat(az, el, roll, lx, ly, out);
  }
  // destino "suspendida sobre el primer trazo"
  const hoverLocal = V3();
  function hoverTarget(dt, outP, outQ) {
    const t = S.time, k = sstep(0, 0.9, S.hoverT);
    let lift = lerp(0.012, 0.0032, k);
    const clear = 1 - sstep(-0.004, 0.026, rollTopY() - firstLocal.y);   // el rollo aún no pasó: por encima de él
    lift = Math.max(lift, 0.046 * clear);
    hoverLocal.copy(firstLocal);
    if (!reduced) { hoverLocal.x += 0.0007 * Math.cos(TAU2 * 0.8 * t) * k; hoverLocal.y += 0.0005 * Math.sin(TAU2 * 0.8 * t) * k; }
    hoverLocal.z += lift;
    toWorld(hoverLocal, outP);
    handPose(dt, hoverLocal, false, 0, 1, 0, outQ);
  }

  // orientación para mojar: el eje se inclina ~22° hacia el lado de la mano (el mismo hacia el que apunta al escribir: menos giro
  // y la mano no "se da la vuelta"); la punta entra desplazada al lado opuesto para que el cañón pase holgado por la boca (r 9.2 mm)
  const DIP_TILT = 0.38;
  const leanW = V3();
  function setLean(qFrom) {
    leanW.set(0, 1, 0).applyQuaternion(qFrom); leanW.addScaledVector(upW, -leanW.dot(upW));
    if (leanW.lengthSq() < 1e-6) { if (hasCam) leanW.copy(camPos).sub(mouthW); else leanW.copy(nW); leanW.addScaledVector(upW, -leanW.dot(upW)); }
    if (leanW.lengthSq() < 1e-8) leanW.set(1, 0, 0);
    leanW.normalize();
  }
  function dipQuat(out) {
    _Y.copy(upW).multiplyScalar(Math.cos(DIP_TILT)).addScaledVector(leanW, Math.sin(DIP_TILT)).normalize();
    if (hasCam) _Z.copy(camPos).sub(mouthW); else _Z.copy(nW);
    _Z.addScaledVector(_Y, -_Z.dot(_Y)); if (_Z.lengthSq() < 1e-8) _Z.copy(leanW); _Z.normalize();
    _X.crossVectors(_Y, _Z);
    _m2.makeBasis(_X, _Y, _Z);
    return out.setFromRotationMatrix(_m2);
  }
  const bez = (out, p0, p1, p2, p3, t) => {
    const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return out.set(p0.x * a + p1.x * b + p2.x * c + p3.x * d, p0.y * a + p1.y * b + p2.y * c + p3.y * d, p0.z * a + p1.z * b + p2.z * c + p3.z * d);
  };
  // punta dentro de la tinta (al lado opuesto de la inclinación) y puntos a lo largo del eje inclinado (entra y sale por el eje)
  function inkTip(out) { return out.copy(dipW).addScaledVector(leanW, -0.0052); }
  function alongAxis(qd, d, out) { _v.set(0, 1, 0).applyQuaternion(qd); return inkTip(out).addScaledVector(_v, d); }

  // remojo: k 0..1 dentro de writing.dips[idx]
  const dipD = V3(), qD = Q4();
  function dipTarget(dt, k, outP, outQ) {
    const D = S.dip;
    // destino al final del remojo: la pluma en el aire sobre el trazo siguiente (mano viva)
    toWorld(pen.pos, dipD); handPose(dt, pen.pos, false, 0, pen.tx, pen.ty, qD);
    dipQuat(qDip);
    const a1 = D.a1, a4 = D.a4, mid = a4 - a1, a2 = a1 + 0.3 * mid, a3 = a1 + 0.62 * mid;
    alongAxis(qDip, 0.06, _b3);                 // suspendida sobre la boca, en el eje inclinado
    if (k < a1) {                               // vuelo papel → tintero (el giro se reparte en todo el vuelo)
      const u = k / a1, e = minJerk(u);
      _b1.copy(D.A).addScaledVector(nW, 0.035).addScaledVector(upW, 0.012);
      _v2.set(0, 1, 0).applyQuaternion(qDip); _b2.copy(_b3).addScaledVector(_v2, 0.05);
      bez(outP, D.A, _b1, _b2, _b3, e);
      outQ.slerpQuaternions(D.qA, qDip, sstep(0, 1, u * 0.85 + e * 0.15));
    } else if (k < a2) {                        // entra en la tinta a lo largo del eje
      const e = minJerk(seg(k, a1, a2));
      inkTip(_b2);
      outP.lerpVectors(_b3, _b2, e); outQ.copy(qDip);
      if (!D.rippleIn && outP.dot(upW) - mouthW.dot(upW) < INK_Y - MOUTH.y + 0.001) { D.rippleIn = true; rippleAt(outP); }
    } else if (k < a3) {                        // dentro: un leve vaivén
      const e = seg(k, a2, a3);
      inkTip(_b2); _v2.set(0, 1, 0).applyQuaternion(qDip);
      outP.copy(_b2).addScaledVector(_v2, 0.0007 * Math.sin(Math.PI * e * 2)); outQ.copy(qDip);
    } else if (k < a4) {                        // sale y escurre contra el borde del lado de la mano
      const e = seg(k, a3, a4), ee = minJerk(e);
      inkTip(_b2); alongAxis(qDip, 0.036, _b1);
      outP.lerpVectors(_b2, _b1, ee);
      outP.addScaledVector(leanW, 0.0026 * Math.sin(Math.PI * sstep(0.4, 1, e)));
      outQ.copy(qDip);
      if (!D.rippleOut && e > 0.25) { D.rippleOut = true; rippleAt(outP); S.wet = 1; }
    } else {                                    // vuelo tintero → trazo siguiente
      const u = seg(k, a4, 1), e = minJerk(u);
      alongAxis(qDip, 0.036, _b0);
      _v2.set(0, 1, 0).applyQuaternion(qDip);
      _b1.copy(_b0).addScaledVector(_v2, 0.05);
      _b2.copy(dipD).addScaledVector(nW, 0.035);
      bez(outP, _b0, _b1, _b2, dipD, e);
      outQ.slerpQuaternions(qDip, qD, sstep(0, 1, u * 0.85 + e * 0.15));
    }
  }

  // ── vuelos en tiempo real: despegue (tintero → papel) y regreso (papel → tintero)
  const fl = { kind: '', t: 0, dur: 1, p0: V3(), q0: Q4(), p1: V3(), qLift: Q4(), fromRest: false, rippled: false };
  const flP = V3(), flQ = Q4();
  function startTakeoff(fast) {
    fl.kind = 'takeoff'; fl.t = 0; fl.fromRest = S.mode === 'rest';
    fl.dur = fl.fromRest ? (fast ? 0.95 : LEAD_S) : (fast ? 0.55 : 0.9);
    fl.p0.copy(S.tip); fl.q0.copy(S.q); fl.rippled = false;
    fl.p1.copy(S.tip).addScaledVector(restAx, 0.058);
    // al salir se endereza un poco (escurre sobre la boca)
    _qa.setFromUnitVectors(restAx, _v.copy(upW).lerp(restAx, 0.45).normalize()); fl.qLift.copy(_qa).multiply(S.q);
    S.mode = 'takeoff'; S.modeT = 0;
    if (fl.fromRest) rippleAt(S.tip);
    S.wet = 1;
  }
  function startReturn() {
    fl.kind = 'return'; fl.t = 0; fl.dur = S.mode === 'takeoff' ? 0.9 : RETURN_S; fl.p0.copy(S.tip); fl.q0.copy(S.q); fl.rippled = false;
    S.mode = 'return'; S.modeT = 0;
  }
  const tkP = V3(), tkQ = Q4();
  function evalTakeoff(dt, wantWrite, outP, outQ) {
    const k = fl.t / fl.dur;
    // destino vivo (se mueve si la escritura ya empezó)
    if (wantWrite) writeTarget(dt, tkP, tkQ); else hoverTarget(dt, tkP, tkQ);
    if (fl.fromRest && k < 0.3) {               // sale del tintero a lo largo de su eje
      const e = minJerk(k / 0.3);
      outP.lerpVectors(fl.p0, fl.p1, e); outQ.slerpQuaternions(fl.q0, fl.qLift, sstep(0.35, 1, e));
      return;
    }
    if (fl.fromRest && k < 0.4) {               // escurre: dos sacudidas mínimas sobre la boca
      const e = seg(k, 0.3, 0.4);
      outP.copy(fl.p1); _v.crossVectors(upW, nW); if (_v.lengthSq() < 1e-6) _v.set(1, 0, 0); _v.normalize();
      outP.addScaledVector(_v, 0.0009 * Math.sin(TAU2 * 2 * e) * (1 - e)); outQ.copy(fl.qLift);
      return;
    }
    const k0 = fl.fromRest ? 0.4 : 0, e = minJerk(seg(k, k0, 1));
    const p0 = fl.fromRest ? fl.p1 : fl.p0, q0 = fl.fromRest ? fl.qLift : fl.q0;
    _b1.copy(p0).addScaledVector(upW, 0.06);
    _b2.copy(tkP).addScaledVector(nW, 0.05);
    bez(outP, p0, _b1, _b2, tkP, e);
    outQ.slerpQuaternions(q0, tkQ, sstep(0, 1, seg(k, k0, 1) * 0.8 + e * 0.2));
  }
  function evalReturn(outP, outQ) {
    const k = fl.t / fl.dur;
    _b3.copy(restP).addScaledVector(restAx, 0.062);
    if (k < 0.62) {
      const e = minJerk(k / 0.62);
      _b1.copy(fl.p0).addScaledVector(nW, 0.05).addScaledVector(upW, 0.02);
      _b2.copy(_b3).addScaledVector(restAx, 0.06);
      bez(outP, fl.p0, _b1, _b2, _b3, e);
      outQ.slerpQuaternions(fl.q0, restQ, sstep(0, 1, (k / 0.62) * 0.8 + e * 0.2));
      return;
    }
    if (k < 0.9) {
      const e = minJerk(seg(k, 0.62, 0.9));
      outP.lerpVectors(_b3, restP, e); outQ.copy(restQ);
      if (!fl.rippled && e > 0.6) { fl.rippled = true; rippleAt(outP); }
      return;
    }
    const e = seg(k, 0.9, 1);   // se acomoda contra el collar
    outP.copy(restP);
    _v.set(0, 0, 1).applyQuaternion(restQ);
    outQ.setFromAxisAngle(_v, 0.012 * Math.sin(e * 9) * (1 - e)).multiply(restQ);
  }

  // ── destino de escritura (con remojos)
  const tipLw = V3();
  function writeTarget(dt, outP, outQ) {
    const t = S.ts / SEC;
    readPen(t, pen);
    // remojo propio (k por tiempo, con la pluma en el aire)
    let di = -1;
    for (let i = 0; i < dipsS.length; i++) if (S.ts >= dipsS[i].s && S.ts <= dipsS[i].e && !pen.down) { di = i; break; }
    if (di >= 0) {
      const D = S.dip;
      if (D.idx !== di) {
        D.idx = di; D.A.copy(S.tip); D.qA.copy(S.q); D.rippleIn = D.rippleOut = false; setLean(S.q);
        const dist = D.A.distanceTo(mouthW);
        D.a1 = clamp(0.2 + 0.45 * dist, 0.26, 0.4); D.a4 = 1 - (D.a1 + 0.06);
      }
      const k = clamp((S.ts - dipsS[di].s) / Math.max(1e-3, dipsS[di].e - dipsS[di].s));
      S.dipK = k;
      dipTarget(dt, k, outP, outQ);
      return;
    }
    S.dipK = 0;
    if (S.dip.idx >= 0 && S.ts > dipsS[S.dip.idx].e + 0.2) S.dip.idx = -1;
    tipLw.copy(pen.pos);
    if (S.ts < tFirstS) { hoverTarget(dt, outP, outQ); return; }
    if (!pen.down && !reduced) { const tt = S.time; tipLw.x += 0.00012 * Math.sin(TAU2 * 7.7 * tt); tipLw.y += 0.0001 * Math.sin(TAU2 * 9.1 * tt + 1); }
    if (pen.down) tipLw.z += 0.00015;
    toWorld(tipLw, outP);
    handPose(dt, pen.pos, pen.down, pen.pressure, pen.tx, pen.ty, outQ);
  }

  // ── sombra proyectada: actualiza una franja en el marco de su plano
  const _pl = V3(), _pr = V3(), _ll = V3(), _inv = new THREE.Matrix4();
  const SL = [], SR = [], SH = [], SD = [], SR2 = [];
  const _ax = new THREE.Vector2(), _lat = new THREE.Vector2(), _mid = new THREE.Vector2();
  for (let i = 0; i < PROF_N + 3; i++) { SL.push(new THREE.Vector2()); SR.push(new THREE.Vector2()); SH.push(0); SD.push(0); SR2.push(0); }
  function updateStrip(strip, frameObj, normalY, opacity, clipFn) {
    strip.mat.uniforms.uOpacity.value = opacity;
    strip.mesh.visible = opacity > 0.003 && (strip.kind === 'paper' || Q.table);
    if (!strip.mesh.visible) return;
    _inv.copy(frameObj.matrixWorld).invert();
    _ll.copy(lightW).applyMatrix4(_inv);
    const Ln = normalY ? _ll.y : _ll.z;
    const rowsWanted = Math.min(prof.length, Q.rows + 1);
    const stride = (prof.length - 1) / (rowsWanted - 1);
    let n = 0;
    for (let r = 0; r < rowsWanted; r++) {
      const pr = prof[Math.min(prof.length - 1, Math.round(r * stride))];
      _pl.set(pr.x1, pr.y, pr.z).applyMatrix4(group.matrixWorld).applyMatrix4(_inv);
      _pr.set(pr.x0, pr.y, pr.z).applyMatrix4(group.matrixWorld).applyMatrix4(_inv);
      const hl = normalY ? _pl.y : _pl.z, hr = normalY ? _pr.y : _pr.z;
      const h = Math.max(0, (hl + hr) / 2);
      const sl = Ln / Math.max(0.02, Ln - hl), sr = Ln / Math.max(0.02, Ln - hr);
      if (normalY) { SL[n].set(_ll.x + (_pl.x - _ll.x) * sl, _ll.z + (_pl.z - _ll.z) * sl); SR[n].set(_ll.x + (_pr.x - _ll.x) * sr, _ll.z + (_pr.z - _ll.z) * sr); }
      else { SL[n].set(_ll.x + (_pl.x - _ll.x) * sl, _ll.y + (_pl.y - _ll.y) * sl); SR[n].set(_ll.x + (_pr.x - _ll.x) * sr, _ll.y + (_pr.y - _ll.y) * sr); }
      SH[n] = h; SD[n] = pr.d * (Ln - h < 0.05 ? 0 : 1); SR2[n] = 2 * pr.r * (sl + sr) / 2; n++;
    }
    // filas → 4 vértices (borde exterior, núcleo, núcleo, borde exterior) + tapas en la punta y en el extremo
    const pos = strip.pos, e = strip.e;
    const put = (vi, x, y, edge, op) => {
      if (normalY) { pos[vi * 3] = x; pos[vi * 3 + 1] = 0.0006; pos[vi * 3 + 2] = y; }
      else { pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = clipFn(y); }
      e[vi * 2] = edge; e[vi * 2 + 1] = op;
    };
    let vi = 0;
    const axis = (i, o) => { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); o.set((SL[b].x + SR[b].x - SL[a].x - SR[a].x) / 2, (SL[b].y + SR[b].y - SL[a].y - SR[a].y) / 2); const l = o.length() || 1; return o.multiplyScalar(1 / l); };
    const ax = _ax, lat = _lat, mid = _mid;
    // tapa de la punta
    axis(0, ax); { const b = 0.0006 + 0.14 * SH[0]; mid.set((SL[0].x + SR[0].x) / 2 - ax.x * b, (SL[0].y + SR[0].y) / 2 - ax.y * b); for (let c = 0; c < 4; c++) put(vi++, mid.x, mid.y, 0, 0); }
    for (let i = 0; i < n; i++) {
      axis(i, ax);
      const b = 0.0006 + 0.14 * SH[i];
      // sección SIEMPRE perpendicular al eje de la franja (si se usara el ancho proyectado tal cual, con el vexilo casi de canto
      // respecto de la luz las filas se plegarían y el solape dibujaría manchas oscuras de borde duro)
      lat.set(-ax.y, ax.x);
      const w = Math.max(Math.abs((SL[i].x - SR[i].x) * lat.x + (SL[i].y - SR[i].y) * lat.y), SR2[i]);
      mid.set((SL[i].x + SR[i].x) / 2, (SL[i].y + SR[i].y) / 2);
      const op = SD[i] * Math.exp(-SH[i] / 0.045) * Math.min(1, (w + 0.35 * b) / (1.6 * b));
      const half = w / 2, inner = Math.max(0, half - 0.5 * b), outer = half + 0.5 * b;
      put(vi++, mid.x + lat.x * outer, mid.y + lat.y * outer, 0, op);
      put(vi++, mid.x + lat.x * inner, mid.y + lat.y * inner, 1, op);
      put(vi++, mid.x - lat.x * inner, mid.y - lat.y * inner, 1, op);
      put(vi++, mid.x - lat.x * outer, mid.y - lat.y * outer, 0, op);
    }
    axis(n - 1, ax); { const b = 0.0006 + 0.14 * SH[n - 1]; mid.set((SL[n - 1].x + SR[n - 1].x) / 2 + ax.x * b, (SL[n - 1].y + SR[n - 1].y) / 2 + ax.y * b); for (let c = 0; c < 4; c++) put(vi++, mid.x, mid.y, 0, 0); }
    const used = vi;
    for (; vi < strip.R * 4; vi++) { const s = (used - 4) * 3; pos[vi * 3] = pos[s]; pos[vi * 3 + 1] = pos[s + 1]; pos[vi * 3 + 2] = pos[s + 2]; e[vi * 2] = 0; e[vi * 2 + 1] = 0; }
    strip.geo.attributes.position.needsUpdate = true; strip.geo.attributes.aE.needsUpdate = true;
  }
  const surfaceZ = (y) => {
    const Lf = DIMENSIONS.LfMin + (DIMENSIONS.LfMax - DIMENSIONS.LfMin) * clamp(P.u ?? 1, 0, 1.04);
    const bow = P.uniforms?.pBow?.value ?? 0;
    return 0.0004 - bow * Math.max(0, 1 - (y / Math.max(0.01, Lf / 2)) ** 2) ** 2 + 0.00045;
  };

  // ── pose → group (en el espacio de su padre)
  function applyPose() {
    const par = group.parent;
    if (par) {
      par.updateWorldMatrix(true, false);
      _m.copy(par.matrixWorld).invert();
      group.position.copy(S.tip).applyMatrix4(_m);
      par.getWorldQuaternion(_qa); group.quaternion.copy(_qa.invert().multiply(S.q));
    } else { group.position.copy(S.tip); group.quaternion.copy(S.q); }
    group.updateMatrixWorld(true);
  }

  // ── sonido
  const sfxQuill = (x) => {
    const f = music?.sfx?.quill;
    if (typeof f !== 'function') return;
    try { if (x > 0 && !music.playing) return; f.call(music.sfx, x); } catch { /* */ }
  };

  // estado inicial: en el tintero
  frames(null); S.tip.copy(restP); S.q.copy(restQ); applyPose();

  // ─────────────── update ───────────────
  function update(dt, time, writingT, state) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 1 / 60;
    S.time = Number.isFinite(time) ? time : S.time + dt;
    if (typeof state === 'string') state = { phase: state };
    frames(state);
    const ph = PHASES[state?.phase] || (state?.phase ? 'write' : 'rest');
    const wt = clamp(Number.isFinite(+writingT) ? +writingT : 0);
    const ts = wt * SEC;
    // velocidad de reproducción (s naturales / s reales)
    if (Number.isFinite(state?.rate)) S.rate = clamp(state.rate, 0, 12);
    else if (S.lastTs != null && dt > 0) {
      const d = ts - S.lastTs;
      if (d > 0 && d < 0.6 * Math.max(1, dt * 60)) { const r = clamp(d / dt, 0, 12); S.rate += (r - S.rate) * (1 - Math.exp(-dt / 0.25)); }
      else if (d === 0) S.rate += (1 - S.rate) * (1 - Math.exp(-dt / 1.5));
    }
    S.lastTs = ts; S.ts = ts;
    // ¿qué quiere la escena?
    let want;
    if (reduced || ph === 'rest' || ph === 'done') want = 'rest';
    else if (ts >= tEndS) want = 'rest';
    else if (ts > tFirstS) want = 'write';
    else want = 'hover';
    // transiciones
    if (want === 'rest') {
      if (S.mode === 'write' || S.mode === 'hover' || (S.mode === 'takeoff' && fl.t > 0.05)) startReturn();
      else if (S.mode === 'takeoff') { S.mode = 'rest'; }
    } else if (S.mode === 'rest' || S.mode === 'return') {
      startTakeoff(want === 'write' && ts > tFirstS + 0.4);
    } else if (S.mode === 'hover' && want === 'write') { S.mode = 'write'; }
    else if (S.mode === 'write' && want === 'hover') { S.mode = 'hover'; S.hoverT = 0.9; }
    S.modeT += dt;

    // cámara: baja la inclinación si el extremo de la pluma se acerca demasiado
    if (hasCam && (S.mode === 'write' || S.mode === 'hover' || S.mode === 'takeoff')) {
      _v.set(0, LEN * 0.92, 0).applyQuaternion(S.q).add(S.tip);
      const dc = _v.distanceTo(camPos);
      const goal = -0.18 * sstep(0.18, 0.08, dc);
      S.elAdj += (goal - S.elAdj) * (1 - Math.exp(-dt / 0.45));
    } else S.elAdj += (0 - S.elAdj) * (1 - Math.exp(-dt / 0.8));

    // pose
    if (S.mode === 'rest') {
      S.tip.copy(restP); S.q.copy(restQ); S.locked = false; S.hasPrev = false; S.handInit = false; S.vel.set(0, 0, 0);
    } else if (S.mode === 'takeoff' || S.mode === 'return') {
      fl.t += dt;
      if (S.mode === 'takeoff') evalTakeoff(dt, want === 'write', flP, flQ); else evalReturn(flP, flQ);
      if (dt > 0) S.vel.copy(flP).sub(S.tip).multiplyScalar(1 / dt);
      S.tip.copy(flP); S.q.copy(flQ);
      if (fl.t >= fl.dur) {
        if (S.mode === 'takeoff') { S.mode = want === 'write' ? 'write' : 'hover'; S.modeT = 0; S.hoverT = 0; S.locked = true; S.hasPrev = false; }
        else { S.mode = 'rest'; S.modeT = 0; S.tip.copy(restP); S.q.copy(restQ); }
      }
    } else {
      if (S.mode === 'hover') { S.hoverT += dt; hoverTarget(dt, S.tgtP, S.tgtQ); S.dipK = 0; }
      else writeTarget(dt, S.tgtP, S.tgtQ);
      // seguidor: clavado al guion salvo saltos (scroll muy rápido, seek)
      const sp = S.hasPrev && dt > 0 ? S.tgtP.distanceTo(S.prevTgt) / dt : 0;
      S.prevTgt.copy(S.tgtP); S.hasPrev = true;
      if (S.locked && sp > V_UNLOCK) S.locked = false;
      if (S.locked) { if (dt > 0) S.vel.copy(S.tgtP).sub(S.tip).multiplyScalar(1 / dt); S.tip.copy(S.tgtP); }
      else {
        const om = 2 / TAU_CATCH, x = om * dt, ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        for (const k of ['x', 'y', 'z']) {
          const ch = S.tip[k] - S.tgtP[k], tmp = (S.vel[k] + om * ch) * dt;
          S.vel[k] = (S.vel[k] - om * tmp) * ex; S.tip[k] = S.tgtP[k] + (ch + tmp) * ex;
        }
        if (S.tip.distanceTo(S.tgtP) < 0.0005 && sp < V_UNLOCK * 0.8) { S.locked = true; S.tip.copy(S.tgtP); }
      }
      const tq = S.dipK > 0 ? 0.02 : 0.028 / Math.pow(clamp(S.rate, 1, 8), 0.5);
      // giro suavizado y con velocidad angular máxima (≈ 430°/s): aunque la escena acelere sin respetar rateCap, nunca "salta"
      _qa.copy(S.q).slerp(S.tgtQ, 1 - Math.exp(-dt / tq));
      const step = W_MAX * dt;
      if (S.q.angleTo(_qa) > step) S.q.rotateTowards(S.tgtQ, step); else S.q.copy(_qa);
    }
    applyPose();

    // tinta en la punta: se gasta al escribir; destello húmedo
    if (S.mode === 'write' && pen.down) S.wet = Math.max(0.22, S.wet - dt * S.rate * 0.075);
    if (nibMat) nibMat.roughness = lerp(0.34, 0.045, S.wet);
    {
      const vis = S.mode === 'rest' ? 0 : S.mode === 'return' ? 1 - sstep(0.7, 0.85, fl.t / fl.dur) : 1;
      const tw = 0.72 + 0.18 * Math.sin(S.time * 23.1) + 0.1 * Math.sin(S.time * 7.3 + 1.2);
      if (hasCam) { _v.copy(camPos); group.worldToLocal(_v); _v.y = 0; if (_v.lengthSq() > 1e-8) _v.normalize(); glint.position.set(_v.x * 0.0019, 0.0012, _v.z * 0.0019); }
      glint.material.opacity = reduced ? 0.15 * S.wet : clamp((0.12 + 0.88 * S.wet ** 1.4) * tw * vis * (pen.down && S.mode === 'write' ? 0.85 : 1), 0, 1);
      glint.visible = glint.material.opacity > 0.01;
    }

    // sombras proyectadas
    {
      const hTip = _v.copy(S.tip).applyMatrix4(_inv.copy(P.group.matrixWorld).invert()).z;
      const onPaper = S.mode === 'rest' ? 0 : sstep(0.13, 0.03, hTip) * (Math.abs(_v.x) < DIMENSIONS.W / 2 + 0.05 ? 1 : 0);
      const Lf = DIMENSIONS.LfMin + (DIMENSIONS.LfMax - DIMENSIONS.LfMin) * clamp(P.u ?? 1, 0, 1.04);
      paperStrip.mat.uniforms.uClip.value.set(-DIMENSIONS.W / 2 + 0.006, DIMENSIONS.W / 2 - 0.007, -Lf / 2 + 0.002, Lf / 2 - 0.002);
      updateStrip(paperStrip, P.group, false, 0.72 * onPaper * S.shadowK, surfaceZ);
      const hT = _v.copy(S.tip).applyMatrix4(_inv.copy(tintero.matrixWorld).invert()).y;
      const nearTable = sstep(0.32, 0.12, hT) * (_v.x * _v.x + _v.z * _v.z < 0.09 ? 1 : 0);
      updateStrip(tableStrip, tintero, true, 0.42 * nearTable * S.shadowK, null);
    }
    // ondas
    if (ripple) {
      let alive = false;
      for (let i = 0; i < 3; i++) { if (rippleAges[i] < 2) { rippleAges[i] += dt; alive = alive || rippleAges[i] < 1.6; } }
      ripple.material.uniforms.uAge.value.set(rippleAges[0], rippleAges[1], rippleAges[2], 9);
      ripple.visible = alive && Q.ripples;
    }
    // raspado (solo apoyada, según la velocidad real de la punta)
    let snd = 0;
    if (!reduced && S.mode === 'write' && pen.down && S.locked) {
      const v = pen.speed * Math.max(0.3, S.rate);
      snd = clamp(v / 0.32) ** 0.85 * (0.35 + 0.65 * pen.pressure) * (pen.gold ? 0.7 : 1);
    }
    if (Math.abs(snd - S.snd) > 0.02 || (snd > 0 && S.time - S.sndT > 0.06) || (snd === 0 && S.snd !== 0)) { sfxQuill(snd); S.snd = snd; S.sndT = S.time; }
  }

  function rateCap(t) {
    const ts = clamp(+t || 0) * SEC;
    for (const d of dipsS) if (ts > d.s - 0.3 && ts < d.e + 0.12) {
      const dist = mouthW.distanceTo(toWorld(firstLocal, _v3));
      return clamp((d.e - d.s) / (0.5 + 2 * dist / 0.85), 1, CAP_MAX);
    }
    let lo = 0, hi = gaps.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (gaps[m].s - 0.06 <= ts) lo = m; else hi = m - 1; }
    const g = gaps[lo];
    if (g && ts >= g.s - 0.06 && ts <= g.e && g.d > 0.015) return clamp((V_AIR * (g.e - g.s)) / g.d, 1, CAP_MAX);
    return CAP_MAX;
  }
  function reset() {
    frames(null); S.mode = 'rest'; S.tip.copy(restP); S.q.copy(restQ); S.locked = false; S.hasPrev = false; S.handInit = false;
    S.dip.idx = -1; S.wet = 1; S.lastTs = null; S.rate = 1; rippleAges.fill(9); applyPose(); sfxQuill(0);
  }
  function setQuality(n) { qLevel = clamp(Number.isInteger(n) ? n : 1, 0, 4); applyQuality(); }
  function setReducedMotion(on) { reduced = !!on; if (reduced) reset(); }
  function dispose() {
    sfxQuill(0);
    paperStrip.mesh.removeFromParent(); tableStrip.mesh.removeFromParent();
    group.removeFromParent(); inkwell.removeFromParent();
    for (const r of new Set(owned)) { try { r.dispose?.(); } catch { /* */ } }
  }

  return {
    group, inkwell, update, dispose, setQuality, setReducedMotion, reset, rateCap,
    setMusic(m) { music = m || null; },
    setShadow(k) { S.shadowK = clamp(+k || 0, 0, 2); },
    get quality() { return qLevel; },
    get ready() { return (S.mode === 'hover' && S.hoverT > 0.45) || S.mode === 'write'; },
    get mode() { return S.mode; },
    get dipping() { return S.mode === 'write' ? S.dipK || 0 : 0; },
    get wet() { return S.wet; },
    get rate() { return S.rate; },
    tip: S.tip,
    leadTime: LEAD_S,
    debug: { S, prof, paperStrip, tableStrip, ripple, glint, mats, pluma, tintero, gaps, dipsS, tFirstS, tEndS, HAND },
  };
}
