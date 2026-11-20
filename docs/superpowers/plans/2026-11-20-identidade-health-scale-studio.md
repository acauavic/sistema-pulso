# Identidade Health Scale Studio (fase 1) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o painel deixa a marca do Pulso e passa a se chamar e a se parecer com o Health Scale Studio, sem tocar no que
o convidado, o patrocinador e a plateia veem.

**Architecture:** troca de tokens no `:root` do `app.css` (as variáveis de marca ganham nomes neutros), Archivo como
fonte de título e texto, um partial de marca (`partials/brand.ejs`) e um de símbolo (`partials/signal.ejs`) no lugar do
wordmark e da linha de pulso no painel, ícones novos nos mesmos caminhos, ícones do Pulso copiados para
`src/public/brand/pulso/` e usados pelas páginas públicas, e-mails internos com a moldura da casa.

**Tech Stack:** Node 22, Express, EJS, CSS puro (CSP `'self'`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seções "Identidade do painel: Health Scale" e
"Endereços", item "Antes dessa fase"). Estudo do designer: `docs/referencias/Health_Scale_Studio_Logo.dc.html`.

## Global Constraints

- Nome: **Health Scale Studio**. "Studio" nunca é traduzido; "estúdio" continua sendo o lugar da gravação.
- Escuro: `--bg #0E0F0D`, `--surface #16180F`, `--line #262A22`, `--text #F4F4F0`, `--text-2 #A8ABA1`,
  `--muted #8A8D83`, `--action #9EDD55` (hover `#C8E86A`), `--on-action #0E0F0D`. Claro: `--bg #F4F4F0`,
  `--text #101210`, `--text-2 #54574F`, `--line-strong #C9C9C1`, verde `#2E6B22`, botão principal preto.
- `--raised` e `--line-strong` (escuro) e `--raised`, `--line`, `--muted` (claro) são derivados; todo par texto/fundo
  usado passa em 4,5:1 (o teste confere).
- Fontes: Archivo (variável, 400 a 800) em `--f-display` e `--f-body`; JetBrains Mono e Instrument Serif itálico
  continuam. Os `@font-face` de Space Grotesk e Inter **ficam** no `app.css`: o motor das capas (`public/design/`)
  desenha as peças do Pulso com eles dentro do painel.
- Formas não mudam (pílula, raios 2/6/10). Âmbar, vermelho e a cor do "externo" não mudam.
- Sem `style=` nem `<script>` inline, sem `data:` em CSS novo, sem CDN. Tudo em pt-BR.
- Nada do Pulso muda: `portal.css`, `plateia.css`, `patrocinador.css`, `templates/convite-pulso.html`,
  `templates/media-kit.html`, `public/design/`, `services/designs.js`, `services/videoScenes.js`, e-mails ao convidado e
  ao patrocinador, `partials/pulse-line.ejs`.
- Lançamento: v1.95.0 em `src/releases.js` e `package.json`; `memory.md`, `README.md`, `CLAUDE.md`,
  `docs/design-system.md` e `docs/manual-de-marca.md` atualizados. Não publicar sem autorização do dono.
- Testes: `TEST_DATABASE_URL=postgresql://localhost/pulso_claude_test npm test -- --test-concurrency=1` (Node 22.17).

## Review Focus

- Página pública do Pulso abrindo com o favicon "St" (o `/static/favicon.svg` muda de dono): toda página pública aponta
  para `/static/brand/pulso/`. Teste na Task 2.
- Janela "Ajustar capa" desenhando com fonte errada porque Space Grotesk saiu do painel: os `@font-face` ficam. Teste na Task 1.
- Texto ilegível num tema por token derivado fraco (muted sobre raised, chip publicado no claro): teste de contraste na Task 1.
- App instalado preso no cache antigo (fontes e ícones novos fora do precache do `sw.js`): teste na Task 2.
- E-mail ao convidado saindo com a moldura da casa (ou o de acesso da equipe saindo como Pulso): teste na Task 5.

---

### Task 1: Tokens, Archivo e nomes neutros no `app.css`

