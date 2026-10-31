// WEB-SHELL · revelados tipográficos y de imagen (GSAP + ScrollTrigger, con alternativa sin GSAP).

/** Divide un elemento en letras (.ch). Devuelve las letras. */
export function splitLetters(el) {
  const text = el.textContent.trim();
  el.textContent = '';
  const frag = document.createDocumentFragment();
  for (const ch of text) {
    const s = document.createElement('span');
    s.className = 'ch'; s.textContent = ch === ' ' ? ' ' : ch;
    frag.append(s);
  }
  el.append(frag);
  return [...el.children];
}

/** Calcula --w (ancho del nombre) y --x (posición de cada letra) para que el brillo de oro sea continuo. */
export function layoutLetters(root) {
  root.querySelectorAll('.hn').forEach(hn => {
    hn.style.setProperty('--w', hn.offsetWidth + 'px');
    const left = hn.getBoundingClientRect().left;
    hn.querySelectorAll('.ch').forEach(ch => {
      // offsetLeft no depende de transformaciones; usamos la posición relativa a .hn
      ch.style.setProperty('--x', (ch.offsetLeft - hn.offsetLeft) + 'px');
    });
    void left;
  });
}

/** Envuelve cada palabra en .rw > span manteniendo los elementos en línea. */
export function splitWords(el) {
  const orig = el.innerHTML;
  const walk = node => {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 3) {
        const parts = n.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const p of parts) {
          if (!p) continue;
          if (/^\s+$/.test(p)) { frag.append(document.createTextNode(' ')); continue; }
          const o = document.createElement('span'); o.className = 'rw';
          const i = document.createElement('span'); i.textContent = p;
          o.append(i); frag.append(o);
        }
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    }
  };
  walk(el);
  const outers = [...el.querySelectorAll('.rw')];
  const tops = [...new Set(outers.map(o => Math.round(o.offsetTop)))].sort((a, b) => a - b);
  const words = outers.map(o => ({ el: o.firstElementChild, line: tops.indexOf(Math.round(o.offsetTop)) }));
  return { words, restore: () => { el.innerHTML = orig; } };
}

export function initReveals({ gsap, ScrollTrigger, reduced }) {
  const els = [...document.querySelectorAll('[data-reveal]')];
  if (!gsap || !ScrollTrigger) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
    els.forEach(el => io.observe(el));
    return;
  }
  const st = (el, extra = {}) => ({ trigger: el, start: 'top 86%', once: true, ...extra });

  els.forEach(el => {
    const kind = el.dataset.reveal;
    if (reduced) {
      gsap.from(el, { opacity: 0, duration: .8, ease: 'power1.out', scrollTrigger: st(el) });
      return;
    }
    if (kind === 'fade') {
      gsap.from(el, { opacity: 0, y: 22, duration: 1.3, ease: 'power3.out', scrollTrigger: st(el) });
    } else if (kind === 'lines') {
      const lines = [...el.querySelectorAll('.line')];
      const parts = lines.map(l => { const html = l.innerHTML; l.innerHTML = `<span class="rw"><span>${html}</span></span>`; return { l, html }; });
      const inner = lines.map(l => l.querySelector('.rw > span'));
      gsap.set(inner, { yPercent: 115, rotate: 3 });
      gsap.to(inner, {
        yPercent: 0, rotate: 0, duration: 1.5, ease: 'expo.out', stagger: .13, scrollTrigger: st(el),
        onComplete: () => parts.forEach(p => { p.l.innerHTML = p.html; }),
      });
    } else if (kind === 'words') {
      const go = () => {
        const { words, restore } = splitWords(el);
        gsap.set(words.map(w => w.el), { yPercent: 110 });
        gsap.to(words.map(w => w.el), {
          yPercent: 0, duration: 1.2, ease: 'expo.out',
          delay: i => words[i].line * .11 + (i % 12) * .012,
          scrollTrigger: st(el), onComplete: restore,
        });
      };
      go();
    } else if (kind === 'ink') {
      gsap.fromTo(el, { clipPath: 'inset(-30% 100% -30% -5%)', opacity: .3, filter: 'blur(6px)' },
        { clipPath: 'inset(-30% -5% -30% -5%)', opacity: 1, filter: 'blur(0px)', duration: 2.4, ease: 'power2.inOut', scrollTrigger: st(el, { start: 'top 90%' }), clearProps: 'clipPath,filter' });
    } else if (kind === 'photo') {
      const frame = el.querySelector('.story__frame'), img = frame?.querySelector('img'), arch = el.querySelector('.story__arch');
      const tl = gsap.timeline({ scrollTrigger: st(el, { start: 'top 80%' }) });
      tl.fromTo(frame, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.8, ease: 'expo.inOut' })
        .fromTo(img, { scale: 1.35 }, { scale: 1, duration: 2.4, ease: 'expo.out' }, .2)
        .fromTo(arch, { opacity: 0, scale: .94 }, { opacity: 1, scale: 1, duration: 1.8, ease: 'expo.out' }, .9);
    }
  });

  // Parallax de la foto de la historia
  const sImg = document.querySelector('.story__frame img');
  if (sImg && !reduced) {
    gsap.fromTo(sImg, { yPercent: -8 }, { yPercent: 8, ease: 'none', scrollTrigger: { trigger: '.story__frame', start: 'top bottom', end: 'bottom top', scrub: .6 } });
  }
  // Ornamentos que giran al entrar
  document.querySelectorAll('.ornament').forEach(o => {
    gsap.from(o, { rotate: -180, scale: .3, opacity: 0, duration: 1.6, ease: 'expo.out', scrollTrigger: st(o) });
  });
}

/** Revelado escalonado de la galería con clip-path. */
export function revealGallery({ gsap, ScrollTrigger, reduced, items }) {
  if (!gsap || !ScrollTrigger) { items.forEach(i => i.setAttribute('data-reveal', '')); return; }
  if (reduced) { gsap.from(items, { opacity: 0, duration: .8, stagger: .05, scrollTrigger: { trigger: '#gallery', start: 'top 85%', once: true } }); return; }
  gsap.set(items, { clipPath: 'inset(100% 0% 0% 0% round 14px)' });
  gsap.set(items.map(i => i.querySelector('.ph__img')), { scale: 1.4 });
  ScrollTrigger.batch(items, {
    start: 'top 92%', once: true,
    onEnter: batch => {
      gsap.to(batch, { clipPath: 'inset(0% 0% 0% 0% round 14px)', duration: 1.5, ease: 'expo.inOut', stagger: .12, clearProps: 'clipPath' });
      gsap.to(batch.map(i => i.querySelector('.ph__img')), { scale: 1, duration: 2, ease: 'expo.out', stagger: .12, delay: .15, clearProps: 'transform' });
    },
  });
}

/** Tarjetas de la cuenta regresiva: giran al entrar. */
export function revealCountdown({ gsap, reduced }) {
  if (!gsap || reduced) return;
  const cards = document.querySelectorAll('#countdown .cd');
  gsap.from(cards, {
    rotateX: -95, y: 30, opacity: 0, transformPerspective: 700, transformOrigin: '50% 0%',
    duration: 1.4, ease: 'expo.out', stagger: .1,
    scrollTrigger: { trigger: '#countdown', start: 'top 88%', once: true },
  });
}
