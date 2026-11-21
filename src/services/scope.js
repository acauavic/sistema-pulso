// O recorte de cada pessoa: de quais projetos ela participa e qual está escolhido no menu. ÚNICO lugar que decide isso.
// Toda lista de coisa que pertence a um projeto passa por `where`; toda página de detalhe, por `assert`; toda criação, por `target`.
// Consulta nova de lista sem `scope.where` é erro de revisão.
const db = require('../db/pool');
const projects = require('./projects');

// Depois do login: monta req.scope e os auxiliares das telas (seletor, sigla nos cartões, nome dos vídeos, módulos do menu).
async function attach(req, res, next) {
  try {
    if (!req.user) return next();
    const { rows: [u] } = await db.query(
      `SELECT u.house, u.last_project_id, u.role_id,
              (SELECT coalesce(json_agg(json_build_object('id', pm.project_id, 'finance', pm.finance, 'role_id', pm.role_id)), '[]'::json) FROM project_members pm WHERE pm.user_id = u.id) AS memberships
         FROM users u WHERE u.id = $1`, [req.user.id]);
    const mine = new Map(((u && u.memberships) || []).map((m) => [m.id, m]));
    const list = projects.all().filter((p) => mine.has(p.id));
    const multi = list.length > 1;
    // um projeto só: é ele, sem escolha. Mais de um: o último escolhido, se ainda vale; vazio = todos.
    const current = multi ? list.find((p) => p.id === (u && u.last_project_id)) || null : list[0] || null;
    // funções: a padrão e a de cada projeto (services/roles.js). `can(pessoa, permissão, projeto)` lê daqui.
    const access = require('./roles').forUser({ ...req.user, role_id: u && u.role_id }, list.map((p) => mine.get(p.id)));
    req.user.perms = access.perms;
    req.user.projectPerms = access.projectPerms;
    const { can } = require('../permissions');
    const scope = {
      projects: list, ids: list.map((p) => p.id), current, multi, house: Boolean(u && u.house),
      // o dinheiro de um projeto: quem tem, naquele projeto, uma função que vê o financeiro
      financeIds: list.filter((p) => can(req.user, 'finance.read', p.id)).map((p) => p.id),
    };
    req.scope = scope;
    res.locals.projectScope = scope; // ("scope" já é o nome do filtro Minhas | Hoje | Todas da tela de Tarefas)
    // a sigla só aparece para quem vê mais de um projeto, e só quando o item é de um projeto diferente do escolhido
    res.locals.projectTag = (projectId) => {
      if (!multi || projectId == null || (current && current.id === Number(projectId))) return '';
      const p = projects.get(projectId);
      return p ? p.sigla : '';
    };
    res.locals.videoLabel = current ? projects.label(current) : (new Set(list.map((p) => projects.label(p))).size > 1 ? 'Episódios e vídeos' : projects.label(list[0]));
    res.locals.hasModule = (key) => (current ? projects.has(current, key) : !list.length || list.some((p) => projects.has(p, key)));
    return next();
  } catch (err) {
    return next(err);
  }
}

// Ids que valem agora: o projeto escolhido, ou todos os da pessoa.
// Com um projeto escolhido no menu, só ele (se a função dela naquele projeto permite a tela aberta; senão, nenhum).
const idsOf = (req) => (req.scope.current ? (req.scope.ids.includes(req.scope.current.id) ? [req.scope.current.id] : []) : req.scope.ids);

// A rota pediu `permission`: daqui em diante o recorte vale só nos projetos em que a função da pessoa dá essa permissão.
// É o que faz a função por projeto valer em listas e em detalhes (o `assert` do carregamento responde 404 fora disso).
function narrow(req, permission) {
  if (!req.scope || !req.user || !req.user.projectPerms) return;
  const { can } = require('../permissions');
  req.scope.ids = req.scope.ids.filter((id) => can(req.user, permission, id));
  req.scope.financeIds = req.scope.financeIds.filter((id) => req.scope.ids.includes(id));
}

