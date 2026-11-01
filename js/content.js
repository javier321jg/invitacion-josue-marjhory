// Textos de la invitación (fuente única). Los usan index.html/main.js y el pergamino 3D (parchment.js).
export const COUPLE = { a: 'Josué', b: 'Marjhory', monogram: 'J & M' };

export const EVENT = {
  title: 'Cena de compromiso',
  isoStart: '2026-12-24T17:00:00-05:00',
  isoEnd: '2026-12-24T23:00:00-05:00',
  weekday: 'Jueves',
  day: '24',
  monthYear: 'diciembre 2026',
  time: '5:00',
  timeLabel: 'de la tarde',
  dateShort: '24 · 12 · 2026',
  dateLong: '24 de diciembre de 2026',
  place: 'Ahuayro — Pailahuantuna',
  mapUrl: 'https://maps.app.goo.gl/YyHd2MTtzHGGr5dj7',
  // Coordenadas del enlace del mapa (maps.app.goo.gl resuelve a /maps/search/-13.479828,-73.814990)
  geo: { lat: -13.479828, lng: -73.81499 },
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=-13.479828,-73.81499',
};

// Orden y contenido del texto escrito sobre el pergamino.
export const PARCHMENT_TEXT = {
  kicker: 'Te invitamos a nuestra',
  title: 'Cena de compromiso',
  flourish: '❦',
  names: ['Josué', 'y', 'Marjhory'],
  verse: ['“Dios pone el tiempo y el lugar adecuado', 'para poder amar para toda la vida.”'],
  details: [
    { label: 'Jueves', value: '24', sub: 'diciembre 2026' },
    { label: 'Hora', value: '5:00', sub: 'de la tarde' },
  ],
  placeLabel: 'Lugar',
  place: 'Ahuayro — Pailahuantuna',
  closing: ['Esperamos compartir contigo', 'este momento inolvidable.'],
};

export const HERO = {
  eyebrow: 'Una invitación para ti',
  subtitle: 'Un paso más en nuestra historia',
};

export const STORY = {
  eyebrow: 'Juntos es nuestro lugar favorito',
  title: ['Un paso más', 'en nuestra historia'],
  body: 'Hay momentos que merecen ser celebrados con las personas que más queremos. Nos encantaría que seas parte de este nuevo comienzo.',
  signature: 'Josué & Marjhory',
  photo: 'assets/photos/referencia-1.jpg',
};

export const MOMENTS = {
  eyebrow: 'Pequeños instantes, grandes recuerdos',
  title: 'Nuestros momentos',
  subtitle: 'Una historia que seguimos escribiendo juntos.',
  // referencia-2.jpg es idéntica a referencia-1.jpg (misma foto), por eso no se repite aquí.
  photos: [3, 4, 5, 6, 7, 8].map(n => `assets/photos/referencia-${n}.jpg`),
};

export const FINALE = {
  lead: 'Nos encantará celebrar contigo',
  back: 'Volver al inicio ↑',
};

// Avisos de la interfaz
export const UI = {
  seguir: 'Desliza para continuar', // aparece si el invitado se detiene con el pergamino ya escrito (decisión n.º 9.2)
};
