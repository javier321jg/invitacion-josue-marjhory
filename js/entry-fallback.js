/* ES5 on purpose: a readable invitation remains available when modern modules cannot run. */
(function () {
  function fallback() {
    var app = window.__inv;
    if ((app && (app.gate || (app.shell && app.shell.state.entered))) || document.documentElement.className.indexOf('legacy-entry') !== -1) return;
    var gate = document.getElementById('gate');
    if (!gate) return;
    gate.innerHTML = '<div class="cg-legacy"><p>Cena de compromiso</p><h1>Josué &amp; Marjhory</h1><p>24 de diciembre de 2026</p><img src="assets/botanical/ribbon-idle.webp" alt="Lazo de la invitación"><button type="button" id="legacy-open">Abrir con música</button><button type="button" id="legacy-silent">Entrar sin música</button></div>';
    function enter(sound) {
      if (sound) {
        var audio = document.createElement('audio');
        audio.src = 'assets/audio/cancion.mp3'; audio.loop = true; audio.controls = true;
        audio.className = 'legacy-audio'; document.body.appendChild(audio);
        var p = audio.play(); if (p && p.catch) p.catch(function () {});
      }
      gate.style.display = 'none';
      document.documentElement.className = 'legacy-entry';
      document.getElementById('main').removeAttribute('inert');
      var letter = document.getElementById('legacy-letter');
      letter.hidden = false;
    }
    document.getElementById('legacy-open').onclick = function () { enter(true); };
    document.getElementById('legacy-silent').onclick = function () { enter(false); };
  }
  window.setTimeout(fallback, 9000);
}());
