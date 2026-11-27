// Pedido de conteúdo: envio das imagens da entrega (post, story, slides do carrossel), uma por vez e na ordem escolhida.
(function () {
  const box = document.querySelector('[data-req-images]');
  if (!box) return;
  const input = box.querySelector('[data-files]');
  const btn = box.querySelector('[data-start]');
  const msg = box.querySelector('[data-msg]');
  btn.addEventListener('click', async () => {
    const files = [...input.files].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
    if (!files.length) { input.click(); return; }
    btn.disabled = true;
    let sent = 0; const fails = [];
    for (const f of files) {
      msg.textContent = `Enviando ${sent + 1} de ${files.length}: ${f.name}…`;
      try {
        const res = await fetch(box.dataset.url, { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream', Accept: 'application/json', 'x-csrf-token': box.dataset.csrf }, body: f });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || !out.ok) throw new Error(out.error || `erro ${res.status}`);
        sent += 1;
      } catch (err) { fails.push(`${f.name}: ${err.message}`); }
    }
    if (!fails.length) { window.location.reload(); return; }
    btn.disabled = false; input.value = '';
    msg.textContent = `${sent} enviada(s). Não foi: ${fails.join(' · ')}`;
    if (sent) setTimeout(() => window.location.reload(), 2500);
  });
}());
