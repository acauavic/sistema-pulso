// Trava da fase do acesso: quem é de um projeto não vê nada do outro, em nenhum caminho.
// O teste lê a tabela de rotas do Express, então rota nova entra aqui sozinha. Em cada item do projeto A há um texto
// marcador; se ele aparecer em qualquer resposta de quem é só do projeto B, o teste falha.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const projects = require('../src/services/projects');

const A = 1; const B = 2; // A = Pulso (o outro), B = Projeto 100 (o da pessoa)
const MARCA = 'MARCADORSECRETOA';

describe('isolamento entre projetos', () => {
  let app; let dela; let casa; const ids = {};
  const q = (sql, p) => h.db.query(sql, p).then((r) => r.rows);
  const one = (sql, p) => q(sql, p).then((r) => r[0]);

  before(async () => {
    await h.resetDb();
    // a pessoa do projeto B: perfil de gestão, mas FORA da equipe da casa e só no projeto dela
    await h.createUser({ name: 'Gestora do Cem', email: 'cem@local.test', role: 'gestao', projects: [B] });
    await h.db.query("UPDATE users SET house = false WHERE email = 'cem@local.test'");
    await h.createUser({ name: 'Casa', email: 'casa@local.test', role: 'superadmin', projects: [A, B] });
    await h.db.query('UPDATE project_members SET finance = true');
    app = await h.startServer();
    dela = h.client(app.base); await dela.login('cem@local.test');
    casa = h.client(app.base); await casa.login('casa@local.test');

    // um item de cada tipo no projeto A, todos com o marcador no texto
    ids.guest = (await one("INSERT INTO guests (name, status, project_id, email, instagram) VALUES ($1,'gravado',$2,'a@a.com','marcaa') RETURNING id", [`${MARCA} Convidado`, A])).id;
    ids.episode = (await one("INSERT INTO episodes (title, guest_id, project_id, number, status, recorded_on) VALUES ($1,$2,$3,901,'gravado','2026-11-01') RETURNING id", [`${MARCA} Episodio`, ids.guest, A])).id;
    ids.sponsor = (await one("INSERT INTO sponsors (company, kind, stage, project_id) VALUES ($1,'negocio','ganho',$2) RETURNING id", [`${MARCA} Empresa`, A])).id;
    ids.clip = (await one("INSERT INTO episode_clips (episode_id, project_id, title, status) VALUES ($1,$2,$3,'pronto') RETURNING id", [ids.episode, A, `${MARCA} Corte`])).id;
    ids.request = (await one("INSERT INTO content_requests (kind, title, status, project_id, episode_id) VALUES ('corte',$1,'pedido',$2,$3) RETURNING id", [`${MARCA} Pedido`, A, ids.episode])).id;
    ids.idea = (await one("INSERT INTO social_ideas (episode_id, kind, title, fingerprint, project_id) VALUES ($1,'corte',$2,$3,$4) RETURNING id", [ids.episode, `${MARCA} Ideia`, `fp-${MARCA}`, A])).id;
    ids.task = (await one("INSERT INTO tasks (title, kind, status, project_id, created_by) VALUES ($1,'geral','a_fazer',$2,(SELECT id FROM users WHERE email='casa@local.test')) RETURNING id", [`${MARCA} Tarefa`, A])).id;
    ids.entry = (await one("INSERT INTO fin_entries (direction, category, description, amount_cents, due_on, project_id) VALUES ('saida','outros',$1,1000,'2026-12-01',$2) RETURNING id", [`${MARCA} Lancamento`, A])).id;
    ids.pauta = (await one("INSERT INTO pautas (kind, episode_id, project_id, state, body) VALUES ('pauta',$1,$2,'elaboracao',$3) RETURNING id", [ids.episode, A, `${MARCA} Pauta`])).id;
    await h.db.query("INSERT INTO audit_log (user_id, action, entity, entity_id, project_id, meta) VALUES ((SELECT id FROM users WHERE email='casa@local.test'),'convidado.criado','guest',$1,$2,$3)", [String(ids.guest), A, { nome: `${MARCA} Convidado` }]);
  });
  after(async () => { await app.close(); await h.db.close(); });

  // Toda rota GET registrada no Express, com os parâmetros trocados por ids do projeto A.
  const getRoutes = () => {
    const out = [];
    const walk = (stack) => (stack || []).forEach((l) => {
      if (l.route && l.route.methods && l.route.methods.get) out.push(...[].concat(l.route.path));
      else if (l.handle && l.handle.stack) walk(l.handle.stack);
    });
    walk(app.app && app.app._router ? app.app._router.stack : []);
    return [...new Set(out.filter((p) => typeof p === 'string'))];
  };
  // caminhos públicos (token na URL), o fluxo de eventos (SSE, que fica aberto) e o que não é página do painel
  const PUBLICOS = /^\/(eventos|convite|convidado|patrocinador|plateia|estudio|pos-gravacao|api\/site|webhooks|agenda\/foto|healthz|favicon|apple-touch-icon|sw\.js|manifest|senha|login|logout|sair|static)/;
  const fill = (p) => p
    .replace(/:(id|gid|guestId)\b/g, (m) => String(/convidado/.test(p) ? ids.guest : /patrocinador/.test(p) ? ids.sponsor : /episodio/.test(p) ? ids.episode : /corte|clip/.test(p) ? ids.clip : /tarefa/.test(p) ? ids.task : /lancamento/.test(p) ? ids.entry : /pedido/.test(p) ? ids.request : /ideia/.test(p) ? ids.idea : /pauta/.test(p) ? ids.pauta : ids.guest))
    .replace(/:(cid|clipId)\b/g, String(ids.clip))
    .replace(/:(eid|episodeId)\b/g, String(ids.episode))
    .replace(/:[A-Za-z_]+(\([^)]*\))?\??/g, '1');

  // pedido com prazo: rota que não responde em 5 s entra na lista de lentas, e o teste segue
  const lentas = [];
  const pedir = async (url) => {
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 5000);
    try { return await dela.get(url, { signal: ctl.signal }); } catch { lentas.push(url); return null; } finally { clearTimeout(prazo); }
  };

  it('nenhuma rota GET do painel mostra o que é do outro projeto', async () => {
    const rotas = getRoutes().filter((p) => !PUBLICOS.test(p));
    assert.ok(rotas.length > 60, `esperava a tabela de rotas do Express, veio ${rotas.length}`);
    const vazaram = [];
    for (const rota of rotas) {
      const url = fill(rota);
      if (/:/.test(url)) continue; // parâmetro que não soube preencher
      const r = await pedir(url);
      if (!r) continue;
      if (typeof r.text === 'string' && r.text.includes(MARCA)) vazaram.push(`${url} (${r.status})`);
      // arquivo, ZIP e planilha não têm texto para conferir: o que vale é não poder abrir
      if (/:/.test(rota) && /\.(zip|png|jpg|jpeg|webp|mp4|ics)$|\/(baixar|arquivo|arquivos|foto|fotos|imagem|video|audio)(\/|$)/.test(url) && r.status === 200) {
        vazaram.push(`${url} (arquivo do outro projeto servido com 200)`);
      }
    }
    assert.deepEqual(vazaram, [], `rotas que mostraram o outro projeto:\n${vazaram.join('\n')}`);
    assert.deepEqual(lentas, [], `rotas que não responderam em 5 s (confira à mão):\n${lentas.join('\n')}`);
  }, { timeout: 240000 });

  it('a página de detalhe do outro projeto responde 404, e a ação também', async () => {
    const detalhes = [
      `/convidados/${ids.guest}`, `/patrocinadores/${ids.sponsor}`, `/episodios/${ids.episode}`,
      `/conteudo/cortes/${ids.clip}`, `/tarefas/${ids.task}`, `/conteudo/pedidos/${ids.request}`,
    ];
    for (const url of detalhes) {
      const r = await dela.get(url);
      assert.equal(r.status, 404, `${url} devia ser 404 para quem não é do projeto (veio ${r.status})`);
      assert.ok(!String(r.text).includes(MARCA), `${url} mostrou o marcador`);
    }
    // POST também: nada muda e a resposta não é sucesso
    const acoes = [
      [`/convidados/${ids.guest}/arquivar`, {}], [`/tarefas/${ids.task}`, { title: 'mudou' }],
      [`/financeiro/lancamentos/${ids.entry}/pagar`, { amount: '10,00', paid_on: '2026-12-01' }],
    ];
    for (const [url, form] of acoes) {
      const r = await dela.act(url, form, { from: '/' });
      assert.ok([403, 404].includes(r.status), `${url} devia recusar (veio ${r.status})`);
    }
    assert.equal((await one('SELECT title FROM tasks WHERE id = $1', [ids.task])).title, `${MARCA} Tarefa`);
    assert.equal((await one('SELECT status FROM fin_entries WHERE id = $1', [ids.entry])).status, 'previsto');
  });

  it('busca, avisos, assistente, auditoria e lixeira não mostram o outro projeto', async () => {
    const busca = await dela.get(`/buscar?q=${MARCA}`);
    assert.ok(!busca.text.includes(MARCA), 'a busca global achou o que é do outro projeto');
    const avisos = await dela.get('/notificacoes');
    assert.ok(!avisos.text.includes(MARCA));
    // o que é da casa some para quem não é da casa
    for (const url of ['/usuarios', '/auditoria', '/integracoes', '/gestao/categorias', '/gestao/projetos', '/financeiro/estoque']) {
      const r = await dela.get(url);
      // 403 (permissão da casa) ou 404 (módulo que o projeto dela não usa): em nenhum dos dois ela entra
      assert.ok([403, 404].includes(r.status), `${url} é da casa: devia recusar (veio ${r.status})`);
    }
    const lixeira = await dela.get('/lixeira');
    assert.ok([200, 403].includes(lixeira.status));
    if (lixeira.status === 200) assert.ok(!lixeira.text.includes(MARCA));
  });

  it('o chat só encontra quem divide um projeto com ela', async () => {
    await h.createUser({ name: 'Só do Pulso', email: 'sopulso@local.test', role: 'produtora', projects: [A] });
    const r = await dela.get('/mensagens/pessoas');
    if (r.status === 200) {
      assert.ok(!r.text.includes('Só do Pulso'), 'o chat mostrou gente de outro projeto');
      assert.ok(r.text.includes('Casa'), 'quem divide projeto aparece');
    }
  });

  it('o assistente e as menções do chat não encontram o outro projeto', async () => {
    // o assistente responde por ferramentas: aqui o que importa é o que elas enxergam
    const lookup = require('../src/services/assistantLookup');
    const semRecorte = await lookup.guest(`${MARCA} Convidado`);
    assert.ok(semRecorte.row, 'sem recorte (rotina), o lookup acha');
    const comRecorte = await lookup.guest(`${MARCA} Convidado`, [B]);
    assert.ok(comRecorte.erro, 'com o recorte do projeto dela, não acha o convidado do outro');
    for (const [fn, termo] of [[lookup.sponsor, `${MARCA} Empresa`], [lookup.episode, `${MARCA} Episodio`], [lookup.task, `${MARCA} Tarefa`]]) {
      assert.ok((await fn(termo, [B])).erro, `${termo} não devia ser encontrado`);
    }
    // menção do chat: a busca que alimenta o "@" também segue o recorte
    const refs = await require('../src/services/search').references(MARCA, { role: 'gestao', house: false }, [B]);
    assert.deepEqual(refs, []);
  });

  it('o financeiro de um projeto só mostra a parte dele', async () => {
    const r = await dela.get('/financeiro/lancamentos');
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes(MARCA));
  });

  it('toda chamada de permissão passa a pessoa, não o perfil', () => {
    // can(user, perm) é o que confere "equipe da casa"; can(perfil, perm) não sabe disso
    const root = path.join(__dirname, '..', 'src');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))
      .filter((f) => f.endsWith('.js') && !path.basename(f).startsWith('._'));
    const ruins = [];
    for (const f of walk(root)) {
      const t = fs.readFileSync(f, 'utf8');
      for (const m of t.matchAll(/\bcan\(\s*(?:req\.)?[A-Za-z_$][\w$]*\??\.role\b/g)) ruins.push(`${path.relative(root, f)}: ${m[0]}`);
    }
    assert.deepEqual(ruins, [], `chamadas de can() com o perfil em vez da pessoa:\n${ruins.join('\n')}`);
  });

  it('o cadastro do usuário mostra onde a pessoa trabalha e o interruptor da casa', async () => {
    const id = (await one("SELECT id FROM users WHERE email = 'cem@local.test'")).id;
    const page = await casa.get(`/usuarios/${id}/editar`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Onde essa pessoa trabalha/);
    assert.match(page.text, /name="projetos" value="1"/);
    assert.match(page.text, /name="projetos" value="2"[^>]*checked/, 'ela participa do Projeto 100');
    assert.match(page.text, /name="funcao_2"/, 'e a função em cada projeto (o financeiro vem da função)');
    assert.match(page.text, /name="house" value="1"/);
    assert.match(page.text, /SÓ DOS PROJETOS MARCADOS/, 'o interruptor mostra o estado em mono');
    // a gestão da casa também vê os campos de endereço e marca do projeto
    const proj = await casa.get('/gestao/projetos');
    assert.match(proj.text, /Fora do painel: nome público, endereço e e-mails/);
    assert.match(proj.text, /name="public_host"/);
    assert.match(proj.text, /name="ai_context"/);
  });

  it('a gestão da casa continua vendo tudo', async () => {
    const r = await casa.get('/convidados');
    assert.equal(r.status, 200);
    assert.ok(r.text.includes(MARCA), 'quem é da casa vê os dois projetos');
    assert.equal((await casa.get('/usuarios')).status, 200);
    assert.equal((await casa.get(`/convidados/${ids.guest}`)).status, 200);
  });
});
