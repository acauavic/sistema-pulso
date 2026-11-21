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
      `SELECT u.house, u.last_project_id,
              (SELECT coalesce(json_agg(json_build_object('id', pm.project_id, 'finance', pm.finance)), '[]'::json) FROM project_members pm WHERE pm.user_id = u.id) AS memberships
         FROM users u WHERE u.id = $1`, [req.user.id]);
    const mine = new Map(((u && u.memberships) || []).map((m) => [m.id, m]));
    const list = projects.all().filter((p) => mine.has(p.id));
    const multi = list.length > 1;
    // um projeto só: é ele, sem escolha. Mais de um: o último escolhido, se ainda vale; vazio = todos.
    const current = multi ? list.find((p) => p.id === (u && u.last_project_id)) || null : list[0] || null;
    const scope = {
      projects: list, ids: list.map((p) => p.id), current, multi, house: Boolean(u && u.house),
      financeIds: list.filter((p) => mine.get(p.id).finance).map((p) => p.id),
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
const idsOf = (req) => (req.scope.current ? [req.scope.current.id] : req.scope.ids);

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
  if (s.current) return s.current.id;
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
const PATH_MODULES = [[/^\/convidados/, 'convidados'], [/^\/patrocinadores/, 'patrocinio'], [/^\/(episodios|conteudo|cortes|capas)/, 'producao'],
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
const localPath = (value) => (typeof value === 'string' && /^\/(?![/\\])/.test(value) && !/[\\\r\n]/.test(value) ? value.slice(0, 2000) : '/');

module.exports = { attach, where, idsOf, financeIdsOf, target, assert, canSee, localPath, moduleOfPath, requireModule };
