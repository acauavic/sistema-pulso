// Janela "Calendário de posts" (aba Portal do convidado): acrescenta e tira linhas. A linha nova já vem com o dia seguinte ao da última.
(function () {
  const box = document.querySelector('[data-plan-rows]');
  const tpl = document.querySelector('template[data-plan-row]');
  if (!box || !tpl) return;
  const nextDay = (iso) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  document.querySelector('[data-plan-add]')?.addEventListener('click', () => {
    const lastDate = [...box.querySelectorAll('input[type=date]')].map((i) => i.value).filter(Boolean).pop();
    const lastTime = [...box.querySelectorAll('input[type=time]')].map((i) => i.value).filter(Boolean).pop();
    const row = tpl.content.firstElementChild.cloneNode(true);
    if (lastDate) row.querySelector('input[type=date]').value = nextDay(lastDate);
    if (lastTime) row.querySelector('input[type=time]').value = lastTime;
    box.appendChild(row);
    row.querySelector('input').focus();
  });
  box.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-plan-remove]');
    if (rm) rm.closest('[data-plan-line]').remove();
  });
}());
