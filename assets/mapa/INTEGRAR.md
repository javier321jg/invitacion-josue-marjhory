# MAPA → integración en `#final` (para UNIR)

Mini mapa dorado de la ubicación (SPEC, decisión n.º 7). Es auto-montable: basta con poner el bloque HTML y cargar
`css/mapa.css` + `js/mapa.js`. No toca `main.js`, no usa WebGL ni librerías, y no pide nada a otros dominios en ejecución:
el relieve y los vectores están horneados en `assets/mapa/`.

## 1. Bloque HTML (dentro de `#final`)

Va dentro de `<div class="finale__info">`, **después** de `<p class="finale__date">…</p>` y **antes** de
`<button id="volver" …>Volver al inicio ↑</button>`. Cópialo tal cual:

```html
        <!-- MAPA (decisión n.º 7): mini mapa dorado de la ubicación · js/mapa.js + css/mapa.css + assets/mapa/ -->
        <div class="mapa" data-mapa data-kinetic-avoid role="group" aria-label="Mapa de la ubicación">
          <div class="mapa__card">
            <div class="mapa__frame">
              <a class="mapa__map" href="https://maps.app.goo.gl/YyHd2MTtzHGGr5dj7" target="_blank" rel="noopener" data-mapa-url="map"
                 aria-label="Abrir en Google Maps la ubicación: Ahuayro — Pailahuantuna"><span class="mapa__nojs">Ver la ubicación en Google Maps</span></a>
              <div class="mapa__info">
                <p class="mapa__lugar" data-c="EVENT.place">Ahuayro — Pailahuantuna</p>
                <p class="mapa__cuando"><time datetime="2026-12-24T17:00:00-05:00">jueves 24 de diciembre · 5:00 p. m.</time></p>
              </div>
              <p class="mapa__atrib">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Relieve: Mapzen / AWS Terrain Tiles</p>
            </div>
            <div class="mapa__acciones">
              <a class="mapa__btn mapa__btn--oro" href="https://www.google.com/maps/dir/?api=1&amp;destination=-13.479828,-73.81499" target="_blank" rel="noopener" data-mapa-url="ruta">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2 20 4l-7.2 16.5-2.1-7.2z"/></svg><span>Cómo llegar</span></a>
              <a class="mapa__btn" href="https://maps.app.goo.gl/YyHd2MTtzHGGr5dj7" target="_blank" rel="noopener" data-mapa-url="map">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/></svg><span>Abrir en Google Maps</span></a>
            </div>
          </div>
        </div>
```

- Los enlaces y los textos del HTML son el respaldo sin JS. Con JS, `js/mapa.js` los vuelve a poner desde `js/content.js`:
  `data-mapa-url="map"` → `EVENT.mapUrl`, `data-mapa-url="ruta"` → `EVENT.directionsUrl` (ruta desde donde esté el invitado),
  lugar → `EVENT.place`, fecha/hora → `EVENT.weekday/day/monthYear/time/isoStart` ("jueves 24 de diciembre · 5:00 p. m.").
  `data-c="EVENT.place"` también lo rellena `main.js` (`hydrateText`), igual que el resto de la página.
- Todos los enlaces llevan `target="_blank" rel="noopener"`. Tocar el mapa abre `EVENT.mapUrl`.
- `data-kinetic-avoid`: la banda de tipografía cinética no pasa por encima del mapa.

## 2. `<link>` y `<script>` en `index.html` (en el `<head>`)

Justo después de `css/final.css` y `js/final3d.js`:

```html
<link rel="stylesheet" href="css/mapa.css">
<script type="module" src="js/mapa.js"></script>
```

No hay que llamar a nada: `js/mapa.js` monta todo `[data-mapa]` al cargar. Descarga sus datos (`mapa.json` ≈ 107 KB y dos
relieves WebP: 238 KB en escritorio o 120 KB en móvil) solo cuando el mapa está a ≤ 900 px de entrar en pantalla.

## 3. Entradas para `tools/manifest.py`

En `FILES` (un grupo nuevo):

```python
    'mapa (mini mapa de la ubicación)': ['css/mapa.css', 'js/mapa.js', 'assets/mapa/mapa.json',
                                         'assets/mapa/valle.webp', 'assets/mapa/valle-m.webp',
                                         'assets/mapa/pueblo.webp', 'assets/mapa/pueblo-m.webp'],
```

