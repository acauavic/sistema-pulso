# Conferência do multiprojetos (v2.0.0)

Leitura da especificação (`docs/superpowers/specs/2026-11-20-multiprojetos-design.md`) linha por linha, contra o que
está no código, depois das nove fases. **Suíte completa: 1214 testes, todos passando.**

## Regra da casa

> Cadastro é da casa; trabalho e dinheiro são sempre de um projeto.

- **Cadastro da casa**: `people` e `companies` (identidade espelhada nas participações), estoque, categorias, rotinas,
  usuários, integrações, banco de horas (um pacote) — tudo num lugar só. ✔
- **Trabalho do projeto**: `project_id NOT NULL` em `guests`, `sponsors`, `episodes`, `episode_clips`,
  `content_requests`, `social_ideas`, `sponsor_plans`, `plateia_events`, `pautas`; opcional em `tasks`,
  `task_routines`, `user_goals`, `audit_log`, `trash_items`. ✔
- **Dinheiro do projeto**: `fin_entries.project_id` **ou** `fin_entry_splits` (compartilhado). ✔

## Fase por fase

| Fase | Versão | Estado |
| --- | --- | --- |
| 1 Identidade Health Scale Studio | 1.95.0 | feita |
| 2 Fundação (projects, scope, seletor) | 1.96.0 | feita |
| 3 Vídeo e pauta (3A/3B) | 1.98.0 / 1.99.0 | feita |
| 4 Pessoas e empresas | 1.100.0 / 1.101.0 | feita |
| 5 Dinheiro por projeto | 1.102.0 | feita |
| 6 Endereços | 1.103.0 | feita no código; **o DNS é do dono** |
| 7 Acesso por projeto (trava) | 1.104.0 | feita, com o teste de isolamento |
| 8 Redes por projeto | 1.105.0 | feita no código; **as contas do Projeto 100 são do dono** |
| 9 Marca do Projeto 100 | 2.0.0 | feita nas páginas públicas e nos ícones |

## Testes que a especificação pediu

- **Isolamento** (`test/project-isolation.test.js`): percorre **toda rota GET registrada no Express** com ids do outro
  projeto e falha se um marcador aparecer; confere 404 em detalhe e ação, o que é da casa, busca, avisos, chat,
  assistente, menções, lixeira, financeiro, e que a gestão da casa continua vendo tudo. ✔
- **Migração**: `test/projetos-migracao.test.js` (contagens iguais, tudo no Pulso, números intactos). ✔
- **Espelho**: `test/pessoas-espelho.test.js`, `test/empresas-espelho.test.js`. ✔
- **Financeiro**: `test/dinheiro-por-projeto.test.js` (dono ou divisão, herança, soma dos projetos = consolidado, cota
  e uso do banco, quem é de um projeto vê só a parte dele). ✔
- **Numeração**: `test/video-numeracao.test.js` (dois projetos com `number = 1`). ✔
- **Um projeto só**: casos em `projetos-listas`, `projetos-menu` e `dinheiro-por-projeto`. ✔
- **Endereços**: `test/enderecos.test.js` (painel fora do domínio público, link no domínio certo, link antigo do Pulso
  igual, favicon pelo domínio, sessão que não vale). ✔
- **Identidade**: `test/identidade*.test.js` e `test/marca-projeto-100.test.js`. ✔

## O que ficou de fora, e por quê

1. **DNS e Caddy** (fase 6): `studio.healthscale.com.br` e o subdomínio do Projeto 100 precisam apontar para o
   servidor, com um bloco por domínio no Caddy; depois a gestão preenche o endereço em Gestão > Projetos. Até lá, tudo
   continua num endereço só — e é assim que o sistema roda hoje.
2. **Contas de rede do Projeto 100** (fase 8): o código já publica pela conta do projeto, mas não existe conta dele em
   provedor nenhum. Enquanto não houver, o módulo `redes` fica desligado para ele e o Social não aparece — ele publica
   por fora, como a especificação previu.
3. **Capas, convite e media kit do Projeto 100** (fase 9): são modelos e documentos com texto, wordmark e tipografia
   próprios. Trocar só a cor deixaria a peça meio Pulso, meio Projeto 100. Precisa de uma passada de design com o dono.
4. **Números dos comentários** (Social > Comentários > Números): continuam somando os posts da casa. São dez consultas
   com CTE para medir uma automação que só o Pulso usa; está anotado no README.
5. **Usuário restrito em produção**: o teste de isolamento passa, então a trava da fase 7 está liberada — mas **criar**
   o usuário do Dr. José Bento e da equipe dele é decisão do dono (quem entra, com o financeiro ligado ou não).

## Depois da v2.0.0: o Projeto 100 na prática (2.1.0 → 2.4.0)

Desenho em `docs/superpowers/specs/2026-11-21-projeto-100-na-pratica-design.md`, a partir do que o dono disse em 2026-11-21
(acordo com o Dr. José Bento, quem aprova só recebe link, gravação em lote, funções por área e projeto).

| Parte | Versão | Teste |
| --- | --- | --- |
| Aprovação por link (pauta, roteiro, vídeo, capas) | 2.1.0 | `test/aprovacao-link.test.js` |
| Sessão de gravação (horas da sessão, um link do estúdio) | 2.2.0 | `test/sessao-gravacao.test.js` |
| Acerto da parceria (custo volta primeiro, lucro quando decidir, mês fechado, extrato) | 2.3.0 | `test/acerto-parceria.test.js` |
| Funções sob medida (por área e por projeto, acesso até) + guarda do item na URL | 2.4.0 | `test/funcoes.test.js` |

**Achado na revisão**: várias ações POST (convidados, patrocinadores, pedidos, plateia, portal, material, capas, social)
não conferiam o projeto do item — só as páginas de detalhe conferiam, e o teste de isolamento cobria POST em três rotas. O
guarda do item na URL (`scope.guardItem`) fecha isso para toda rota com o id no endereço. **Antes de alguém de fora
ganhar login, este é o ponto que precisava estar fechado.**

**Fica com o dono**: os três custos mensais da equipe no Projeto 100 (editor, produtora e gestão de projetos e qualidade)
entram pela tela Financeiro > Custos automáticos > Mensais — os valores não vão para o repositório; a data de começo do
acordo (adotado 01/11/2026) se confirma em Financeiro > Parceria > Editar acordo.

## Perguntas que o dono precisa responder antes de publicar

1. Publicar a pilha inteira (1.95.0 → 2.0.0) de uma vez, ou por partes?
2. O endereço do painel (`studio.healthscale.com.br`) e o subdomínio público do Projeto 100 (adotado
   `links.projeto100.com`): confirma, e aponta o DNS quando quiser que eu publique a fase 6?
3. Quem da equipe do Dr. José Bento entra, e quem vê o financeiro do Projeto 100?
4. O Projeto 100 vai publicar pelo sistema? Se sim, quais contas (e em qual provedor) são dele?