**Files:**
- Create: `src/public/fonts/archivo-latin-wght-normal.woff2` (o latin do estudo, entrada `9ed143cb-…` do pacote),
  `src/public/fonts/LICENSE-Archivo.txt` (OFL 1.1)
- Modify: `src/public/app.css` (linhas 1 a 57 e todos os usos de `--lime`, `--black`, `--white`, `--plum`)
- Test: `test/identidade.test.js`

**Interfaces:**
- Produces: variáveis `--accent` (`#9EDD55`), `--accent-hi` (`#C8E86A`), `--ink` (`#0E0F0D`), `--paper-ink`
  (`#F4F4F0`), `--brand-deep` (`#3E4A33` escuro / `#2E6B22` claro). `--lime`, `--black`, `--white` deixam de existir;
  `--plum` deixa de existir no `app.css` (avatares usam `--brand-deep`; o "externo" já usa `--external`).

- [ ] **Step 1: teste que falha** — em `test/identidade.test.js` (sem banco: lê arquivos):
  - `tokens('dark')` e `tokens('light')` leem os blocos `:root` e `:root[data-theme="light"]`; `contrast(a, b)` (WCAG).
  - escuro: `--bg` `#0E0F0D`, `--surface` `#16180F`, `--line` `#262A22`, `--text` `#F4F4F0`, `--action` `#9EDD55`.
  - nos dois temas, ≥ 4,5: `text`/`bg`, `text`/`surface`, `text`/`raised`, `text-2`/`surface`, `text-2`/`raised`,
    `muted`/`bg`, `muted`/`surface`, `muted`/`raised`, `on-action`/`action`, e `fg`/`bg` dos seis `--st-*`, de
    `ok`, `warn`, `bad`.
  - `app.css` não contém `--lime`, `--black)`, `--white)`, `--plum`, `C8FF42`, `rgba(200, 255, 66`.
  - `--f-display` e `--f-body` começam com `"Archivo"`; existe `@font-face` Archivo com `font-weight: 400 800`
    apontando para o arquivo, e o arquivo existe com mais de 20 KB.
  - continuam no `app.css` os `@font-face` de `"Space Grotesk"` e `"Inter"`.
- [ ] **Step 2:** rodar `node --test test/identidade.test.js` → FALHA.
- [ ] **Step 3:** extrair a fonte do estudo, escrever a licença, trocar os tokens (escuro e claro), renomear as
  variáveis, `--halo` com o verde, `--ok`/`--st-publicado-*` no verde, tracking de display de −.04/−.05/−.06em para
  −.02em, tirar o ponto do botão principal no claro (`.btn.primary::before`), comentário do topo do arquivo.
- [ ] **Step 4:** rodar o teste → PASSA.
- [ ] **Step 5:** commit.

### Task 2: Ícones do painel e ícones do Pulso separados

**Files:**
- Create: `src/public/brand/pulso/favicon.svg`, `favicon.ico`, `apple-touch-icon.png` (cópias dos atuais);
  `src/public/brand/studio/health-scale-logo.png`, `signal-bg.svg`