// Encaixa no padrão das rotas (where[] e params[] com $n): empurra o recorte para a tabela de apelido `alias`.
// `orNull`: aceita também o que não tem projeto (tarefa geral aparece em qualquer recorte).
function where(req, clauses, params, alias, { orNull = false } = {}) {
  params.push(idsOf(req));
  const cond = `${alias}.project_id = ANY($${params.length}::int[])`;
  clauses.push(orNull ? `(${alias}.project_id IS NULL OR ${cond})` : cond);
}

// Projeto de um item novo e solto (sem vínculo de onde herdar): o escolhido no menu; em "Todos os projetos", o que veio no
// formulário (se a pessoa participa dele); quem tem um projeto só cai nele. null = falta escolher.
function target(req, body = {}) {
  const s = req.scope;
  if (s.current) return s.ids.includes(s.current.id) ? s.current.id : null; // a função dela no projeto escolhido não permite: não cria
  const sent = Number(body.project_id);
  if (s.ids.includes(sent)) return sent;
  return s.ids.length === 1 ? s.ids[0] : null;
}

// Recorte do dinheiro: dentro do recorte atual, só os projetos em que a pessoa vê o financeiro.
const financeIdsOf = (req) => idsOf(req).filter((id) => req.scope.financeIds.includes(id));

const canSee = (req, projectId) => projectId == null || req.scope.ids.includes(Number(projectId));

// Página de detalhe: item de projeto de que a pessoa não participa responde 404 (como se não existisse).
function assert(req, projectId) {
  if (canSee(req, projectId)) return;
  const err = new Error('Fora do recorte da pessoa');
  err.status = 404;
  throw err;
}

// De que módulo é uma tela (projects.modules): ao trocar para um projeto que não usa o módulo da tela aberta, a pessoa vai para o Início.
const PATH_MODULES = [[/^\/convidados/, 'convidados'], [/^\/patrocinadores/, 'patrocinio'], [/^\/(episodios|conteudo|cortes|capas|sessoes)/, 'producao'],
  [/^\/social/, 'redes'], [/^\/plateia/, 'plateia'], [/^\/financeiro/, 'financeiro'], [/^\/pautas/, 'producao'], [/^\/duplicatas/, 'convidados']];
const moduleOfPath = (p) => (PATH_MODULES.find(([re]) => re.test(String(p || ''))) || [])[1] || null;

// Tela de um módulo que NENHUM projeto da pessoa usa não existe para ela (404): o menu já não mostra, e isto fecha o
// caminho pelo endereço. Vale pelos projetos dela, não pelo escolhido no menu: trocar de projeto já leva ao Início
// (moduleOfPath), e o que foi criado antes de o módulo ser desligado continua alcançável.
function requireModule(req, res, next) {
  const key = moduleOfPath(req.path);
  if (!key || !req.scope) return next();
  const list = req.scope.projects || [];
  if (!list.length || list.some((p) => projects.has(p, key))) return next();
  return next(Object.assign(new Error('Módulo não usado pelos projetos da pessoa'), { status: 404 }));
}

// Só caminho do próprio painel (nunca um endereço de fora): para onde voltar depois de trocar o projeto.
// ---------------------------------------------------------------- guarda do item na URL
// Toda rota com o id de um item no endereço (convidado, patrocinador, vídeo, corte, pedido, capa, tarefa, pauta, sessão,
// publicação, comentário, ideia, inscrição da plateia) passa por aqui: item de projeto fora do recorte responde 404, em GET e
// em POST, sem depender de cada rota lembrar. Depois do `requirePerm`, vale o recorte já estreitado pela função.
const PUB_PROJECT = `SELECT coalesce(c.project_id, e.project_id) AS project_id FROM episode_publications p
  LEFT JOIN episodes e ON e.id = p.episode_id LEFT JOIN episode_clips c ON c.id = p.clip_id`;
