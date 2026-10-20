// Página "Sem conexão" (offline.html): quando a internet volta, recarrega a página que a pessoa tentou abrir.
window.addEventListener('online', () => window.location.reload());
document.querySelector('[data-retry]')?.addEventListener('click', (e) => { e.preventDefault(); window.location.reload(); });
