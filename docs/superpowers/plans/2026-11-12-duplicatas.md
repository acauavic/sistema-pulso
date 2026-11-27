# Duplicatas — plano de implementação

> Execução: nativa (o dono pediu "implemente, publique e teste").

**Objetivo:** reconhecer convidado/patrocinador em dobro (certa ou possível), avisar ao cadastrar e no cadastro, listar na gestão e juntar.
**Spec:** `docs/superpowers/specs/2026-11-12-duplicatas-design.md`.

## Restrições

- Tudo em pt-BR, tokens do `app.css`, sem `style=`/`<script>` inline, um lime por área, dados em mono.
- Release 1.65.0 no topo de `src/releases.js` + `package.json`; `memory.md`, `README.md`, `assistantKnowledge`, design system.

## Tarefas

1. **Migração 071 + `src/services/duplicates.js`**: `duplicate_dismissals`; funções puras `norm.*`, `keys(kind, r)`, `compare(kind, a, b)`;
   `findFor(kind, rec, { excludeId })`, `pairs(kind)`, `dismiss/undismiss`, `conflicts`, `summary`, `pickKeep`, `merge(kind, keepId, dropId, choices, user)`.
   Move as chaves estrangeiras lidas de `pg_constraint` (só as linhas que não batem em índice único com as do que fica; as outras vão
   com o que sai para a lixeira), mais `comments` e `outreach_attempts`. Leva o link do convite / `public_token` quando o que fica não
   tem. Foto: copia se o que fica não tem e tira do que sai (a limpeza da lixeira apagaria o arquivo).
2. **Ao cadastrar**: `POST /convidados` e `POST /patrocinadores` checam antes de gravar (`confirmar_duplicata=1` pula);
   `partials/duplicate-notice.ejs` dentro do formulário; `data-busy` nos dois formulários. Episódio novo: duplicata certa do
   convidado/patrocinador novo é recusada com o nome do que existe. Assistente: certa recusa; possível pede `confirmado`.
3. **No cadastro**: `partials/duplicate-alert.ejs` (show de convidado e patrocinador), rotas em `src/routes/duplicates.js`:
   `GET /duplicatas/:tipo/:a/:b` (página de comparação), `POST …/juntar`, `POST …/dispensar`, `POST …/avisar`.
   A comparação é uma página (não janela): mais espaço para os dois cartões e funciona igual no celular.
4. **Gestão > Sistema > Duplicatas** (`/gestao/duplicatas`, permissão `duplicates.manage`): abas Convidados | Patrocinadores, pares
   e dispensados em `<details>`.
5. **Testes** `test/duplicatas.test.js` (regras, cadastro, aviso, gestão, juntar, permissões), release, docs, publicar e conferir em
   produção os 4 pares de patrocinador na lista.