`EXTERNAL`: nada nuevo (el mapa no pide nada fuera del sitio; Google Maps y la página de derechos de OpenStreetMap solo
son enlaces que abre el invitado). Si se quiere dejar constancia, añadir el comentario
`'https://maps.app.goo.gl · https://www.google.com/maps (solo enlaces, sin peticiones)'`.
No van en el manifiesto: `assets/mapa/INTEGRAR.md`, `tools/mapa/**`, `tests/mapa.html`, `shots/mapa/**`.
Luego: `python -E -P tools/manifest.py`.

## 4. Qué hace y cómo se comporta dentro de `#final`

- **Arranca una sola vez y solo cuando se ve de verdad**: además del IntersectionObserver comprueba la opacidad real de los
  contenedores, así que en el diseño fijo de `final3d.js` (bloque 2 con `--fio`) espera a que aparezca el bloque de la cuenta
  regresiva; no se anima "a ciegas" mientras se ve el monograma (probado con `tests/mapa.html?contexto=final`).
- **Secuencia (~7 s)**: relieve del valle del Pampas → ríos y caminos se dibujan como tinta dorada con chispa de luz (la PE-3S
  llega desde Ayacucho y desde Andahuaylas y converge en el lugar) → nombres, rumbos «Ayacucho» y «Andahuaylas», escudo
  «PE-3S» → la cámara baja al pueblo → calles, ruta de acceso iluminada desde la PE-3S (cruce de La Florida) hasta el lugar →
  rayo de luz, cae el pin dorado (anillos entrelazados) con chispas, late con ondas → tarjeta «Ahuayro — Pailahuantuna ·
  jueves 24 de diciembre · 5:00 p. m.».
- **Inclinación 3D** suave con el ratón o con el giroscopio (si el navegador ya entrega `deviceorientation`; no pide permiso
  porque el toque del mapa abre Google Maps).
- **Movimiento reducido** (`prefers-reduced-motion`, `?reduced=1`, `html.reduced` o `__inv.shell.reduced`): estado final
  sin animación, sin latido ni inclinación. **Sin JS**: tarjeta con lugar/fecha/hora y enlaces de texto. **Si fallan los
  datos**: queda el enlace «Ver la ubicación en Google Maps» (y los botones).
- **Alto**: `css/mapa.css` ya trae `#final .mapa { --mapa-max-h: … }` para que, con cuenta regresiva + fecha + mapa, el botón
  «Volver al inicio» quede a la vista en 360×740, 390×844, 768×1024, 1440×900 y 1920×1080 (medido con
  `shots/mapa/final.mjs`). Si FINAL cambia el alto del bloque 2, ajustar solo esa variable (o `--mapa-ar`, `--mapa-max-w`).
  En móvil acostado (alto < 520 px) el bloque 2 de `#final` ya no cabe entero ni sin mapa: si se quiere, dejar que ese
  bloque haga scroll o esconder ahí la cuenta regresiva.
- **Rendimiento**: sin WebGL; un SVG que solo cambia su `viewBox` durante el viaje (los grosores no se recalculan por
  cuadro), relieves como `<img>` compuestos por la GPU. Medido en Chrome real: intro ≈ 100 fps en escritorio y ≈ 88 fps con
  la CPU ×4 más lenta en 390×844 (DPR 2.75); en reposo solo animaciones de `transform`/`opacity` + un trazo pequeño, y se
  pausan fuera de pantalla.

## 5. API (pruebas)

`window.__mapa` (y `window.__inv.mapa` cuando existe): `{ instancias, montar(el) }`. Cada instancia:
`listo` (Promise), `seek(t)`, `play()`, `replay()`, `pausar()`, `t`, `duracion`, `estado()`, `dispose()`.
También se exporta `mountMapa(el, { reducedMotion?, autoplay? })` desde `js/mapa.js`.
Prueba: `tests/mapa.html` (`?mapa-pausa`, `?reduced=1`, `?contexto=final`, `?abajo=1`, `?sinjs=1`).

## 6. Datos (regenerar solo si cambia el punto)

`python -E -P tools/mapa/descargar.py` (OSM por Overpass + teselas Terrarium de AWS, guardado en `tools/mapa/cache/`) y
`python -E -P tools/mapa/hornear.py [--vista]` → `assets/mapa/`. El punto sale de `EVENT.geo` en `js/content.js`.
La ruta de acceso dibujada sale de la red de OpenStreetMap (orientativa); «Cómo llegar» abre la ruta real de Google Maps.
Atribución visible en el mapa: «© OpenStreetMap contributors · Relieve: Mapzen / AWS Terrain Tiles».