- Modify (conteúdo novo, mesmo caminho): `src/public/favicon.svg`, `favicon.ico`, `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `badge-72.png`
- Modify: `src/public/manifest.webmanifest`, `src/public/sw.js`, `src/views/plateia/page.ejs`,
  `plateia/guest.ejs`, `plateia/pagamento-concluido.ejs`, `portal/guest.ejs`, `portal/pos-gravacao.ejs`,
  `src/templates/convite-pulso.html`, `src/templates/media-kit.html` e demais páginas públicas que apontem favicon
- Test: `test/identidade.test.js`, `test/plateia.test.js:69`, `test/pwa.test.js`

**Interfaces:**
- Produces: `/static/brand/pulso/favicon.svg|favicon.ico|apple-touch-icon.png` (Pulso);
  `/static/favicon.svg` e os `icon-*` = monograma "St".

- [ ] **Step 1: teste que falha:**
  - `favicon.svg` contém `#0E0F0D` e `#9EDD55`, não contém `<text` nem `C8FF42`; `brand/pulso/favicon.svg` contém `C8FF42`.
  - manifesto: `name` "Health Scale Studio", `short_name` "Studio", `theme_color` e `background_color` `#0E0F0D`.
  - `sw.js`: precache tem `archivo-latin-wght-normal.woff2`; `CACHE` começa com `studio-`.
  - nenhuma view em `plateia/`, `portal/`, `sponsor-public/` nem template em `src/templates/` aponta para
    `/static/favicon.svg` ou `/favicon.ico` (todas usam `/static/brand/pulso/`).
  - `plateia.test.js`: o favicon esperado passa a ser `/static/brand/pulso/favicon.svg`.
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** copiar os ícones atuais para `brand/pulso/`; gerar o monograma (contornos do "S" de Instrument Serif
  itálico e do "t" de Archivo 800, proporções do estudo: quadrado `#0E0F0D`, "S" 0,68 em `#F4F4F0`, "t" 0,56 em
  `#9EDD55`) como SVG de contornos e renderizar os PNG com `rsvg-convert` (maskable com 20% de margem; badge 72 em
  branco sobre transparente); `favicon.ico` 48 px com `magick`. Atualizar manifesto, `sw.js` e as páginas públicas.
- [ ] **Step 4:** rodar `identidade`, `plateia` e `pwa` → PASSAM.
- [ ] **Step 5:** commit.

### Task 3: Marca no menu, no login e nas páginas soltas

**Files:**
- Create: `src/views/partials/brand.ejs`
- Modify: `src/config.js` (`appName`), `src/middleware.js:88` (`res.locals.appName`), `src/app.js:103`,
  `src/views/partials/head.ejs`, `src/public/offline.html`, `src/views/studio/_top.ejs`, `src/public/app.css`
  (`.brand*`, `.auth`), `.env.example` (`APP_NAME`)
- Test: `test/identidade.test.js` (bloco com servidor)

**Interfaces:**
- Produces: `config.appName` (`env.APP_NAME || 'Health Scale Studio'`); `include('brand', { variant })` com
  `variant` `'menu'` (ícone + "HEALTH SCALE" / "STUDIO" em mono) ou `'assinatura'` (logotipo + filete + "STUDIO").

- [ ] **Step 1: teste que falha:**
  - `GET /login`: `<title>` termina em "· Health Scale Studio"; tem `class="brand brand-sign"` e
    `health-scale-logo.png`; não tem `class="wordmark"`; `theme-color` `#0E0F0D`.
  - página logada (`GET /`): tem `class="brand brand-menu"`, "HEALTH SCALE" e "STUDIO"; não tem `wm-rest`.
  - `offline.html` e a página do link do estúdio: sem `wordmark`, com a marca nova.
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** implementar. No menu recolhido só o ícone aparece (`html[data-sidebar="collapsed"] .brand-text
  { display: none }`). `apple-mobile-web-app-title` "Studio". No claro o logotipo fica preto (`filter: brightness(0)`
  no CSS) e "STUDIO" em `--ok`. Fundo do login: `brand/studio/signal-bg.svg` no lugar do campo de pontos.
  Frase da página sem conexão: "Sem internet no momento."
- [ ] **Step 4:** rodar → PASSA.
- [ ] **Step 5:** commit.

### Task 4: Sinal no lugar da linha de pulso (só no painel)

**Files:**
- Create: `src/views/partials/signal.ejs`
- Modify: as views do painel que incluem `pulse-line` (todas menos `plateia/guest.ejs` e `plateia/page.ejs`),
  `src/views/partials/head.ejs` (login), `src/public/offline.html`, `src/public/app.css` (`.signal`, `.day-live`,
  `.tf-bar.busy`), `partials/day-summary.ejs`, `partials/my-day.ejs`, `social/comments-numbers.ejs` (sem mudança de
  marcação: `.day-live` muda só no CSS)
- Test: `test/identidade.test.js`

