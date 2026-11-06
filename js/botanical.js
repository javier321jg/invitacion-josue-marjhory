// Jardín de la carta (05/11, pedido del usuario: «que las flores al inicio sean más animadas, más floridas, más sorprendentes»).
// Rosas de Blender (assets/botanical/rose2-*.webp, tools/flores/variantes.py) en capas HTML — no dentro de un SVG — para que
// el navegador anime cada flor en la GPU (transform/opacity en el compositor): en un Android modesto la floración no repinta
// la página. Secuencia: la enredadera se dibuja, las hojas se despliegan a lo largo de ella, brotan los capullos, cada rosa se
// abre girando con un destello dorado y suelta pétalos; después las rosas respiran, el ramo se mece con el viento, titilan
// chispas de polen dorado y caen pétalos sueltos sobre toda la carta (capa .cg-fall).
// Cada solapa de la puerta lleva la cara completa; splitFlora() oculta en cada solapa lo que queda en la otra mitad.
const img = name => new URL('../assets/botanical/' + name + '.webp', import.meta.url).href;
const SRC = {
  blush: img('rose2-blush'), ivory: img('rose2-ivory'), peach: img('rose2-peach'), dusty: img('rose2-dusty'),
  bud: img('bud-blush'), leaf: img('leaf-olive-s'), petalB: img('petal-blush-s'), petalI: img('petal-ivory-s'),
};
// Se piden ya (≈ 55 KB en total): la floración no debe empezar con huecos.
export const floraReady = Promise.all(Object.values(SRC).map(src => new Promise(res => {
  const im = new Image(); im.decoding = 'async'; im.onload = im.onerror = () => res(); im.src = src;
})));

const n2 = v => +(+v).toFixed(2);
const st = o => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

// Ramo de esquina en un cuadro de 260×200 px (origen en la esquina; se escala con --k). [x, y, diámetro, tono, inicio]
const ROSES = [
  [64, 66, 100, 'blush', .85], [146, 30, 68, 'ivory', 1.35], [22, 132, 62, 'peach', 1.8], [204, 14, 44, 'dusty', 2.2],
];
const BUDS = [[108, 112, 30, 1.25], [238, 36, 24, 1.9], [10, 186, 26, 2.05], [176, 66, 20, 2.4]];
const LEAVES = [
  // a lo largo de la enredadera principal (de abajo hacia la esquina y luego hacia la derecha)
  [6, 196, -18, 30, .5], [16, 166, 38, 28, .62], [12, 104, -30, 30, .78], [34, 90, 52, 26, .9], [36, 30, -60, 30, 1.0],
  [96, 22, 70, 28, 1.1], [118, 58, 140, 24, 1.2], [182, 44, 115, 24, 1.35], [230, 8, 80, 22, 1.5], [256, 22, 120, 20, 1.62],
  [92, 100, 160, 22, 1.4], [52, 156, 120, 22, 1.55],
];
const SPARKS = [[100, 44, 1.0], [178, 82, 1.6], [44, 108, 2.3], [128, 96, 3.1], [228, 56, 3.8]];

function rose([x, y, d, tone, t], i) {
  const petal = tone === 'ivory' || tone === 'peach' ? SRC.petalI : SRC.petalB;
  let burst = '';
  // la rosa principal suelta 4 pétalos al abrirse; las demás, 2
  const nb = d > 80 ? 4 : d > 50 ? 2 : 0;
  for (let k = 0; k < nb; k++) burst += `<i class="fl-burst" style="${st({ '--a': (35 + k * (300 / Math.max(1, nb)) + i * 23) + 'deg', '--bt': n2(t + 1 + k * .12) + 's', 'background-image': `url(${petal})` })}"></i>`;
  return `<span class="fl-it fl-rose${i === 0 ? ' fl-rose--hero' : ''}" data-r="${d / 2}" style="${st({ left: x + 'px', top: y + 'px', '--d': d + 'px', '--t': t + 's', '--b': n2(5.2 + i * .9) + 's', '--bp': n2(-i * 1.7) + 's' })}">` +
    `<i class="fl-rose__shadow"></i><span class="fl-rose__breath"><img class="fl-rose__img" src="${SRC[tone]}" alt="" draggable="false"></span>` +
    `<i class="fl-rose__glow"></i>${burst}</span>`;
}
const bud = ([x, y, d, t], i) => `<span class="fl-it fl-bud" data-r="${d / 2}" style="${st({ left: x + 'px', top: y + 'px', '--d': d + 'px', '--t': t + 's', '--b': n2(4.4 + i * .7) + 's' })}"><img src="${SRC.bud}" alt="" draggable="false"></span>`;
const leaf = ([x, y, r, d, t], i) => `<span class="fl-it fl-leaf${i % 3 === 0 ? ' fl-leaf--flutter' : ''}" data-r="${d / 2}" style="${st({ left: x + 'px', top: y + 'px', '--d': d + 'px', '--r': r + 'deg', '--t': t + 's', '--b': n2(3.6 + (i % 4) * .6) + 's' })}"><img src="${SRC.leaf}" alt="" draggable="false"></span>`;
const spark = ([x, y, t]) => `<i class="fl-it fl-spark" data-r="6" style="${st({ left: x + 'px', top: y + 'px', '--t': t + 's' })}"></i>`;

