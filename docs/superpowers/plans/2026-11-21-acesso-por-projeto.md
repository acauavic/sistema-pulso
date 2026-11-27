# Acesso por projeto — fase 7 (como ficou)

**Objetivo:** quem é de um projeto não alcança nada do outro, em nenhum caminho, e quem não é da equipe da casa não
alcança o que é geral do sistema. Esta fase é a **trava**: só depois dela entra gente de fora da casa no sistema.

**Especificação:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seções "Quem vê o quê" e "Testes").
**Branch:** `acesso-por-projeto` (a partir de `enderecos`). **Versão:** 1.104.0.

## Três perguntas separadas

1. **O que a pessoa faz**: o perfil (`src/permissions.js`). Não mudou.
2. **Onde ela faz**: `project_members` (o cadastro do usuário e Gestão > Projetos).
3. **Ela é da equipe da casa?** `users.house`. Só a casa alcança o que é geral (`HOUSE_PERMISSIONS`).

Financeiro = perfil (`finance.read`) **e** "Vê o financeiro" naquele projeto (`project_members.finance`).

## O que foi feito

1. **`permissions.js`**: `can(pessoa, permissão)` (todas as chamadas trocadas) + `HOUSE_PERMISSIONS`. A sessão carrega
   `users.house`.
2. **Tela do usuário** (`users/form.ejs`, `routes/users.js`): "Onde essa pessoa trabalha" (uma linha por projeto:
   participa + vê o financeiro) e o interruptor "Equipe da casa"; `projects.setUserProjects`.
3. **Recortes que faltavam**, achados pelo teste: listas de vínculo das tarefas, `findEpisode`/`taskFor` (o recorte
   entra no carregamento), formulário do episódio, galeria do media kit, agenda da semana, ideias e sugestões de @ do
   Social, lista de pessoas (responsável, calendário, chat), busca e calendário do financeiro.
4. **Lixeira, assistente e menções**: a lixeira lista e restaura só o que a pessoa alcança; o assistente recebe o
   recorte em `user.pids` e todas as consultas dele passam pelo `assistantLookup.only()`; a menção `@` do chat usa a
   busca com recorte.
5. **Avisos**: `notify({ projectId, house })`; o financeiro avisa por projeto, o que é da casa avisa só a casa.
6. **Teste `test/project-isolation.test.js`**: a trava. Lê a tabela de rotas do Express e percorre toda rota GET com
   ids do outro projeto procurando um marcador; confere 404 em detalhe e ação, o que é da casa, busca, avisos, chat,
   financeiro, e que a gestão da casa continua vendo tudo.

## Decisões da execução

- `can()` aceita a pessoa **ou** o perfil: com o perfil, a permissão da casa passa como antes (nenhuma chamada
  esquecida trava a gestão de hoje), e um caso do teste varre o `src/` procurando `can(x.role, …)`.
- O recorte entrou **dentro do carregamento** do item, não num `assert` por rota: 22 rotas de episódio de uma vez.
- "Só encontra quem divide um projeto" vale para todas as listas de pessoas, não só o chat.

## Antes de criar gente de fora em produção

O teste de isolamento passa. Falta o dono decidir **quem** entra: criar o usuário do Dr. José Bento e da equipe dele
com "Equipe da casa" desligado, só no Projeto 100, e o financeiro ligado apenas para quem ele quiser.