**Interfaces:**
- Produces: `include('signal')` → `<svg class="signal" viewBox="0 0 34 30" aria-hidden="true">` com quatro `<rect>`
  (alturas 8, 15, 22, 29; classes `s1`…`s4`). `.empty .signal` baixo e em muted; `.auth .signal` nas cores do estudo
  (`#3E4A33`, `#6FCF4A`, `#9EDD55`, `#C8E86A`, via classes).

- [ ] **Step 1: teste que falha:** nenhuma view fora de `plateia/guest.ejs` e `plateia/page.ejs` inclui `pulse-line`;
  `partials/pulse-line.ejs` continua existindo; `app.css` tem `.signal` e `@keyframes signal`, e a regra de
  `prefers-reduced-motion` desliga a animação de `.day-live`.
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** implementar. `.day-live` vira quatro barras de 2 px desenhadas com camadas de `linear-gradient`
  (12×10 px) que sobem em sequência a 1,2 s; no claro, na cor do texto.
- [ ] **Step 4:** rodar → PASSA.
- [ ] **Step 5:** commit.

### Task 5: E-mails internos e textos com o nome antigo

**Files:**
- Modify: `src/services/mailer.js` (`layout({ brand })`, `sendUserInvite`, `sendPasswordReset`, `sendNotification`,
  `sendRsvpNotice`, `sendSponsorNotice`), `src/index.js:91,100`, `src/services/assistant.js:297`,
  `src/services/assistantKnowledge.js:1`, `src/services/googleCalendar.js:118`, `src/services/sponsorMeetings.js:267`,
  `src/releases.js:1`
- Test: `test/identidade.test.js`

**Interfaces:**
- Produces: `layout({ title, bodyHtml, button, footer, brand = 'pulso' })`; `brand: 'studio'` = cabeçalho `#0E0F0D`
  com "Health" em serifa itálica, "Scale" em negrito e "STUDIO" em mono `#9EDD55`, botão `#101210`, rodapé
  "Mensagem enviada pelo Health Scale Studio". `sendMail({ fromName })` opcional; os internos mandam "Health Scale Studio".

- [ ] **Step 1: teste que falha** (com `MAIL_DRY_RUN`, como os testes de e-mail existentes): o HTML do convite de
  acesso e o de redefinição de senha têm "Health" e "STUDIO" e não têm `pulso<span`; o do convite do convidado tem
  `pulso<span` e `#C8FF42`. `grep` de "Pulso Gestão" em `src/` → zero.
- [ ] **Step 2:** rodar → FALHA.
- [ ] **Step 3:** implementar. O assistente passa a se apresentar como "assistente do Health Scale Studio, o painel
  da equipe do Podcast Pulso".
- [ ] **Step 4:** rodar → PASSA.
- [ ] **Step 5:** commit.

### Task 6: Documentos, lançamento e conferência visual

**Files:**
- Modify: `docs/design-system.md`, `docs/manual-de-marca.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `memory.md`,
  `src/releases.js` (entrada v1.95.0 no topo), `package.json` (1.95.0)

- [ ] **Step 1:** `docs/design-system.md`: abertura "Duas identidades" (painel = Health Scale Studio; público = marca
  do projeto), princípios com "verde é ação", tokens e tipografia novos, Sinal, marca no menu e no login; as seções das
  páginas públicas do Pulso continuam falando em lime. `docs/manual-de-marca.md`: cabeçalho dizendo que vale para o
  projeto Pulso. `CLAUDE.md`/`AGENTS.md`: regra de cor e nome do painel.
- [ ] **Step 2:** `releases.js` + `package.json` v1.95.0; `memory.md` ("Estado Atual" e "Últimas Decisões").
- [ ] **Step 3:** suíte inteira → PASSA.
- [ ] **Step 4:** navegador (computador e celular, escuro e claro): login, Início, quadro de convidados, um episódio,
  Tarefas, Financeiro, Mensagens, janela Ajustar capa (fonte das capas), página sem conexão; e as públicas do Pulso
  (convite, portal, pós-gravação, plateia, media kit, portal do patrocinador) iguais a antes, com o favicon do Pulso.
- [ ] **Step 5:** commit. Não publicar.
