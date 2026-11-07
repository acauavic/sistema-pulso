// Esqueleto de carregamento. Ao abrir outra página do painel, a área de conteúdo troca o que estava ali pelo contorno da
// tela que vem (lista, cadastro, painel, quadro, calendário), para a pessoa ver que o clique pegou e o que vai aparecer.
// Só aparece se a resposta demorar mais que DELAY (página rápida não pisca). Menu, barra de baixo e bandeja de envios ficam.
(() => {
  const main = document.querySelector('main.main');
  const container = main && main.querySelector(':scope > .container');
  if (!container) return;

  const DELAY = 160; // ms: abaixo disso a página nova chega antes de o esqueleto valer a pena
  const GIVE_UP = 12000; // download (Content-Disposition) não troca de página: o conteúdo volta sozinho
  // links que baixam arquivo ou abrem mídia (não trocam a página)
  const FILE_PATH = /\/baixar$|\/(imagem|video|foto|audio)$|\/(arquivos|fotos|anexos|static)\/|\.(csv|zip|ics|pdf|jpe?g|png|webp|gif|mp4|mov|mp3|wav|m4a|json|xml|txt)$/i;

  let timer = null; let giveUp = null; let page = null; let scrollY = 0;

  const bar = (cls) => `<span class="skel ${cls}"></span>`;
  const repeat = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');
  const head = (tools = true) => `<div class="skel-head"><div class="skel-stack">${bar('skel-kicker')}${bar('skel-title')}</div>${tools ? bar('skel-btn') : ''}</div>`;
  const rows = (n) => `<div class="skel-card skel-rows">${repeat(n, (i) => `<div class="skel-row">${bar('skel-avatar')}<div class="skel-stack skel-grow">${bar(`skel-line w-${[60, 45, 70, 50, 65, 40, 55][i % 7]}`)}${bar('skel-line skel-sm w-25')}</div>${bar('skel-chip')}</div>`)}</div>`;
  const block = (lines) => `<div class="skel-card">${bar('skel-line skel-h w-35')}${repeat(lines, (i) => bar(`skel-line w-${[90, 75, 85, 60][i % 4]}`))}</div>`;

  const SHAPES = {
    list: () => `${head()}<div class="skel-tools">${bar('skel-pill')}${bar('skel-pill')}${bar('skel-pill w-pill2')}</div>${rows(7)}`,
    detail: () => `${head()}<div class="skel-tools">${repeat(4, () => bar('skel-tab'))}</div><div class="skel-split"><div class="skel-col">${block(4)}${block(3)}</div><div class="skel-col">${block(3)}${block(2)}</div></div>`,
    dash: () => `${head(false)}<div class="skel-stats">${repeat(4, () => `<div class="skel-card skel-stat">${bar('skel-line skel-sm w-50')}${bar('skel-num')}</div>`)}</div><div class="skel-split"><div class="skel-col">${rows(4)}</div><div class="skel-col">${block(3)}</div></div>`,
    board: () => `${head()}<div class="skel-tools">${bar('skel-pill')}${bar('skel-pill')}${bar('skel-pill')}</div><div class="skel-board">${repeat(4, (c) => `<div class="skel-colbox">${bar('skel-chip')}${repeat(3 - (c % 2), () => `<div class="skel-tile">${bar('skel-line w-70')}${bar('skel-line skel-sm w-40')}</div>`)}</div>`)}</div>`,
    calendar: () => `${head()}<div class="skel-tools">${bar('skel-pill')}${bar('skel-pill w-pill2')}</div><div class="skel-card skel-cal">${repeat(35, () => `<span class="skel-day">${bar('skel-line skel-sm w-25')}</span>`)}</div>`,
    cards: () => `${head()}${block(3)}${block(4)}`,
  };

  function shapeFor(u) {
    const p = u.pathname.replace(/\/+$/, '') || '/';
    const q = u.searchParams;
    if (/^\/calendario/.test(p)) return 'calendar';
    if (q.get('view') === 'quadro' || q.get('vista') === 'quadro' || (p === '/conteudo' && !q.get('vista'))) return 'board';
    if (/^\/(convidados|patrocinadores|episodios|cortes|tarefas|conteudo\/pedidos|social\/publicacoes|usuarios)\/\d+/.test(p)) return 'detail';
    if (['/', '/gestao', '/financeiro', '/plateia/painel', '/social', '/social/insights', '/gestao/cadencia'].includes(p)) return 'dash';
    if (/^\/(convidados|patrocinadores|episodios|tarefas|notificacoes|lixeira|conteudo|social\/publicacoes|social\/ideias|usuarios|auditoria|financeiro\/|plateia\/painel\/)/.test(p)) return 'list';
    return 'cards';
  }

  function hide() {
    clearTimeout(timer); clearTimeout(giveUp); timer = null;
    if (!page) return;
    page.remove(); page = null;
    main.classList.remove('is-loading'); main.removeAttribute('aria-busy');
    window.scrollTo(0, scrollY);
  }

  function paint(u) {
    if (page) return;
    scrollY = window.scrollY;
    page = document.createElement('div');
    page.className = `skel-page skel-${shapeFor(u)}`;
    page.setAttribute('aria-hidden', 'true');
    page.innerHTML = SHAPES[shapeFor(u)]();
    main.insertBefore(page, container);
    main.classList.add('is-loading'); main.setAttribute('aria-busy', 'true');
    window.scrollTo(0, 0);
    const side = document.querySelector('[data-sidebar].open'); // celular: o menu aberto sai da frente para mostrar a página que vem
    if (side) {
      side.classList.remove('open'); document.documentElement.classList.remove('menu-open');
      document.querySelectorAll('[data-nav-toggle]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
    giveUp = setTimeout(hide, GIVE_UP);
  }

  // Agenda o esqueleto para este endereço (a busca global e outros scripts que trocam de página também chamam).
  function show(href) {
    let u;
    try { u = new URL(href, location.href); } catch { return; }
    if (u.origin !== location.origin || FILE_PATH.test(u.pathname) || u.searchParams.has('baixar') || /^\/(logout|login)$/.test(u.pathname)) return;
    if (u.pathname === location.pathname && u.search === location.search && u.hash) return; // âncora da própria página
    clearTimeout(timer);
    timer = setTimeout(() => paint(u), DELAY);
  }

  // Na bolha, depois dos tratadores da página (janelas, seleção, bandeja de envios): se alguém já cuidou do clique, não entra.
  window.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-no-skeleton')) return;
    const raw = a.getAttribute('href') || '';
    if (raw.startsWith('#') || /^(mailto|tel|javascript|blob|data):/i.test(raw)) return;
    show(a.href);
  });
  // Filtros e buscas (formulário GET) também trocam a página. POST tem o próprio andamento (data-busy).
  window.addEventListener('submit', (e) => {
    const f = e.target;
    if (e.defaultPrevented || !f || f.tagName !== 'FORM' || (f.method || 'get').toLowerCase() !== 'get' || (f.target && f.target !== '_self')) return;
    const u = new URL(f.action || location.href, location.href);
    u.search = new URLSearchParams(new FormData(f)).toString();
    show(u.href);
  });
  // Página com alteração não salva pergunta antes de sair: se a pergunta vier, o esqueleto não entra (e sai, se já entrou).
  window.addEventListener('load', () => {
    window.addEventListener('beforeunload', (e) => { if (e.defaultPrevented || e.returnValue) hide(); });
  });
  // Voltar pelo histórico mostra a página guardada: sem esqueleto por cima.
  window.addEventListener('pageshow', hide);

  window.PulsoSkeleton = { show, hide };
})();