const ITEMS = [
  [/^\/convidados\/(\d+)(?:\/|$)/, 'SELECT project_id FROM guests WHERE id = $1'],
  [/^\/patrocinadores\/(\d+)(?:\/|$)/, 'SELECT project_id FROM sponsors WHERE id = $1'],
  [/^\/episodios\/(\d+)(?:\/|$)/, 'SELECT project_id FROM episodes WHERE id = $1'],
  [/^\/(?:conteudo\/)?cortes\/(\d+)(?:\/|$)/, 'SELECT project_id FROM episode_clips WHERE id = $1'],
  [/^\/conteudo\/pedidos\/(\d+)(?:\/|$)/, 'SELECT project_id FROM content_requests WHERE id = $1'],
  [/^\/capas\/(\d+)(?:\/|$)/, `SELECT coalesce((SELECT project_id FROM episodes WHERE id = c.episode_id), (SELECT project_id FROM episode_clips WHERE id = c.clip_id),
      (SELECT project_id FROM content_requests WHERE id = c.request_id)) AS project_id FROM episode_covers c WHERE c.id = $1`],
  [/^\/tarefas\/(\d+)(?:\/|$)/, 'SELECT project_id FROM tasks WHERE id = $1'],
  [/^\/pautas\/(\d+)(?:\/|$)/, 'SELECT project_id FROM pautas WHERE id = $1'],
  [/^\/sessoes\/(\d+)(?:\/|$)/, 'SELECT project_id FROM recording_sessions WHERE id = $1'],
  [/^\/aprovacoes\/(\d+)(?:\/|$)/, 'SELECT project_id FROM approval_links WHERE id = $1'],
  [/^\/social\/publicacoes\/(\d+)(?:\/|$)/, `${PUB_PROJECT} WHERE p.id = $1`],
  [/^\/social\/comentarios\/(\d+)(?:\/|$)/, `${PUB_PROJECT} WHERE p.id = (SELECT publication_id FROM social_comments WHERE id = $1)`],
  [/^\/social\/ideias\/(\d+)(?:\/|$)/, 'SELECT project_id FROM social_ideas WHERE id = $1'],
  [/^\/plateia\/painel\/leads\/(\d+)(?:\/|$)/, 'SELECT g.project_id FROM plateia_leads l LEFT JOIN guests g ON g.id = l.guest_id WHERE l.id = $1'],
];

// { found, projectId } do item do endereço (guardado no pedido), ou null quando o endereço não aponta para um item.
async function itemProject(req) {
  if (Object.prototype.hasOwnProperty.call(req, 'itemProject')) return req.itemProject;
  let out = null;
  for (const [re, sql] of ITEMS) {
    const m = String(req.path || '').match(re);
    if (!m) continue;
    const id = Number(m[1]);
    if (!Number.isSafeInteger(id) || id > 2147483647) break;
    const { rows: [r] } = await db.query(sql, [id]);
    out = r ? { found: true, projectId: r.project_id } : { found: false };
    break;
  }
  req.itemProject = out;
  return out;
}
const outside = (req, it) => Boolean(it && it.found && it.projectId != null && !req.scope.ids.includes(Number(it.projectId)));
const notHere = () => Object.assign(new Error('Item de projeto fora do recorte da pessoa'), { status: 404 });

// Depois do login e do recorte: o item precisa ser de um projeto da pessoa.
async function guardItem(req, res, next) {
  try {
    if (!req.scope) return next();
    return next(outside(req, await itemProject(req)) ? notHere() : undefined);
  } catch (err) { return next(err); }
}
// Depois do `requirePerm`: o item precisa ser de um projeto em que a função dela dá a permissão da rota.
async function guardNarrowed(req) {
  if (!req.scope) return true;
  return !outside(req, await itemProject(req));
}

const localPath = (value) => (typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/[\\\r\n]/.test(value) ? value.slice(0, 2000) : '/');

module.exports = { attach, where, idsOf, narrow, guardItem, guardNarrowed, itemProject, ITEMS, financeIdsOf, target, assert, canSee, localPath, moduleOfPath, requireModule };
