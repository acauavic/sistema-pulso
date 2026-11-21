// Um passo logo na entrada: o domínio decide o que a página pode ser.
// - domínio do painel: tudo do painel (e um link público aberto ali é levado ao domínio do projeto dono do link);
// - domínio de um projeto: só as páginas públicas e os avisos que vêm de fora; qualquer tela do painel vai para o painel.
// Sem `projects.public_host` configurado (desenvolvimento e teste), nada é redirecionado: tudo segue num endereço só.
const pu = require('./publicUrl');
const projects = require('./projects');

// Caminhos que existem no domínio de um projeto. O resto é painel.
const PUBLIC = [
  /^\/convite(\/|$)/, /^\/convidado(\/|$)/, /^\/patrocinador(\/|$)/, /^\/agenda\/foto\//, /^\/plateia(\/|$)/,
  /^\/estudio(\/|$)/, /^\/pos-gravacao(\/|$)/, /^\/aprovar(\/|$)/, /^\/extrato(\/|$)/, /^\/api\/site\//, /^\/webhooks(\/|$)/,
  /^\/static\//, /^\/favicon\.ico$/, /^\/apple-touch-icon\.png$/, /^\/healthz$/, /^\/robots\.txt$/,
];
const isPublicPath = (p) => PUBLIC.some((re) => re.test(String(p || '')));

// `req.hostname` já considera o X-Forwarded-Host do Caddy (app.set('trust proxy', 1)).
async function middleware(req, res, next) {
  try {
    await projects.refresh(); // a lista fica em memória por 30 s; aqui ela também vale antes do login
    const project = pu.projectByHost(req.hostname);
    req.hostProject = project;
    res.locals.hostProject = project;
    // marca das páginas públicas (ícones): a do projeto do domínio; no painel, a do projeto padrão
    res.locals.brandDir = pu.brandDirOf(project && project.id);
    res.locals.brandCss = pu.brandCssOf(project && project.id); // marca do projeto nas páginas públicas (vazio = a de sempre)
    if (!project) return next(); // domínio do painel (ou endereço único): segue o jogo
    if (isPublicPath(req.path)) return next();
    return res.redirect(302, pu.panelUrl(req.originalUrl)); // tela do painel num domínio de projeto
  } catch (err) {
    return next(err);
  }
}

// Link público aberto no domínio errado: devolve o endereço certo (null = está no lugar certo).
// Vale nos dois sentidos: link de projeto no domínio do painel, e link de um projeto no domínio de outro.
function wrongHost(req, projectId) {
  const host = pu.hostOf(projectId);
  if (!host) return null; // projeto sem endereço próprio: tudo continua onde está
  if (pu.bare(req.hostname) === pu.bare(host)) return null;
  return `https://${host}${req.originalUrl}`;
}

module.exports = { middleware, wrongHost, isPublicPath, PUBLIC };
