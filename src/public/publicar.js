// Janela de publicar (corte e Novo post): o botão diz o destino ("Publicar em 2 redes", "Agendar em 3 redes") e só libera
// quando há rede marcada e o "Entendi" está marcado. Em modo de teste, o texto fica "Montar pedido (modo de teste)".
(function () {
  document.querySelectorAll('form[data-publish]').forEach((form) => {
    const btn = form.querySelector('[data-publish-submit]'); if (!btn) return;
    const test = form.dataset.publish === 'test';
    const sync = () => {
      const n = form.querySelectorAll('input[name="platforms"]:checked:not(:disabled)').length;
      const when = form.querySelector('input[name="agendar"]')?.value;
      const confirm = form.querySelector('input[name="confirmar"]');
      const okConfirm = !confirm || confirm.checked;
      btn.disabled = !n || !okConfirm;
      if (!n) btn.textContent = 'Marque pelo menos uma rede';
      else if (test) btn.textContent = 'Montar pedido (modo de teste)';
      else btn.textContent = `${when ? 'Agendar' : 'Publicar'} em ${n} ${n === 1 ? 'rede' : 'redes'}`;
      btn.title = okConfirm ? '' : 'Marque "Entendi que isto publica nas redes escolhidas"';
    };
    form.addEventListener('change', sync); form.addEventListener('input', sync);
    sync();
  });
})();
