# Link do estúdio — plano de implementação

> Execução: nativa (o dono pediu "pode implementar, testar e publicar").

**Objetivo:** link público por episódio para o estúdio subir o material da gravação direto, com o mesmo motor de envio do painel.
**Spec:** `docs/superpowers/specs/2026-11-13-link-do-estudio-design.md`.

## Restrições globais

- pt-BR, tom da marca, tokens do `app.css`, sem `style=`/`<script>` inline, um lime por área, dados em mono.
- Release 1.66.0 (`src/releases.js` + `package.json`); `memory.md`, `README.md`, `assistantKnowledge`, `docs/design-system.md`.
- Limites: 200 GB por arquivo; 1 TB e 500 arquivos por link; 7 dias sem uso fecha.

## Foco da revisão

- Token inválido/fechado/expirado em qualquer rota pública: 404 genérico, sem dizer se existiu.
- Arquivo de outro link ou do painel (`fid` alheio) nas rotas públicas: 404.
- Duas câmeras com o mesmo `C0001.MP4` em pastas diferentes: dois arquivos, retomada pelo caminho.
- "Terminei" com arquivo ainda subindo: recusado; com falha: fecha e cancela o que parou no meio.
- Pedir reenvio: o link antigo para na hora (rotas públicas 404), o material já recebido continua.

## Tarefas

1. **Migração 072 + `src/services/studioLinks.js`**: tabela `episode_upload_links` (token, datas, fechamento) com índice único parcial
   de link aberto; colunas `episode_files.upload_link_id` e `source_path`. Serviço: `create(episodeId, userId)`, `current(episodeId)`,
   `byToken(token)` (só válido), `touch`, `finish(link)`, `close(link, userId, reason)`, `resend`, `summary(link)`, `kindFor(name)`,
   `limits`. `production.createEpisode` cria o link. Testes de serviço.
2. **Rotas públicas `src/routes/studioUpload.js`** (`/estudio/:token` + arquivos/iniciar, :fid/urls, :fid/parte/:n (PUT), :fid/parte/:n/ok,
   :fid/partes, :fid/concluir, :fid/cancelar, terminei), CSP com o Backblaze no `connect-src`, limites de requisição, registro antes do
   CSRF/login no `app.js`. View `studio/upload.ejs` e `src/public/estudio.js` (pastas, caminho, retomada, Wake Lock, Terminei).
   `uploads.js`: nome por entrada (`entry.name`), bandeja montada na página (`[data-upl-mount]`) sem quadro e sem sumir.
3. **Painel**: cartão "Link do estúdio" na aba Material e no convidado (copiar, WhatsApp, reenvio, fechar, gerar), rotas
   `/episodios/:id/estudio/{gerar,reenvio,fechar}` (`production.upload`), grupo Estúdio no WhatsApp dos convites, "Organizar"
   (`POST /episodios/:id/arquivos/:fid/organizar`), marca "estúdio" na linha, avisos e linha do tempo.
4. **Testes, docs, release, publicar e conferir em produção.**
