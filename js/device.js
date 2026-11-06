// One shared capability decision. Never download a 3D scene on a device that cannot use it.
// 2026-11-05 (pedido del usuario: «que se vea la pluma, la cinta, la estrella fugaz y las luces del final en móvil»):
// la ronda anterior mandaba al modo ligero a casi todo Android (Chrome informa deviceMemory 4 en teléfonos de 4–8 GB y
// muchos tienen 4 núcleos «grandes») y apagaba en TODO móvil la historia con flores y el final 3D. Ahora el modo ligero
// queda solo para lo que de verdad no puede: sin WebGL 2, ahorro de datos, 2G, ≤ 1 GB de memoria, ≤ 2 núcleos o iOS < 15.
// Los teléfonos modestos van con el 3D completo en nivel BAJO (cada módulo ya adapta DPR y partículas según su fps).
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iosVersion = /OS (\d+)[_\d]* like Mac OS X/.exec(ua);
const androidVersion = /Android (\d+)/.exec(ua);
const memory = navigator.deviceMemory;
const cores = navigator.hardwareConcurrency;
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const slowNet = !!(connection && (connection.saveData || /(^|slow-)2g$/.test(connection.effectiveType || '')));
const weakAndroid = mobile && !ios && ((memory && memory <= 1) || (cores && cores <= 2) || (androidVersion && Number(androidVersion[1]) < 7));
const oldIOS = !!(iosVersion && Number(iosVersion[1]) < 15);
const constrained = slowNet || weakAndroid || oldIOS;
const noWebGL2 = typeof WebGL2RenderingContext === 'undefined';
const light = params.has('nogl') || params.get('quality') === 'lite' || noWebGL2 ||
  (params.get('quality') !== 'full' && constrained);
// Gama baja con 3D: Android con ≤ 2 GB informados (teléfonos de 2–4 GB) o ≤ 4 núcleos. Menos píxeles, mismas animaciones.
const low = !light && (params.get('quality') === 'low' ||
  (params.get('quality') !== 'full' && mobile && !ios && ((memory && memory <= 2) || (cores && cores <= 4))));
export const device = Object.freeze({ mobile, ios, light, low, constrained, noWebGL2,
  // Historia (flores) y final (atardecer, luces, estrella fugaz) en 3D en todo teléfono con WebGL 2; el modo ligero usa
  // sus versiones CSS (que también tienen luces y estrella fugaz).
  photoLite: light,
  ribbonLite: params.get('ribbon') !== 'video',
  dpr: light || low ? 1 : mobile ? 1.35 : 1.75,
});
document.documentElement.classList.toggle('quality-lite', light);
document.documentElement.classList.toggle('quality-low', low);
document.documentElement.classList.toggle('is-mobile', mobile);
