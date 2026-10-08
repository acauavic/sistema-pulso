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
  app.get('/favicon.ico', (req, res) => res.status(204).end());
  app.use(mw.securityHeaders);

  app.get('/healthz', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.urlencoded({ extended: false, limit: '1mb' })); // modelos HTML de até 200 KB (expandem ao codificar)
  app.use(express.json({ limit: '50kb' }));
  app.use(mw.originCheck);

  app.use(require('./routes/public')); // convite público: sem sessão nem CSRF (token secreto na URL)

  app.use(mw.attachSession);
  app.use(mw.verifyCsrf);
  app.use(require('./routes/auth'));

  app.use(mw.requireAuth); // tudo abaixo exige login
  app.use(require('./routes/misc'));
  app.use(require('./routes/users'));
  app.use(require('./routes/guests'));
  app.use(require('./routes/templates'));

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
