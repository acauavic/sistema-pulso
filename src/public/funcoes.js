// Gestão > Funções: os atalhos de nível (Não vê | Vê | Edita | Gerencia) marcam as caixas da área; mexer nas caixas atualiza o nome do nível.
(function () {
  var NAMES = { nenhum: 'Não vê', ve: 'Vê', edita: 'Edita', gerencia: 'Gerencia', parcial: 'Sob medida' };
  var split = function (s) { return (s || '').split(' ').filter(Boolean); };
  function levelOf(area) {
    var on = function (list) { return list.every(function (p) { var b = area.querySelector('input[value="' + p + '"]'); return b && b.checked; }); };
    var r = split(area.dataset.read); var e = split(area.dataset.edit); var m = split(area.dataset.manage);
    var any = Array.prototype.some.call(area.querySelectorAll('input[type="checkbox"]'), function (b) { return b.checked; });
    if (!any) return 'nenhum';
    if (m.length && on(r.concat(e, m))) return 'gerencia';
    if (e.length && on(r.concat(e))) return 'edita';
    if (on(r)) return 've';
    return 'parcial';
  }
  function paint(area) {
    var lv = levelOf(area);
    var label = area.querySelector('[data-role-level-label]'); if (label) label.textContent = NAMES[lv];
    area.querySelectorAll('[data-role-level]').forEach(function (b) { b.classList.toggle('on', b.dataset.roleLevel === lv); b.setAttribute('aria-pressed', b.dataset.roleLevel === lv ? 'true' : 'false'); });
  }
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-role-level]'); if (!btn) return;
    var area = btn.closest('[data-role-area]');
    var r = split(area.dataset.read); var e = split(area.dataset.edit); var m = split(area.dataset.manage);
    var want = { nenhum: [], ve: r, edita: r.concat(e), gerencia: r.concat(e, m) }[btn.dataset.roleLevel] || [];
    area.querySelectorAll('input[type="checkbox"]').forEach(function (b) { b.checked = want.indexOf(b.value) >= 0; });
    paint(area);
  });
  document.addEventListener('change', function (ev) { var area = ev.target.closest && ev.target.closest('[data-role-area]'); if (area) paint(area); });
  document.addEventListener('DOMContentLoaded', function () { document.querySelectorAll('[data-role-area]').forEach(paint); });
}());
