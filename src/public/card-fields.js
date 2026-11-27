// "Campos do cartão" (partials/card-fields.ejs): mostra ou esconde as partes dos cartões marcadas com data-cf="chave",
// conforme a escolha de cada pessoa, guardada neste navegador (localStorage "pulso-cartao:<quadro>"). "Restaurar padrão" apaga a
// escolha e volta ao cartão de sempre. Sem a escolha guardada (ou sem localStorage), vale o padrão que o servidor já desenhou.
(function () {
  'use strict';
  document.querySelectorAll('[data-cf-menu]').forEach((menu) => {
    const list = menu.getAttribute('data-cf-menu');
    const defEl = document.querySelector(`[data-cf-def="${list}"]`);
    let defaults = []; try { defaults = JSON.parse(defEl.textContent); } catch { return; }
    const KEY = `pulso-cartao:${list}`;
    const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(v) ? v : null; } catch { return null; } };
    const save = (keys) => { try { localStorage.setItem(KEY, JSON.stringify(keys)); } catch { /* sem localStorage: vale só nesta página */ } };
    const boxes = [...menu.querySelectorAll('[data-cf-toggle]')];
    function apply(keys) {
      const on = new Set(keys);
      document.querySelectorAll('[data-cf]').forEach((el) => { el.hidden = !on.has(el.getAttribute('data-cf')); });
      boxes.forEach((b) => { b.checked = on.has(b.value); });
    }
    const stored = read();
    if (stored) apply(stored);
    boxes.forEach((b) => b.addEventListener('change', () => { const keys = boxes.filter((x) => x.checked).map((x) => x.value); save(keys); apply(keys); }));
    menu.querySelector('[data-cf-reset]').addEventListener('click', () => { try { localStorage.removeItem(KEY); } catch { /* idem */ } apply(defaults); });
  });
}());
