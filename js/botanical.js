// Botanical illustrations are actual Blender material renders, shared by every petal.
const img = name => new URL('../assets/botanical/' + name + '.webp', import.meta.url).href;
const petalIvory = img('petal-ivory'), petalBlush = img('petal-blush'), leaf = img('leaf-olive');
function rose(x, y, radius, delay, blush = false, rotation = 0) {
  let html = `<g transform="translate(${x} ${y}) rotate(${rotation})" class="cg-rose">`;
  html += `<g class="cg-growing-petals" style="animation-delay:${delay+2}s">`;
  for (let ring = 0; ring < 3; ring++) {
    const count = [7,6,5][ring], size = radius * [1.7,1.17,.7][ring];
    for (let i = 0; i < count; i++) {
      const angle = i * 360/count + ring*31 + Math.sin(i*9+ring)*9;
      const t = (delay + ring*.25 + i*.055).toFixed(2);
      html += `<g transform="rotate(${angle.toFixed(1)})"><g class="cg-petal" style="animation-delay:${t}s"><image href="${blush && ring > 0 ? petalBlush : petalIvory}" x="${-size/2}" y="${-size*.88}" width="${size}" height="${size}"/></g></g>`;
    }
  }
  html += `<circle class="cg-flower-heart" r="${radius*.085}" fill="#9e713c" style="animation-delay:${delay+1.2}s"/></g>`;
  html += `<image class="cg-rose-finish" style="animation-delay:${delay+1.85}s" href="${img(blush ? 'rose-blush' : 'rose-ivory')}" x="${-radius*1.65}" y="${-radius*1.65}" width="${radius*3.3}" height="${radius*3.3}"/></g>`;
  return html;
}
function laurel(x,y,angle,size,delay) {
  return `<g transform="translate(${x} ${y}) rotate(${angle})"><g class="cg-leaf" style="animation-delay:${delay}s"><image href="${leaf}" x="${-size*.5}" y="${-size*.88}" width="${size}" height="${size}"/></g></g>`;
}
export function botanicalCorner(id, small = false) {
  let leaves = '';
  for (let i = 0; i < 9; i++) {
    const t=i/8, x=26+140*t+18*Math.sin(t*4), y=310-230*t;
    leaves += laurel(+x.toFixed(1),+y.toFixed(1),i%2 ? 48 : -64,45-10*t,(.45+i*.18).toFixed(2));
  }
  for (let i = 0; i < 6; i++) leaves += laurel(40+i*28,45+7*Math.sin(i), i%2?18:105,39,(.5+i*.2).toFixed(2));
  return `<svg viewBox="0 0 340 390" aria-hidden="true" focusable="false">
    <defs><linearGradient id="${id}" x2="1" y2="1"><stop stop-color="#8b683e"/><stop offset=".45" stop-color="#e5c78f"/><stop offset="1" stop-color="#a87b42"/></linearGradient></defs>
    <path class="cg-vine" pathLength="1" d="M23 371C15 313 40 283 68 245S82 194 111 164S143 118 159 74C171 43 206 35 253 43" fill="none" stroke="#78804b" stroke-width="1.7"/>
    <path class="cg-vine cg-vine--gold" pathLength="1" d="M14 379C41 321 5 291 42 251S111 192 104 151S127 69 183 48S256 64 312 23" fill="none" stroke="url(#${id})" stroke-width="1"/>
    <path class="cg-vine" pathLength="1" d="M20 46C73 35 94 63 143 43S226 25 277 48" fill="none" stroke="#78804b" stroke-width="1.3"/>
    ${leaves}
    ${small ? rose(58,90,20,1.1,false,-20) : rose(73,177,44,.8,true,-14)+rose(143,76,30,1.3,false,28)+rose(39,261,24,1.7,false,-5)}
  </svg>`;
}

export function botanicalSpines() {
  let leaves='';
  for(let i=0;i<7;i++) leaves+=laurel(i%2 ? 22 : 30,250+i*53,i%2 ? 55 : -45,29,(1.6+i*.25).toFixed(2));
  const svg=`<svg viewBox="0 0 70 840" preserveAspectRatio="none" aria-hidden="true"><path class="cg-vine cg-vine--climb" pathLength="1" d="M26 175C4 255 55 280 26 355S9 454 27 520S44 605 25 677" fill="none" stroke="#899061" stroke-width="1.2"/>${leaves}</svg>`;
  return `<div class="cg-spine cg-spine--l">${svg}</div><div class="cg-spine cg-spine--r">${svg}</div>`;
}
