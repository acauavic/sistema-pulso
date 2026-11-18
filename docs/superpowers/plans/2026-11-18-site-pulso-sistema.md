# Site do Pulso — parte do sistema (API e campos novos) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Pulso Gestão passa a oferecer ao site podcastpulso.com uma leitura pública (só dados públicos), as imagens
assinadas e os dois endereços que recebem os formulários de convidado e de patrocinador, mais os campos novos
"Patrocinador oficial no site", "Esconder do site" e "Estreia prevista".

**Architecture:** Rotas novas em `src/routes/siteApi.js`, montadas antes de `attachSession` (públicas, sem sessão nem
CSRF, como `routes/plateia.js`). Os dados saem de `src/services/siteData.js`; as imagens, de `src/services/siteImages.js`
(endereço assinado por HMAC, como `guestPhotos.signedUrl`). Os pedidos dos formulários viram convidado `prospect` e
patrocinador `prospect` com `origin = 'site'` e avisam a gestão (`notify`, tipo novo `site`).

**Tech Stack:** Node 22, Express, EJS, `pg`, `node:test` (`npm test`, banco `*_test`).

**Spec:** `docs/superpowers/specs/2026-11-18-site-podcastpulso-design.md`. Este é o plano 1 de 2; o plano 2 é
`docs/superpowers/plans/2026-11-18-site-pulso-site.md` e consome o contrato definido aqui (Task 5 e Task 6).

## Global Constraints

- Design e marca são lei (`docs/design-system.md`, `docs/manual-de-marca.md`): tokens do `app.css`, sem hex solto, sem `style=`, ícones `icon()`, sem emoji, português do Brasil, tom sem urgência falsa.
- A leitura pública expõe **só** campos públicos: nunca telefone, e-mail, valor, responsável, token, notas ou `storage_key`.
- Origem dos formulários: `SITE_ORIGIN` (padrão `https://podcastpulso.com`; aceita também `https://www.podcastpulso.com`).
- Release: entrada no topo de `src/releases.js` e `package.json` em **1.80.0** (o teste confere); `memory.md` ("Estado Atual" e "Últimas Decisões") e `README.md` (variáveis novas) no mesmo commit final; `.env.example` documenta `SITE_ORIGIN`.
- Publicar em produção só depois de combinar com o dono (publicar derruba envios de vídeo em andamento).

## Review Focus

- Dado privado vazando na leitura pública (telefone, e-mail, valor, responsável): nenhuma chave nem valor desses no JSON — teste na Task 5.
- Marca com "Esconder do site", patrocinador perdido/prospect/negociação ou sem logo aparecendo nos apoiadores — teste na Task 5.
- Data de estreia (só dia) saindo um dia antes por fuso: `aired_on`/`premiere_on` vão como `YYYY-MM-DD` texto, nunca `Date` serializado — teste na Task 5.
- Pedido repetido ou de robô: campo-isca aceito sem gravar, limite por IP, e o mesmo Instagram não cria um segundo convidado (vira evento no existente) — testes na Task 6.
- Envio sem JavaScript (formulário HTML comum, cross-site): responde `303` para a página de obrigado ou de erro do site, nunca uma página do sistema — teste na Task 6.

---

### Task 1: Migração dos campos novos

**Files:**
- Create: `src/db/migrations/082_site.sql`
- Test: `test/site-api.test.js` (arquivo novo; os próximos tasks acrescentam `describe`s nele)

**Interfaces:**
- Produces (colunas): `guests.premiere_on DATE`, `guests.origin TEXT`, `guests.utm JSONB`; `sponsors.origin TEXT`,
  `sponsors.utm JSONB`, `sponsors.site_hidden BOOLEAN NOT NULL DEFAULT false`, `sponsors.site_official BOOLEAN NOT NULL DEFAULT false`
  + índice único parcial `sponsors_site_official_one ON sponsors ((true)) WHERE site_official` (no máximo um oficial).
  `utm` guarda `{ source, medium, campaign, term, content }` limpo por `audience.cleanUtm`.
