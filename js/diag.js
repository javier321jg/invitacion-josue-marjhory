// js/diag.js — FIX ronda 1 · diagnóstico de compatibilidad para los celulares que "no ven completa la animación".
// Solo se carga con ?diag=1 (main.js). Muestra una tarjeta fija y copiable con lo que decide qué ve cada invitado:
// navegador y versión de iOS/Safari, WebGL 2 (tamaño máx. de textura, GPU, render a coma flotante), modo de cada módulo
// (3D / imagen / tarjeta) y el motivo de cada respaldo (avisos [inv]/[final]/…), contextos WebGL perdidos, Hz reales de
// requestAnimationFrame (30 = modo de bajo consumo), barra del navegador (100lvh − 100svh), movimiento reducido, memoria.
// El texto es de diagnóstico (no es parte de la invitación): el usuario manda el enlace con ?diag=1 y recibe una captura.
export function mountDiag(inv = window.__inv || {}) {
  if (document.getElementById('inv-diag')) return;
  const log = window.__invLog || [];
  let lost = 0;
  document.addEventListener('webglcontextlost', () => { lost++; }, true);
  const iv = [];
  let last = 0;
  const loop = t => { if (last && t - last < 250) { iv.push(t - last); if (iv.length > 120) iv.shift(); } last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const gl = (() => {
    try {
      const c = document.createElement('canvas'), g = c.getContext('webgl2');
      if (!g) return { gl2: false, gl1: !!document.createElement('canvas').getContext('webgl') };
      const d = g.getExtension('WEBGL_debug_renderer_info');
      const r = { gl2: true, max: g.getParameter(g.MAX_TEXTURE_SIZE), gpu: d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : '?',
        float: !!(g.getExtension('EXT_color_buffer_float') || g.getExtension('EXT_color_buffer_half_float')) };
      g.getExtension('WEBGL_lose_context')?.loseContext();
      return r;
    } catch (e) { return { gl2: false, err: String(e?.message || e) }; }
  })();
  const ua = navigator.userAgent || '';
  const ios = (ua.match(/OS (\d+)_(\d+)(?:_\d+)? like Mac OS X/) || []).slice(1, 3).join('.');
  const saf = (ua.match(/Version\/([\d.]+).*Safari/) || [])[1] || '';
  const probe = (h) => { try { const d = document.createElement('div'); d.style.cssText = `position:fixed;top:0;left:0;width:0;height:${h};visibility:hidden`; document.body.append(d); const v = d.getBoundingClientRect().height; d.remove(); return Math.round(v); } catch { return '?'; } };
  const box = document.createElement('div');
  box.id = 'inv-diag';
  box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Diagnóstico');
  box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483000;max-height:46vh;overflow:auto;padding:10px 12px 12px;' +
    'background:rgba(8,6,4,.9);color:#f2e5cb;border:1px solid rgba(214,186,132,.5);border-radius:12px;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;' +
    'white-space:pre-wrap;word-break:break-word;-webkit-user-select:text;user-select:text;pointer-events:auto';
  const pre = document.createElement('div');
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;margin-top:8px';
  const btn = (t, f) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.style.cssText = 'font:600 11px system-ui;padding:8px 12px;border-radius:8px;border:1px solid rgba(214,186,132,.6);background:#2a1d14;color:#f6e3b4'; b.onclick = f; bar.append(b); return b; };
  const copy = btn('Copiar', async () => { try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = 'Copiado'; } catch { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } });
  btn('Ocultar', () => { box.style.display = 'none'; });
  box.append(pre, bar);
  document.body.append(box);
  const hz = () => { if (iv.length < 20) return '?'; const a = [...iv].sort((x, y) => x - y); return Math.round(1000 / a[a.length >> 1]); };
  const st = () => inv.shell?.state || {};
  const mode = {
    rings: () => (inv.rings ? `3D (calidad ${inv.rings.quality?.tier || '?'}${inv.rings.quality?.steps?.length ? ', ↓' + inv.rings.quality.steps.join(',') : ''}, ${inv.rings.fps || 0} fps${inv.rings.asleep ? ', dormido' : ''})` : st().fallbackRings ? 'IMAGEN' : 'cargando'),
    scroll: () => (inv.scroll ? `3D (nivel ${inv.scroll.quality}, ${inv.scroll.fps || 0} fps, ${inv.scroll.sequence?.phase || ''})` : st().fallbackScroll ? 'TARJETA HTML' : `montando ${Math.round((st().scrollProg || 0) * 100)} %`),
    historia: () => inv.historia?.mode || '—',
    final: () => inv.final?.mode || '—',
  };
  const render = () => {
    const m = performance.memory;
    const lines = [
      'DIAGNÓSTICO · invitación Josué & Marjhory',
      ua,
      `iOS ${ios || '—'} · Safari ${saf || '—'} · DPR ${devicePixelRatio} · ${innerWidth}×${innerHeight} · núcleos ${navigator.hardwareConcurrency || '?'} · memoria ${navigator.deviceMemory || '?'} GB`,
      `WebGL2 ${gl.gl2 ? 'sí' : 'NO'}${gl.gl2 ? ` · tex máx ${gl.max} · coma flotante ${gl.float ? 'sí' : 'NO'} · ${gl.gpu}` : gl.gl1 ? ' (solo WebGL1)' : ''}`,
      `anillos: ${mode.rings()}`,
      `pergamino: ${mode.scroll()}`,
      `historia: ${mode.historia()} · final: ${mode.final()}`,
      `rAF ${hz()} Hz · contextos perdidos ${lost} · movimiento reducido ${inv.shell?.reduced ? 'SÍ' : 'no'} · barra ${probe('calc(100lvh - 100svh)')} px (svh ${probe('100svh')}, lvh ${probe('100lvh')})`,
      m ? `memoria JS ${Math.round(m.usedJSHeapSize / 1048576)} / ${Math.round(m.jsHeapSizeLimit / 1048576)} MB` : '',
      log.length ? 'avisos:\n  ' + log.slice(-10).join('\n  ') : 'avisos: ninguno',
    ].filter(Boolean);
    pre.textContent = lines.join('\n');
  };
  render();
  setInterval(render, 1000);
}
