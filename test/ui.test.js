const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

// Interface: menu lateral recolhível e quadros (Kanban) em altura de tela. O comportamento em si é de navegador;
// aqui conferimos que o servidor entrega as peças certas (marcação, estilo e a memória da escolha).
describe('interface: menu recolhível e quadros', () => {
  let app; let prod;
  before(async () => {
    await h.resetDb(); app = await h.startServer();
    await h.createUser({ name: 'Paula', email: 'prod@t.com', role: 'produtora' });
    prod = h.client(app.base); await prod.login('prod@t.com');
  });
  after(async () => { await app.close(); await h.db.close(); });
  const get = async (path) => (await fetch(`${app.base}${path}`)).text();

  it('o menu tem o botão de recolher, o logo vira "p." e a escolha é restaurada antes da pintura', async () => {
    const page = (await prod.get('/')).text;
    assert.match(page, /<button class="icon-btn sidebar-collapse" type="button" data-sidebar-collapse aria-label="Recolher o menu"[^>]*aria-pressed="false"/);
    assert.match(page, /<span class="wm-p">p<\/span><span class="wm-rest">ulso<\/span><span class="dot">\.<\/span>/);
    const theme = await get('/static/theme.js');
    assert.match(theme, /pulso-sidebar/); assert.match(theme, /dataset\.sidebar = 'collapsed'/);
    const js = await get('/static/app.js');
    assert.match(js, /data-sidebar-collapse/); assert.match(js, /localStorage\.setItem\('pulso-sidebar'/);
    assert.match(js, /\.nav a.*a\.title/s, 'dica com o nome de cada item para o menu só de ícones');
  });

  it('estilo: só ícones quando recolhido (só no computador), lista do menu rola e rodapé fica à vista', async () => {
    const css = await get('/static/app.css');
    assert.match(css, /@media \(min-width: 861px\) \{\s*html\[data-sidebar="collapsed"\] \{ --sidebar: 76px; \}/);
    assert.match(css, /html\[data-sidebar="collapsed"\] \.nav a > span:not\(\.nav-count\) \{ display: none; \}/);
    assert.match(css, /\.nav \{[^}]*min-height: 0; overflow-y: auto;/, 'em tela baixa só a lista rola');
    assert.match(css, /@media \(max-width: 860px\) \{ \.sidebar-collapse \{ display: none; \} \}/, 'no celular não existe recolher');
  });

  it('quadros: altura da tela, barra horizontal no pé e rolagem própria em cada coluna', async () => {
    const css = await get('/static/app.css');
    const M = '\\.main:is\\(:has\\(\\.board:not\\(\\.pboard\\)\\), :has\\(\\.pane:not\\(\\[hidden\\]\\) \\.pboard\\)\\)'; // quadros dos convidados e da plateia (este só com a aba à vista)
    assert.match(css, new RegExp(`${M} \\{ height: 100vh;[^}]*overflow: hidden;`));
    assert.match(css, new RegExp(`${M} \\.board \\{ flex: 1; min-height: 0;[^}]*grid-template-rows: minmax\\(0, 1fr\\);[^}]*overflow-x: scroll; overflow-y: hidden; \\}`));
    assert.match(css, new RegExp(`${M} \\.column \\.cards \\{ flex: 1; min-height: 60px; overflow-y: auto;`));
    assert.match(css, /\.board::-webkit-scrollbar \{ height: 14px;/, 'barra horizontal grossa e sempre visível');
    for (const path of ['/episodios', '/convidados', '/patrocinadores']) assert.match((await prod.get(path)).text, /class="board[ "]/, `${path} usa o quadro`);
  });
});