- Produces (aviso): `NOTIFICATION_TYPES.site = { label: 'Pedidos pelo site', hint: 'Alguém pediu para ser convidado ou para patrocinar pelo site podcastpulso.com.' }` em `src/constants.js`.

- [ ] **Step 1: Write the failing test** — `describe('Site: campos novos')`, `it('dois patrocinadores oficiais ao mesmo tempo são recusados')`: insere dois sponsors com `site_official = true` e espera o erro `23505` no segundo; `it('as colunas existem')`: `SELECT premiere_on, origin, utm FROM guests` e `SELECT origin, utm, site_hidden, site_official FROM sponsors` não falham.
- [ ] **Step 2: Run** `npm test -- test/site-api.test.js` → FAIL (coluna não existe).
- [ ] **Step 3: Write `082_site.sql`** com as colunas e o índice acima; acrescente o tipo `site` em `NOTIFICATION_TYPES`.
- [ ] **Step 4: Run** `npm test -- test/site-api.test.js` → PASS.
- [ ] **Step 5: Commit** `git add src/db/migrations/082_site.sql src/constants.js test/site-api.test.js && git commit -m "Site: colunas de origem, UTM, estreia prevista e patrocinador oficial"`

### Task 2: "Patrocinador oficial no site" e "Esconder do site" na página do patrocinador

**Files:**
- Modify: `src/routes/sponsors.js` (rota nova), a view da página do patrocinador onde fica "Mostrar no media kit" (procure `kit_show` em `src/views/sponsors/`), `src/public/app.css` só se faltar classe
- Test: `test/site-api.test.js`

**Interfaces:**
- Produces: `POST /patrocinadores/:id/site` com corpo `{ official: 'on'|'' , hidden: 'on'|'' }` (formulário com CSRF, permissão de editar patrocinador — a mesma de `kit_show`); redireciona para a página do patrocinador. Marcar oficial desmarca o anterior na mesma transação (`UPDATE sponsors SET site_official = false WHERE site_official AND id <> $1`). Registra no histórico/auditoria como as outras mudanças.

- [ ] **Step 1: Write the failing tests** — `it('marcar um oficial desmarca o anterior')` (A oficial, depois B oficial → só B `site_official`); `it('esconder do site grava site_hidden')`; `it('produtora sem permissão recebe 403')`.
- [ ] **Step 2: Run** → FAIL (404).
- [ ] **Step 3: Implement** a rota e, na view, dois `.switch` (`role="switch"`, `data-autosubmit`, estado em mono LIGADO/DESLIGADO, nunca lime) ao lado de "Mostrar no media kit": "Patrocinador oficial no site" e "Esconder do site", com a frase curta "O site mostra a logo das marcas que fecharam ou patrocinam."
- [ ] **Step 4: Run** → PASS. Abrir a página no navegador (desktop e celular) e conferir os dois interruptores.
- [ ] **Step 5: Commit** `git commit -am "Site: patrocinador oficial e esconder do site no cadastro do patrocinador"`

### Task 3: "Estreia prevista" no convidado agendado

**Files:**
- Modify: `src/routes/guests.js:108` (`COLUMNS` ganha `premiere_on`, nulável), o formulário do convidado (campo `type=date` com `data-stages="agendado"`, rótulo "Estreia prevista", ajuda "Data em que o episódio deve ir ao ar. Aparece na agenda do site."), `src/services/production.js:253` (`createEpisode`)
- Test: `test/site-api.test.js`

**Interfaces:**
- Produces: `guests.premiere_on` editável; `createEpisode({ guestId, ... })` copia `guests.premiere_on` para `episodes.aired_on` quando o episódio nasce sem `aired_on`.

