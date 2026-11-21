// Aprovação por link: lembra o nome de quem responde (só neste navegador) e, no vídeo, cria os comentários na minutagem.
(function () {
  document.documentElement.classList.add('js');
  var KEY = 'aprovar-nome';
  var mmss = function (ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  document.addEventListener('DOMContentLoaded', function () {
    var name = document.querySelector('[data-ap-name]');
    if (name) {
      try { if (!name.value) name.value = localStorage.getItem(KEY) || ''; } catch (e) { /* sem armazenamento: digita de novo */ }
      name.form.addEventListener('submit', function () { try { localStorage.setItem(KEY, name.value.trim()); } catch (e) { /* ok */ } });
    }

    var video = document.querySelector('[data-ap-video]');
    var add = document.querySelector('[data-ap-add]');
    var list = document.querySelector('[data-ap-list]');
    var tpl = document.querySelector('template[data-ap-row]');
    if (!video || !add || !list || !tpl) return;
    var now = add.querySelector('[data-ap-now]');
    var nowMs = function () { return Math.max(0, Math.round((video.currentTime || 0) * 1000)); };
    video.addEventListener('timeupdate', function () { if (now) now.textContent = mmss(nowMs()); });

    add.addEventListener('click', function () {
      video.pause();
      var at = nowMs();
      var row = tpl.content.firstElementChild.cloneNode(true);
      row.querySelector('input[name="c_at"]').value = at;
      row.querySelector('[data-ap-time]').textContent = mmss(at);
      list.appendChild(row);
      row.querySelector('textarea').focus();
    });

    list.addEventListener('click', function (ev) {
      var row = ev.target.closest('.ap-row'); if (!row) return;
      if (ev.target.closest('[data-ap-del]')) { row.remove(); return; }
      if (ev.target.closest('[data-ap-end]')) {
        var start = Number(row.querySelector('input[name="c_at"]').value);
        var end = nowMs();
        if (end <= start) { ev.target.textContent = 'avance o vídeo até o fim do trecho'; return; }
        row.querySelector('input[name="c_end"]').value = end;
        row.querySelector('[data-ap-time]').textContent = mmss(start) + ' – ' + mmss(end);
        ev.target.remove();
      }
      if (ev.target.closest('[data-ap-time]')) {
        var t = Number(row.querySelector('input[name="c_at"]').value);
        if (Number.isFinite(t)) { video.currentTime = t / 1000; video.play(); }
      }
    });
  });
}());
