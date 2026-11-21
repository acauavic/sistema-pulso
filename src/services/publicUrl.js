// Onde cada link vive. O painel (a gerência) fica no endereço da casa; o que é público é do projeto
// (`projects.public_host`), e o do Pulso é o endereço de hoje, para nenhum link já enviado quebrar.
// ÚNICO lugar que monta endereço público: `publicUrl(projeto, caminho)`. Link para a equipe usa `panelUrl`.
const config = require('../config');
const projects = require('./projects');

const clean = (h) => String(h || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
const bare = (h) => clean(h).toLowerCase().replace(/:\d+$/, ''); // sem esquema, sem porta: dá para comparar

// Projeto dono de um domínio público (null = domínio do painel, ou endereço nenhum configurado).
const projectByHost = (host) => {
  const h = bare(host);
  if (!h) return null;
  return projects.all().find((p) => p.public_host && bare(p.public_host) === h) || null;
};

const panelHost = () => { try { return bare(new URL(config.appBaseUrl).host); } catch { return ''; } };
const isPanelHost = (host) => Boolean(bare(host)) && bare(host) === panelHost();

// Endereço público de um projeto; sem endereço próprio, o de sempre (desenvolvimento e teste caem aqui).
// Sem projeto (página que é da casa, como o pós-gravação), vale o projeto padrão.
function baseOf(projectId) {
  const p = projects.get(projectId == null ? projects.defaultId() : projectId);
  const host = p && clean(p.public_host);
  return host ? `https://${host}` : config.publicBaseUrl;
}

const publicUrl = (projectId, path = '') => `${baseOf(projectId)}${path}`;
const panelUrl = (path = '') => `${config.appBaseUrl}${path}`;
// Todas as origens em que o sistema abre (o painel, o endereço público de sempre e o de cada projeto): o CORS do bucket
// precisa delas para o navegador enviar direto ao Backblaze do painel e do link do estúdio.
function allOrigins() {
  const list = [config.appBaseUrl, config.publicBaseUrl, ...projects.all().map((p) => (clean(p.public_host) ? `https://${clean(p.public_host)}` : ''))];
  return [...new Set(list.filter(Boolean).map((u) => { try { return new URL(u).origin; } catch { return ''; } }).filter(Boolean))];
}
// Host público de um projeto (vazio = usa o de sempre).
const hostOf = (projectId) => { const p = projects.get(projectId); return p ? clean(p.public_host) : ''; };

// Pasta dos ícones da marca nas páginas públicas (`src/public/brand/<slug>`). Projeto que ainda não tem arquivos
// próprios usa os do projeto padrão, para nenhuma página pública ficar sem ícone.
const BRAND_ROOT = require('path').join(__dirname, '..', 'public', 'brand');
let brandDirs = null;
function brandDirOf(projectId) {
  if (!brandDirs) {
    try { brandDirs = new Set(require('fs').readdirSync(BRAND_ROOT)); } catch { brandDirs = new Set(); }
  }
  const p = projects.get(projectId == null ? projects.defaultId() : projectId);
  const slug = p && brandDirs.has(p.slug) ? p.slug : (projects.get(projects.defaultId()) || { slug: 'pulso' }).slug;
  return `/static/brand/${slug}`;
}

// Folha de estilo da marca do projeto nas páginas públicas (`brand/<slug>/brand.css`), se ele tiver a dele.
// Ela entra depois do CSS da página e troca só os tokens. Sem arquivo, as páginas ficam como estão (o Pulso).
function brandCssOf(projectId) {
  const dir = brandDirOf(projectId);
  const file = require('path').join(__dirname, '..', 'public', dir.replace('/static/', ''), 'brand.css');
  return require('fs').existsSync(file) ? `${dir}/brand.css` : '';
}

module.exports = { allOrigins, publicUrl, panelUrl, baseOf, hostOf, projectByHost, isPanelHost, panelHost, bare, brandDirOf, brandCssOf };