- [ ] **Step 1: Write the failing tests** — `it('salva a estreia prevista do convidado agendado')`; `it('o episódio nasce com aired_on = premiere_on do convidado')` (convidado agendado com `premiere_on = '2026-12-20'` → vira gravado → `episodes.aired_on::text = '2026-12-20'`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** a coluna no formulário e a cópia em `createEpisode`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "Site: estreia prevista no convidado, levada ao episódio"`

### Task 4: Imagens assinadas para o site

**Files:**
- Create: `src/services/siteImages.js`
- Create: `src/routes/siteApi.js` (só esta rota por enquanto) e monte-o em `src/app.js` logo depois de `routes/studioUpload` (antes de `attachSession`)
- Test: `test/site-api.test.js`

**Interfaces:**
- Produces: `siteImages.signedUrl(kind: 'foto'|'logo'|'capa', id: number, now = Date.now()): string` → URL **absoluta** `${config.appBaseUrl}/api/site/v1/imagem/${kind}/${id}?e=<exp>&s=<mac>`, validade 24 h, HMAC com `config.sessionSecret` e prefixo `site-imagem:` (mesmo desenho de `guestPhotos.signedUrl`); `siteImages.verify(kind, id, e, s, now): boolean`.
- Produces: `GET /api/site/v1/imagem/:kind/:id` — `foto` = foto do convidado (`guestPhotos.send`), `logo` = logo mais recente do patrocinador (`sponsor_files.kind = 'logo'`, via `webImage.send` com `maxSide = 800`), `capa` = `episode_covers.storage_key` (via `webImage.send` com `maxSide = 640`). Assinatura errada ou vencida = 404. `Cache-Control: public, max-age=3600`.

- [ ] **Step 1: Write the failing tests** — `it('assinatura errada ou vencida dá 404')`; `it('foto assinada responde 200 com imagem')` (usa o B2 simulado de `test/helpers.js`); `it('kind desconhecido dá 404')`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `siteImages.js` e a rota.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add src/services/siteImages.js src/routes/siteApi.js src/app.js test/site-api.test.js && git commit -m "Site: imagens assinadas para o build do site"`

### Task 5: Leitura pública `GET /api/site/v1/dados`

**Files:**
- Create: `src/services/siteData.js`
- Modify: `src/routes/siteApi.js`
- Test: `test/site-api.test.js`

**Interfaces:**
- Consumes: `siteImages.signedUrl` (Task 4); `kitGallery.candidates()`/`credentialOf()` (`src/services/kitGallery.js`); a consulta de `sponsors.kitAgendaHtml` (`src/services/sponsors.js:260`) como modelo da agenda; `audience.settings()` e `audience.agenda()` (`src/services/audience.js`).
- Produces: `siteData.build(): Promise<SiteData>`; rota com `Cache-Control: public, max-age=60`, limite `createLimiter({ name: 'site_dados', max: 120, windowMs: 10 * 60_000 })`. **Contrato (o plano 2 depende dele, nomes exatos):**

```
{ version: 1, generated_at: ISO,
  mesa:      [{ name, credential, handle|null, audience, ep|null, photo|null }],          // kitGallery: kit_featured, ordem do kit
  episodios: [{ number|null, title, guest|null, aired_on|null 'YYYY-MM-DD', youtube_url|null, spotify_url|null,
                youtube_id|null, spotify_kind 'episode'|'show'|null, spotify_id|null, cover|null }],                                          // status 'publicado' com youtube_url ou spotify_url; mais recente primeiro; até 24
  posts:     [{ url, title, published_at ISO, cover|null }],                              // publications com results[].platform='instagram' e url; até 12
  agenda: { vai_ao_ar: [{ date 'YYYY-MM-DD', name, handle|null, topic|null, photo|null }], // episódios não publicados com aired_on >= hoje (Brasília) + convidados agendados com premiere_on >= hoje e sem episódio
            gravacoes: [{ at ISO|null, name, handle|null, topic|null, photo|null, plateia: bool }] }, // agendados sem episódio, proposed_at >= ontem; plateia = audience_enabled e status 'disponivel'
  patrocinador_oficial: { company, website|null, logo|null } | null,                      // site_official
  apoiadores: [{ company, website|null, logo }],                                          // stage in ('ganho','ativo','inativo'), NOT site_hidden, NOT site_official, com logo; por starts_on
  plateia: { abertas: number } }                                                          // audience.agenda().length quando settings().active, senão 0
```

`photo`, `logo` e `cover` são URLs de `siteImages.signedUrl`. `youtube_id` é extraído de `youtube_url` (`watch?v=`, `youtu.be/`, `/shorts/`, `/live/`); `spotify_kind`/`spotify_id` de `spotify_url` (`open.spotify.com/(intl-xx/)?(episode|show)/<id>`), para o site montar o player. Datas só-dia saem como texto `YYYY-MM-DD` (`to_char(..., 'YYYY-MM-DD')`), "hoje" é calculado em `America/Sao_Paulo`.

- [ ] **Step 1: Write the failing tests** (`describe('Site: leitura pública')`):
  - `it('responde o contrato com as chaves de primeiro nível')` → `Object.keys(json)` igual a `['version','generated_at','mesa','episodios','posts','agenda','patrocinador_oficial','apoiadores','plateia']`, `version === 1`.
  - `it('não expõe dado privado')` → com convidado e patrocinador que têm telefone `11999990000`, e-mail `x@y.com` e `value_cents = 500000`, `JSON.stringify(json)` não contém `11999990000`, `x@y.com`, `500000`, `owner`, `storage_key`, `token`.
  - `it('apoiadores: só ganho/ativo/inativo com logo, sem os escondidos e sem o oficial')` → 6 patrocinadores (ativo com logo; inativo com logo; prospect com logo; ativo sem logo; ativo com logo e `site_hidden`; ativo com logo e `site_official`) → `apoiadores` tem os 2 primeiros e `patrocinador_oficial.company` é o último.
  - `it('agenda: estreia e estreia prevista em vai_ao_ar, agendado sem episódio em gravacoes')` → episódio não publicado `aired_on = amanhã`, convidado agendado com `premiere_on` e convidado agendado com `proposed_at` futuro; confere os nomes em cada bloco; convidado `perdido` não aparece.
  - `it('datas só-dia não mudam de dia')` → `aired_on = '2026-12-20'` sai `'2026-12-20'`.
  - `it('episódios: só publicados com link, mais recente primeiro, com youtube_id')` → `youtube_url = 'https://youtu.be/abc123XYZ_-'` → `youtube_id === 'abc123XYZ_-'`; `spotify_url = 'https://open.spotify.com/intl-pt/episode/4rOoJ6Egrf8K2IrywzwOMk?si=x'` → `spotify_kind === 'episode'`, `spotify_id === '4rOoJ6Egrf8K2IrywzwOMk'`.
  - `it('responde com Cache-Control público e CORS do site')` → `access-control-allow-origin` igual a `SITE_ORIGIN`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `siteData.build()` e a rota (CORS: `Access-Control-Allow-Origin` = origem pedida quando ela é uma das duas de `SITE_ORIGIN`, `Vary: Origin`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "Site: leitura pública dos dados do site"`

### Task 6: Formulários: `POST /api/site/v1/convidado` e `/patrocinador`

**Files:**
- Create: `src/services/siteLeads.js`
- Modify: `src/routes/siteApi.js`, `src/middleware.js:28` (`originCheck` aceita as origens do site só em `^/api/site/v1/(convidado|patrocinador)$`), `src/config.js` (`siteOrigins: string[]` de `SITE_ORIGIN`, lista separada por vírgula, padrão `['https://podcastpulso.com','https://www.podcastpulso.com']`, e `siteBaseUrl` = o primeiro), `.env.example`
- Test: `test/site-api.test.js`

**Interfaces:**
- Consumes: `audience.cleanUtm`, `audience.validatePhone(country, phone)` (`src/services/audience.js`), `guests.addEvent(guestId, userId, type, message)` (`src/services/guests.js:7`), `notify.notify({ type: 'site', users, title, body, url })` e `notify.usersWithRoles(['superadmin','gestao'])` (`src/services/notify.js`), `createLimiter` (`src/auth/rateLimit`), a normalização de Instagram e de perfil do CRM (`normalizeProfile` em `routes/guests.js` ou onde estiver).
- Produces: `siteLeads.createGuest(fields): Promise<{ id, existing: boolean }>`, `siteLeads.createSponsor(fields): Promise<{ id }>`.
- Produces (contrato com o plano 2): aceita `application/json` **e** `application/x-www-form-urlencoded`.
  - Convidado: `name*`, `instagram*`, `country` (padrão `BR`), `phone*`, `email`, `profile*` (`medico|influencer|empresario|profissional_saude`), `topic`, `privacy*` (`true`/`'on'`), `utm` (objeto) ou `utm_source…utm_content`, isca `url_extra`.
  - Patrocinador: `name*`, `company*`, `role`, `country`, `phone*`, `email*`, `website`, `goal`, `privacy*`, utm, isca `url_extra`.
  - JSON → `200 { ok: true }` ou `400 { ok: false, field, error }` / `429 { ok: false, error }`. Formulário → `303 Location: ${siteBaseUrl}/obrigado/?tipo=convidado|patrocinador` ou `303 ${siteBaseUrl}/ops/?tipo=…&erro=<campo>`.
  - Convidado: Instagram já cadastrado → não cria outro; `addEvent(id, null, 'site', 'Pediu de novo pelo site: …')` e responde `ok` igual. Novo → `status 'prospect'`, `origin 'site'`, `invite_reason` = o `topic`, evento "Pediu para ser convidado pelo site".
  - Patrocinador: `stage 'prospect'`, `origin 'site'`, `contact_name/contact_email/contact_phone`, `website`, `notes` = "Cargo: …\nO que a marca quer: …".
  - Aviso `site` para superadmin e gestão: "Novo pedido de convidado pelo site: Nome (@insta)" / "Nova marca quer patrocinar: Empresa", com link para o cadastro.
  - Limite: `createLimiter({ name: 'site_pedido', max: 8, windowMs: 10 * 60_000 })`. Preflight `OPTIONS` responde 204 com os cabeçalhos CORS.

- [ ] **Step 1: Write the failing tests** (`describe('Site: formulários')`):
  - `it('pedido de convidado vira prospect com origem site e avisa a gestão')`
  - `it('mesmo Instagram não cria outro convidado, só registra o pedido')` (`@Fulana` e `fulana` contam como o mesmo)
  - `it('pedido de patrocínio vira prospecção com contato e origem site')`
  - `it('campo-isca responde ok e não grava nada')`
  - `it('sem aceite da política responde 400 com field privacy')`
  - `it('formulário sem JavaScript responde 303 para a página de obrigado do site')` e `it('… com erro responde 303 para /ops/ com o campo')`
  - `it('origem de fora do site recebe 403')` (Origin `https://outro.com`)
  - `it('passa do limite e recebe 429')`
  - `it('guarda a UTM limpa')` (`utm_source=instagram` → `guests.utm->>'source' = 'instagram'`)
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `siteLeads.js`, as rotas, a exceção no `originCheck` e o config.
- [ ] **Step 4: Run** `npm test` (suíte inteira) → PASS.
- [ ] **Step 5: Commit** `git commit -am "Site: pedidos de convidado e de patrocínio pelo site"`

### Task 7: Origem "site" visível no painel, release 1.80.0 e documentação

**Files:**
- Modify: a lista/cadastro de convidados e de patrocinadores (chip neutro "site" em mono quando `origin = 'site'`, ao lado do nome), `src/releases.js` (entrada 1.80.0 no topo: novo — pedidos pelo site viram convidado e patrocinador; novo — patrocinador oficial e esconder do site; novo — estreia prevista), `package.json` (`1.80.0`), `memory.md`, `README.md` (seção do site e `SITE_ORIGIN`)
- Test: o teste de versão existente

- [ ] **Step 1: Implement** o chip e os textos.
- [ ] **Step 2: Run** `npm test` → PASS (inclui a conferência de versão).
- [ ] **Step 3: Percorrer no navegador** (desktop e celular): cadastro do patrocinador (interruptores), convidado agendado (estreia prevista), convidado vindo do site (chip).
- [ ] **Step 4: Commit** `git commit -am "Site: origem no painel e versão 1.80.0"`
- [ ] **Step 5: Combinar com o dono a hora de publicar** e publicar com o comando do `CLAUDE.md`; conferir `curl -s https://sistema.podcastpulso.com/api/site/v1/dados | head -c 300`.
