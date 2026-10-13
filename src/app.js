const express = require('express');
const path = require('path');
const db = require('./db/pool');
const mw = require('./middleware');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // atrás do Traefik: req.ip e cookie Secure corretos
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use('/static', express.static(mw.staticDir, { maxAge: '1h' }));
  // Ícones na raiz: o navegador e o iOS pedem esses caminhos sozinhos (convite e media kit não têm <link rel="icon">).
  app.get('/favicon.ico', (req, res) => res.sendFile(path.join(mw.staticDir, 'favicon.ico'), { maxAge: '7d' }));
  // Service worker na raiz (escopo = painel inteiro) e manifesto do app (iPhone: alertas só com o painel na Tela de Início).
  app.get('/sw.js', (req, res) => res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/javascript; charset=utf-8' }).sendFile(path.join(mw.staticDir, 'sw.js')));
  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').sendFile(path.join(mw.staticDir, 'manifest.webmanifest'), { maxAge: '1d' }));
  app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(mw.staticDir, 'apple-touch-icon.png'), { maxAge: '7d' }));
  app.use(mw.securityHeaders);

  app.get('/healthz', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.urlencoded({ extended: false, limit: '1mb' })); // CSV da importação vai no corpo do formulário
  app.use(express.json({ limit: '50kb' }));
  app.use(require('./services/googleCalendar').kickOnWrite); // mudou algo no painel: o Google Agenda acompanha em segundos
  app.use(mw.originCheck);
  app.use(require('./services/plans').middleware); // nomes dos planos (Ouro/Diamond), editáveis na gestão, valem em todas as telas

  app.use(require('./routes/public')); // convite público: sem sessão nem CSRF (token secreto na URL)
  app.use(require('./routes/plateia')); // Pulso Podcast com Plateia: página pública de inscrição (sem login)
  app.use(require('./routes/sponsorPublic')); // media kit, formulário e portal do patrocinador (idem)

  app.use(mw.attachSession);
  app.use(mw.verifyCsrf);
  app.use(require('./routes/auth'));

  app.use(mw.requireAuth); // tudo abaixo exige login
  app.use(mw.navData);
  app.use(require('./routes/misc'));
  app.use(require('./routes/collab')); // comentários, responsável, notificações e busca global
  app.use(require('./routes/assistant')); // assistente de IA flutuante (texto e áudio, com histórico)
  app.use(require('./routes/tasks'));
  app.use(require('./routes/releases')); // Novidades: versões do sistema e aviso de atualização
  app.use(require('./routes/calendar')); // Calendário: tudo que tem data, com filtros e visualizações salvas
  app.use(require('./routes/gestao'));
  app.use(require('./routes/plans')); // Gestão > Planos de patrocínio
  app.use(require('./routes/plateiaAdmin')); // Plateia: inscrições, resultados e ajustes (e controles no convidado)
  app.use(require('./routes/finance')); // Financeiro: contas, estoque e custos automáticos (antes de episódios e patrocinadores)
  app.use(require('./routes/users'));
  app.use(require('./routes/guestImport')); // antes de guests: /convidados/importar não pode cair em /convidados/:id
  app.use(require('./routes/guests'));
  app.use(require('./routes/sponsors'));
  app.use(require('./routes/covers')); // /episodios/:id/capas/*: antes das rotas genéricas do episódio
  app.use(require('./routes/clips')); // cortes e publicação nas redes
  app.use(require('./routes/social')); // Social: publicações, novo post, ideias, insights e automações
  app.use(require('./routes/episodes'));

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Página não encontrada', message: 'Não encontramos o que você procurava.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(`[erro] ${req.method} ${req.originalUrl}:`, err);
    if (res.headersSent) return;
    const locals = { title: 'Algo deu errado', message: 'Ocorreu um erro inesperado. Tente novamente em instantes.' };
    // attachSession pode ter falhado antes de definir os locals do layout
    res.status(500).render('error', { currentUser: null, flash: null, can: () => false, csrf: '', podcastName: '', currentPath: '', ...locals });
  });

  return app;
}

module.exports = { createApp };
