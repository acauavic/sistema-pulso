// Publicação > "Corrigir e reenviar": abre a janela com as redes que falharam já marcadas (ou só a rede da linha clicada)
// e o botão diz para quantas redes vai ("Reenviar para Instagram", "Reenviar para 2 redes"). Sem JS inline (CSP 'self').
(function () {
  const dlg = document.getElementById('modal-reenviar');
  const form = dlg?.querySelector('[data-resend]');
  if (!form) return;
  const go = form.querySelector('[data-resend-go]');
  const boxes = () => [...form.querySelectorAll('input[name="platforms"]:not([disabled])')];
  const failed = (form.dataset.failed || '').split(',').filter(Boolean);
  const nameOf = (b) => b.closest('label')?.querySelector('span')?.firstChild?.textContent.trim() || b.value;
  const sync = () => {
    const on = boxes().filter((b) => b.checked);
    go.disabled = !on.length;
    go.textContent = !on.length ? 'Escolha uma rede' : on.length === 1 ? `Reenviar para ${nameOf(on[0])}` : `Reenviar para ${on.length} redes`;
  };
  // net vazio = as que falharam; net = só aquela rede
  const heading = dlg.querySelector('h2');
  const open = (net, title) => {
    if (heading) heading.textContent = title || 'Corrigir e reenviar';
    boxes().forEach((b) => { b.checked = net ? b.value === net : failed.includes(b.value); b.dispatchEvent(new Event('change', { bubbles: true })); });
    sync();
    if (!dlg.open) dlg.showModal();
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-resend-net]');
    if (btn) open(btn.dataset.resendNet, btn.dataset.resendTitle);
  });
  form.addEventListener('change', (e) => { if (e.target.matches('input[name="platforms"]')) sync(); });
  sync();
}());
