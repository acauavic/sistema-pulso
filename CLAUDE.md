# CLAUDE.md

**Health Scale Studio**: painel da equipe da Health Scale (antes "Pulso Gestão"). Hoje gerencia o **Podcast Pulso** (usuários e perfis, CRM de convidados, convites, produção, social, financeiro) e está virando multiprojetos (`docs/superpowers/specs/2026-11-20-multiprojetos-design.md`). Node 22 + Express + EJS + `pg`.
Doc pra humano: `README.md`. Memória pra IA (estado + decisões): `memory.md`.

@AGENTS.md
@docs/design-system.md
@docs/manual-de-marca.md

## Regras deste projeto

- **Design e marca são lei, e são duas identidades.** O painel (o que a equipe vê) é Health Scale Studio e segue `docs/design-system.md`
  (tokens, componentes, checklist). O que sai para fora pelo projeto Pulso (convite, portal, media kit, plateia, capas, e-mails ao convidado e ao
  patrocinador) segue `docs/manual-de-marca.md` (logo, cores, tipografia, tom de voz) e não usa os tokens do painel. Originais do designer em `docs/referencias/`. Em dúvida, o design system vence;
  se algo precisar divergir, avise o usuário antes e registre a decisão no `memory.md`.
- **Experiência primeiro ("o copo fica na cozinha").** Antes de criar ou mexer em tela, descreva a jornada (quem, quando, próximo passo) e, depois de pronta, **percorra no navegador** (desktop e celular). Mostre só o que a pessoa precisa agora: edição eventual vira botão + janela, listas mostram resumo, muito conteúdo vira abas, campo só aparece quando faz sentido. Detalhes e checklist em `docs/design-system.md` ("Experiência e jornada").
- **Tokens, não cores soltas.** Estilo só em `src/public/app.css` usando as variáveis (`--bg`, `--surface`, `--action`…). Sem hex solto em view nova,
  sem `style=` inline (a CSP do painel é `'self'`), sem CDN/Google Fonts (fontes e ícones Lucide ficam no repo).
- **Verde é ação (um por área), dados em mono, lilás é externo, serifa só para "voz".** No painel não existe mais lime nem o wordmark "pulso."; página pública nunca usa o ícone do painel (`/static/brand/pulso/…`). Sem emoji na interface; ícones via `icon('nome')`.
- **Idioma e tom**: tudo em português do Brasil, direto, sem "!!!", sem urgência falsa (ver "Evitamos" no manual).
- **Projetos**: cadastro é da casa, trabalho e dinheiro são sempre de um projeto. Lista de convidados, patrocinadores, episódios, cortes, pedidos ou tarefas usa `scope.where(req, where, params, 'apelido')` (`src/services/scope.js`); página de detalhe usa `scope.assert`; todo `INSERT` nessas tabelas informa `project_id` (item ligado a outro herda o projeto dele; item solto usa `scope.target`). Especificação: `docs/superpowers/specs/2026-11-20-multiprojetos-design.md`.
- **Vídeo, não só episódio**: `episodes.format` é `podcast` ou `video` (padrão do projeto) e a numeração é por projeto. Número na tela sempre por `videoNo(numero, projeto)`; nunca escreva `EP.` à mão em tela nova.
- **Permissões** só em `src/permissions.js` (matriz provisória). **Segredos** nunca no repo (`.env.example` documenta as variáveis).
- **Releases**: o sistema tem versão (`package.json`, semver). A cada lançamento, acrescente a entrada **no topo** de `src/releases.js` (versão, data, título, itens novo/ajuste/correção) e suba o `version` do `package.json` para o mesmo número; o teste confere. Isso gera a página **Novidades** (`/novidades`) e o aviso "Sistema atualizado" que cada pessoa vê uma vez por versão. Correção pequena = patch (1.1.1), funcionalidade = minor (1.2.0), mudança grande = major.
- **Ao terminar uma feature ou mudar arquitetura**: atualizar `memory.md` ("Estado Atual" e "Últimas Decisões", mais recente no topo) e commitar junto.
- Se a mudança mexe no que o README descreve, atualize o `README.md` também.

## Comandos

- `npm run dev` (porta 3100) · `npm run migrate` · `npm run create-superadmin -- email "Nome"`.
- **Deploy (produção, https://sistema.podcastpulso.com)**: o SSH da VPS **só aceita chave** (senha desligada desde 2026-11-18, fail2ban ligado). Host e usuário ficam em `.env.vps.local` na raiz (arquivo local, fora do git); a chave é `~/.ssh/pulso_vps_root` neste Mac (emergência: console web da Contabo). Nunca copie segredos para o repositório, para o chat ou para o log. Para publicar: `set -a; . ./.env.vps.local; set +a; ssh -i ~/.ssh/pulso_vps_root -o IdentitiesOnly=yes "$VPS_USER@$VPS_HOST" 'cd /opt/pulso && git pull -q && cd deploy && docker compose up -d --build'` (o código precisa estar no GitHub antes).
- `npm test` precisa de Postgres e de `TEST_DATABASE_URL` apontando para um banco que **termine em `_test`** (a suíte recria o schema).
- Rodar localmente para ver a UI: `MAIL_DRY_RUN=true`, `YOURLS_*` vazios, `PODCAST_DATABASE_URL` de um banco de dev (ver README).

## Mapa rápido

- `src/views/` (EJS) + `src/views/partials/` (layout com barra lateral, `brand.ejs` = marca do painel, `signal.ejs` = o Sinal; `pulse-line.ejs` é só da plateia do Pulso) · `src/public/` (`app.css`, `app.js`, `theme.js`, `fonts/`).
- `src/utils/icons.js` (Lucide embutido) · `src/utils/format.js` (datas em Brasília, `shortDate`, `greeting`).
- `src/services/mailer.js` (e-mails na marca) · `src/templates/convite-pulso.html` (convite público do convidado, sandbox, tem identidade própria).