/** Ramo de una esquina: tl, br (grande) · tr, bl (pequeño, espejado). */
export function floraCorner(corner) {
  const vine = `<svg class="fl-vine" viewBox="0 0 260 200" aria-hidden="true" focusable="false">
    <path class="fl-vine__p" pathLength="1" d="M4 204C2 166 22 140 20 112S30 62 52 44S104 18 150 22S222 30 262 12"/>
    <path class="fl-vine__p fl-vine__p--gold" pathLength="1" d="M-2 150C18 122 8 92 34 70S88 58 112 38S170 8 214 18S246 34 270 30"/>
    <path class="fl-vine__p fl-vine__p--thin" pathLength="1" d="M60 70C82 92 96 104 110 112M150 30C164 48 172 58 178 66"/></svg>`;
  return `<div class="fl fl--${corner}" aria-hidden="true"><div class="fl__flip"><div class="fl__sway">${vine}` +
    LEAVES.map(leaf).join('') + BUDS.map(bud).join('') + ROSES.map(rose).join('') + SPARKS.map(spark).join('') +
    `</div></div></div>`;
}

/** Pétalos que caen flotando sobre toda la carta (capa propia, encima del papel y debajo del lazo). */
export function floraFall(count = 9) {
  let h = '';
  for (let i = 0; i < count; i++) {
    const r = (Math.sin(i * 91.7) + 1) / 2, q = (Math.sin(i * 37.3 + 1) + 1) / 2;
    h += `<i style="${st({ left: n2(4 + (i * 97 % 92)) + '%', '--s': Math.round(14 + r * 14) + 'px', '--dur': n2(10 + q * 7) + 's',
      '--del': n2(2.6 + i * 1.35) + 's', '--sw': Math.round(18 + r * 30) + 'px', '--rot': Math.round(200 + q * 320) + 'deg' })}">` +
      `<b style="background-image:url(${i % 3 === 1 ? SRC.petalI : SRC.petalB})"></b></i>`;
  }
  return `<div class="cg-fall" aria-hidden="true">${h}</div>`;
}

/** Cada solapa muestra media cara: lo que queda entero del otro lado de la costura no se dibuja (ni se anima) en ella.
 *  Lo que cruza la costura va en las dos (idéntico, sin corte visible). Se llama al montar y al cambiar el tamaño. */
export function splitFlora(gateEl) {
  const flaps = gateEl.querySelectorAll('.cg-flap');
  if (flaps.length !== 2) return;
  const A = [...flaps[0].querySelectorAll('.fl-it, .cg-spine')], B = [...flaps[1].querySelectorAll('.fl-it, .cg-spine')];
  for (const el of A.concat(B)) el.style.display = '';
  // escala del ramo según la pantalla (cuadro base de 260×200 px pensado para un teléfono de 390 px)
  const k = Math.max(.6, Math.min(1.6, innerWidth / 420, innerHeight / 620));
  gateEl.style.setProperty('--fl-k', k.toFixed(3));
  const seam = flaps[0].getBoundingClientRect().right;
  if (!seam) return;
  const scaleOf = new Map();
  A.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height && !el.offsetParent) return;
    const host = el.closest('.fl');
    let k = 1;
    if (host) {
      if (!scaleOf.has(host)) scaleOf.set(host, host.getBoundingClientRect().width / Math.max(1, host.offsetWidth));
      k = scaleOf.get(host);
    }
    const cx = r.left + r.width / 2, rad = el.classList.contains('cg-spine') ? r.width / 2 : (+el.dataset.r || 20) * k * 1.25 + 4;
    if (cx - rad > seam) el.style.display = 'none';           // del todo a la derecha: solo en la solapa derecha
    else if (cx + rad < seam && B[i]) B[i].style.display = 'none';
  });
}

export function botanicalSpines() {
  let leaves = '';
  for (let i = 0; i < 7; i++) {
    leaves += `<g transform="translate(${i % 2 ? 22 : 30} ${250 + i * 53}) rotate(${i % 2 ? 55 : -45})"><g class="cg-leaf" style="animation-delay:${(1.6 + i * .25).toFixed(2)}s"><image href="${SRC.leaf}" x="-14.5" y="-25.5" width="29" height="29"/></g></g>`;
  }
  const svg = `<svg viewBox="0 0 70 840" preserveAspectRatio="none" aria-hidden="true"><path class="cg-vine cg-vine--climb" pathLength="1" d="M26 175C4 255 55 280 26 355S9 454 27 520S44 605 25 677" fill="none" stroke="#899061" stroke-width="1.2"/>${leaves}</svg>`;
  return `<div class="cg-spine cg-spine--l">${svg}</div><div class="cg-spine cg-spine--r">${svg}</div>`;
}
