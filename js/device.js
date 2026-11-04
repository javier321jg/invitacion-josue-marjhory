// One shared capability decision. Never download a 3D scene on a device that cannot use it.
const params = new URLSearchParams(location.search);
const ua = navigator.userAgent || '';
const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iosVersion = /OS (\d+)[_\d]* like Mac OS X/.exec(ua);
const memory = navigator.deviceMemory;
const cores = navigator.hardwareConcurrency;
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const constrained = !!(connection?.saveData || /(^|slow-)2g$/.test(connection?.effectiveType || '') ||
  (mobile && !ios && ((memory && memory <= 4) || (cores && cores <= 4))) ||
  (iosVersion && Number(iosVersion[1]) < 16));
const noWebGL2 = typeof WebGL2RenderingContext === 'undefined';
const light = params.has('nogl') || params.get('quality') === 'lite' || noWebGL2 ||
  (params.get('quality') !== 'full' && constrained);
export const device = Object.freeze({ mobile, ios, light, constrained, noWebGL2,
  // Secondary photo effects don't need more GPU contexts on a phone.
  photoLite: mobile || light,
  ribbonLite: params.get('ribbon') !== 'video',
  dpr: mobile ? 1.35 : 1.75,
});
document.documentElement.classList.toggle('quality-lite', light);
document.documentElement.classList.toggle('is-mobile', mobile);
