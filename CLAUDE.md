# CLAUDE.md

Pulso Gestão: painel do **Podcast Pulso** (usuários e perfis, CRM de convidados, convites). Node 22 + Express + EJS + `pg`.
Doc pra humano: `README.md`. Memória pra IA (estado + decisões): `memory.md`.

@AGENTS.md
@docs/design-system.md
@docs/manual-de-marca.md

## Regras deste projeto

- **Design e marca são lei.** Toda tela, componente, e-mail ou texto novo segue `docs/design-system.md` (tokens, componentes, checklist) e
  `docs/manual-de-marca.md` (logo, cores, tipografia, tom de voz). Originais do designer em `docs/referencias/`. Em dúvida, o design system vence;
  se algo precisar divergir, avise o usuário antes e registre a decisão no `memory.md`.
- **Experiência primeiro ("o copo fica na cozinha").** Antes de criar ou mexer em tela, descreva a jornada (quem, quando, próximo passo) e, depois de pronta, **percorra no navegador** (desktop e celular). Mostre só o que a pessoa precisa agora: edição eventual vira botão + janela, listas mostram resumo, muito conteúdo vira abas, campo só aparece quando faz sentido. Detalhes e checklist em `docs/design-system.md` ("Experiência e jornada").
- **Tokens, não cores soltas.** Estilo só em `src/public/app.css` usando as variáveis (`--bg`, `--surface`, `--action`…). Sem hex solto em view nova,
  sem `style=` inline (a CSP do painel é `'self'`), sem CDN/Google Fonts (fontes e ícones Lucide ficam no repo).
- **Lime é ação (um por área), dados em mono, plum é externo, serifa só para "voz".** Sem emoji na interface; ícones via `icon('nome')`.
- **Idioma e tom**: tudo em português do Brasil, direto, sem "!!!", sem urgência falsa (ver "Evitamos" no manual).
- **Permissões** só em `src/permissions.js` (matriz provisória). **Segredos** nunca no repo (`.env.example` documenta as variáveis).
- **Releases**: o sistema tem versão (`package.json`, semver). A cada lançamento, acrescente a entrada **no topo** de `src/releases.js` (versão, data, título, itens novo/ajuste/correção) e suba o `version` do `package.json` para o mesmo número; o teste confere. Isso gera a página **Novidades** (`/novidades`) e o aviso "Sistema atualizado" que cada pessoa vê uma vez por versão. Correção pequena = patch (1.1.1), funcionalidade = minor (1.2.0), mudança grande = major.
- **Ao terminar uma feature ou mudar arquitetura**: atualizar `memory.md` ("Estado Atual" e "Últimas Decisões", mais recente no topo) e commitar junto.
- Se a mudança mexe no que o README descreve, atualize o `README.md` também.

## Comandos

- `npm run dev` (porta 3100) · `npm run migrate` · `npm run create-superadmin -- email "Nome"`.
- `npm test` precisa de Postgres e de `TEST_DATABASE_URL` apontando para um banco que **termine em `_test`** (a suíte recria o schema).
- Rodar localmente para ver a UI: `MAIL_DRY_RUN=true`, `YOURLS_*` vazios, `PODCAST_DATABASE_URL` de um banco de dev (ver README).

## Mapa rápido

- `src/views/` (EJS) + `src/views/partials/` (layout com barra lateral, linha de pulso) · `src/public/` (`app.css`, `app.js`, `theme.js`, `fonts/`).
- `src/utils/icons.js` (Lucide embutido) · `src/utils/format.js` (datas em Brasília, `shortDate`, `greeting`).
- `src/services/mailer.js` (e-mails na marca) · `src/templates/convite-pulso.html` (convite público do convidado, sandbox, tem identidade própria).
