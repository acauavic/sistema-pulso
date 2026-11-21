const express = require('express');
const path = require('path');
const db = require('./db/pool');
const mw = require('./middleware');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do Caddy, que manda um X-Forwarded-For só (o IP real, inclusive via Cloudflare): req.ip e cookie Secure corretos
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/static', require('./utils/staticFiles').staticFiles(mw.staticDir)); // Brotli/gzip prontos em memória + cache longo com ?v=
  // O domínio decide o que a página pode ser: painel na casa, público no projeto (services/hostContext.js).
  app.use(require('./services/hostContext').middleware);
  // Ícones na raiz: o navegador e o iOS pedem esses caminhos sozinhos (convite e media kit não têm <link rel="icon">).
  // No domínio de um projeto, o ícone é o dele; no painel, o monograma "St".
  const brandFile = (req, name) => {
    const slug = req.hostProject && req.hostProject.slug;
    const file = slug && path.join(mw.staticDir, 'brand', slug, name);
    return file && require('fs').existsSync(file) ? file : path.join(mw.staticDir, name);
  };
  app.get('/favicon.ico', (req, res) => res.sendFile(brandFile(req, 'favicon.ico'), { maxAge: '7d' }));
  // Service worker na raiz (escopo = painel inteiro) e manifesto do app (iPhone: alertas só com o painel na Tela de Início).
  // O sw.js leva a versão dos arquivos: a cada deploy o navegador vê um service worker novo e troca o cache do app.
  const swSource = require('fs').readFileSync(path.join(mw.staticDir, 'sw.js'), 'utf8').replace('__ASSET_VERSION__', mw.ASSET_VERSION);
  app.get('/sw.js', (req, res) => res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/javascript; charset=utf-8', 'Service-Worker-Allowed': '/' }).send(swSource));
  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').sendFile(path.join(mw.staticDir, 'manifest.webmanifest'), { maxAge: '1d' }));
  app.get('/apple-touch-icon.png', (req, res) => res.sendFile(brandFile(req, 'apple-touch-icon.png'), { maxAge: '7d' }));
  app.use(mw.securityHeaders);
  app.use(require('./services/perf').middleware); // tempo de cada resposta (e do banco): Server-Timing e requisições lentas

  app.get('/healthz', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(require('./routes/webhooks')); // avisos de fora (comentário na Outstand): antes dos leitores de corpo, para conferir a assinatura
  app.use(express.urlencoded({ extended: false, limit: '1mb' })); // CSV da importação vai no corpo do formulário
  app.use(express.json({ limit: '50kb' }));
  app.use(require('./utils/requestCache').middleware); // o mesmo ajuste lido várias vezes na página vai ao banco uma vez
  app.use(require('./services/googleCalendar').kickOnWrite); // mudou algo no painel: o Google Agenda acompanha em segundos
  app.use(mw.originCheck);
  app.use(require('./services/plans').middleware); // nomes dos planos (Ouro/Diamond), editáveis na gestão, valem em todas as telas

  app.use(require('./routes/public')); // convite público: sem sessão nem CSRF (token secreto na URL)
  app.use(require('./routes/infinitepay')); // webhook de pagamento da plateia e a página de "pagamento recebido" (sem login)
  app.use(require('./routes/plateia')); // Pulso Podcast com Plateia: página pública de inscrição (sem login)
  app.use(require('./routes/sponsorPublic')); // media kit, formulário e portal do patrocinador (idem)
  app.use(require('./routes/guestPortalPublic')); // portal do convidado: posts em collab, cortes exclusivos e fotos (token na URL)
  app.use(require('./routes/postRecording')); // página pós-gravação (QR Code do cartão do convidado): pública, a mesma para todos, fora dos buscadores
  app.use(require('./routes/partnershipPublic')); // extrato da parceria por link (só leitura, para o parceiro)
  app.use(require('./routes/approvalPublic')); // aprovação por link: pauta, roteiro, vídeo e capas para quem está fora do sistema
  app.use(require('./routes/studioUpload')); // link do estúdio: envio do material da gravação (token na URL, sem login)
  app.use(require('./routes/siteApi')); // API pública do site (podcastpulso.com): imagens assinadas; dados e formulários entram aqui
  app.use(require('./routes/siteApi').formErrors); // erro nos formulários do site responde ao site (JSON ou 303), não com a página do painel

  app.use(mw.attachSession);
  // modo de teste/publicação de verdade das redes (Integrações): relido do banco a cada 15 s, no máximo
  app.use((req, res, next) => { require('./services/socialApi').syncLive().then(() => next(), next); });
  app.use(mw.verifyCsrf);
  app.use(require('./routes/auth'));

  app.use(mw.requireAuth); // tudo abaixo exige login
  app.use((req, res, next) => { require('./services/catalog').refresh().then(() => next(), next); }); // categorias e tipos de vídeo (Gestão > Categorias), a cada 30 s
  app.use((req, res, next) => { require('./services/projects').refresh().then(() => next(), next); }); // projetos (Gestão > Projetos), a cada 30 s
  app.use((req, res, next) => { require('./services/roles').refresh().then(() => next(), next); }); // funções (Gestão > Funções), a cada 30 s
  app.use(require('./services/scope').attach); // de quais projetos a pessoa participa, qual está escolhido no menu e a função em cada um
  app.use(require('./services/scope').requireModule); // tela de módulo que nenhum projeto dela usa: 404
  app.use(require('./services/scope').guardItem); // item de outro projeto no endereço (GET ou POST): 404, em qualquer rota
  app.use(mw.navData);
  app.use(require('./routes/misc'));
  app.use(require('./routes/collab')); // comentários, responsável, notificações e busca global
  app.use(require('./routes/assistant')); // assistente de IA flutuante (texto e áudio, com histórico)
  app.use(require('./routes/chat')); // mensagens da equipe: conversas, grupos, threads, reações, áudio e resumo com IA
  app.use(require('./routes/attachments')); // anexos (imagem, PDF, HTML, ZIP, áudio) e miniatura de links
  app.use(require('./routes/tasks'));
  app.use(require('./routes/outreach')); // Cadência de abordagem: registro por canal, follow-ups e painel da gestão
  app.use(require('./routes/catalog')); // Gestão > Sistema > Categorias
  app.use(require('./routes/projects')); // Gestão > Sistema > Projetos: nome, sigla e quem participa
  app.use(require('./routes/roles')); // Gestão > Equipe > Funções: o que cada função acessa
  app.use(require('./routes/savedFilters')); // visualizações salvas dos filtros (Convidados, Conteúdo > Cortes)
  app.use(require('./routes/goals')); // Gestão > Metas: até 3 metas por pessoa, contadas sozinhas
  app.use(require('./routes/releases')); // Novidades: versões do sistema e aviso de atualização
  app.use(require('./routes/calendar')); // Calendário: tudo que tem data, com filtros e visualizações salvas
  app.use(require('./routes/gestao'));
  app.use(require('./routes/duplicates')); // duplicatas: comparar e juntar cadastros, Gestão > Duplicatas
  app.use(require('./routes/trash')); // Lixeira: o que foi apagado fica 15 dias e pode voltar
  app.use(require('./routes/plans')); // Gestão > Planos de patrocínio
  app.use(require('./routes/plateiaAdmin')); // Plateia: inscrições, resultados e ajustes (e controles no convidado)
  app.use(require('./routes/finance')); // Financeiro: contas, estoque e custos automáticos (antes de episódios e patrocinadores)
  app.use(require('./routes/users'));
  app.use(require('./routes/guestPortal')); // portal do convidado: aba no cadastro e corte exclusivo
  app.use(require('./routes/guestImport')); // antes de guests: /convidados/importar não pode cair em /convidados/:id
  app.use(require('./routes/guests'));
  app.use(require('./routes/sponsorMaterial')); // aba Material do patrocinador: envio em partes, logo principal, baixar
  app.use(require('./routes/sponsors'));
  app.use(require('./routes/bulkDownload')); // /baixar.zip: vários arquivos (episódio, cortes, posts) num ZIP só
  app.use(require('./routes/covers')); // /episodios/:id/capas/*: antes das rotas genéricas do episódio
  app.use(require('./routes/contentBulk')); // Conteúdo: atribuir, aprovar, mudar responsável e excluir vários de uma vez
  app.use(require('./routes/requests')); // Conteúdo > pedidos para o editor (trailer, vídeo avulso, post, story…)
  app.use(require('./routes/clips')); // cortes e publicação nas redes
  app.use(require('./routes/social')); // Social: publicações, novo post, ideias, insights e automações
  app.use(require('./routes/pautas')); // pauta e roteiro do vídeo (antes da gravação)
  app.use(require('./routes/approvals')); // links de aprovação (pauta, vídeo, capas): gerar e cancelar
  app.use(require('./routes/sessions')); // sessão de gravação: vários vídeos numa ida ao estúdio
  app.use(require('./routes/episodes'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Página não encontrada', message: 'Não encontramos o que você procurava. Pode estar na lixeira ou em outro projeto: confira o projeto escolhido no topo do menu.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // item de um projeto de que a pessoa não participa (scope.assert): responde como página que não existe
    if (err && err.status === 404 && !res.headersSent) return res.status(404).render('error', { title: 'Página não encontrada', message: 'Não encontramos o que você procurava. Pode estar na lixeira ou em outro projeto: confira o projeto escolhido no topo do menu.' });
    console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    const locals = { title: 'Não deu certo desta vez', message: 'O painel não conseguiu abrir esta página. Volte e tente de novo; se repetir, avise a gestão.' };
    // attachSession pode ter falhado antes de definir os locals do layout
    res.status(500).render('error', { currentUser: null, flash: null, can: () => false, csrf: '', podcastName: '', appName: require('./config').appName, currentPath: '', ...locals });
  });

  return app;
}

module.exports = { createApp };
