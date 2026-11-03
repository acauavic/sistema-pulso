# AGENTS.md

## Memória do projeto

- Existe um arquivo `memory.md` na raiz, feito pra ser lido por IA (não por humano — a doc pra
  humano é o `README.md`).
- Sempre que concluir uma funcionalidade ou alterar a arquitetura, **atualize o `memory.md`** nas
  seções "Estado Atual" e "Últimas Decisões" (mais recente no topo).
- Mantenha enxuto: bullets (`-`) e negrito (`**`), sem tabelas. Passou de ~300 linhas? Limpe
  decisões antigas já consolidadas no código.
- `memory.md` é commitado junto com o código que ele descreve.

## Design e marca

- **Jornada do usuário é regra de criação**: descreva e percorra no navegador a jornada antes de dar uma tela por pronta; nada de formulário gigante aberto (ver `docs/design-system.md`, "Experiência e jornada").
- Toda UI/e-mail/texto novo segue `docs/design-system.md` e `docs/manual-de-marca.md` (originais em `docs/referencias/`). Veja o `CLAUDE.md`.

## Releases e versão

- Ao lançar, acrescente a entrada no topo de `src/releases.js` e suba o `version` do `package.json` para o mesmo número (o teste confere). Cada pessoa vê o aviso "Sistema atualizado" uma vez por versão e a página `/novidades` lista o histórico.

## Outras notas

- Testes: `npm test` (precisa de um Postgres e de um banco que **termine em `_test`** — a suíte
  recria o schema). YOURLS é simulado e o e-mail roda em dry-run; nada externo é chamado.
- Nunca grave segredos no repositório. Brevo/YOURLS vêm de variáveis de ambiente (ver `.env.example`).
- A matriz de permissões dos perfis é provisória e vive só em `src/permissions.js`.
