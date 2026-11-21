# Dinheiro por projeto — fase 5 (como ficou)

**Objetivo:** todo lançamento tem dono (um projeto) ou é compartilhado com divisão que soma o valor; o Financeiro segue
o recorte do menu; o banco de horas do estúdio ganha cota por projeto e a despesa da compra segue o uso.

**Especificação:** `docs/superpowers/specs/2026-11-20-multiprojetos-design.md` (seção "Dinheiro").
**Branch:** `dinheiro-por-projeto` (a partir de `pessoas-e-empresas`). **Versão:** 1.102.0.

## Restrições que valeram em tudo

- `fin_entries.project_id` **ou** linhas em `fin_entry_splits`. Nunca os dois, nunca nenhum.
- A soma dos projetos é o consolidado (`finOwner.share` garante isso em qualquer recorte).
- Vínculo manda: episódio > convidado > contrato. Sem vínculo, o campo "De quem é".
- Centavos: `finOwner.distribute` sempre soma o valor (o resto do arredondamento vai para o maior peso).
- Recorte do dinheiro = recorte do menu ∩ `project_members.finance` (`scope.financeIdsOf`).
- Um projeto só: nenhuma tela mostra seletor, sigla ou campo de projeto.

## O que foi feito

1. **Migração 100**: `fin_entries.project_id` (DEFAULT 1, anulável), `fin_entry_splits`, `fin_rules.project_id`
   ("vale para"), `fin_recurring.project_id` + `split`, `fin_hour_quotas` (pacote de hoje inteiro no Pulso).
2. **`services/finOwner.js`** (novo): `where`/`share` (SQL), `ownerFor`, `save`, `rescale`, `parse`, `distribute`,
   `splitsOf`, `canSee`, `halves`.
3. **`services/finance.js`**: `upsertAuto` grava o projeto; `rulesFor(trigger, projectId)`; `ensureRecurring` repassa
   o dono do mensal; `planSponsorPayment` usa o projeto do contrato; `buyStock` aceita dono/divisão; leitura
   (`entries`, `counts`, `overview`, `cashNow`, `costPerEpisode`) recebe `pids`; `resultByProject`; `syncHourBank`.
4. **`services/hourBank.js`**: `quotas`, `setQuotas`, `seedQuotas`, `allocate` (FIFO por pacote), `recomputeSplits`,
   `status({ pids })` com `byProject`.
5. **Rotas** (`routes/finance.js`): `pidsOf`/`pickProjects`, `pickers` no recorte, `ownerOfBody`, `findEntry` com
   `canSee` (404), rescale ao pagar/editar, CSV com coluna Projeto, `POST /financeiro/banco/cotas`, `assert` na
   duração do episódio e no pagamento do patrocinador. `routes/misc.js`: o bloco de dinheiro do Início no recorte.
6. **Telas**: `partials/fin-owner.ejs`, `_row.ejs` (sigla, compartilhado, parte do recorte), `_hour-bank.ejs` (linhas
   por projeto, aviso de cota, Ajustar cotas), `index.ejs` (Resultado por projeto), `rules.ejs` ("Vale para" e
   "De quem é"), `stock.ejs` (compra), prefixo do número pelo projeto. `app.js`: `data-fill` marca radio/caixa.
7. **Teste**: `test/dinheiro-por-projeto.test.js` (7 casos: migração, herança pelo vínculo, divisão que soma e
   consolidado, recorte e 404, mensal e regra por projeto, cota e divisão da compra pelo uso, um projeto só).

## Desvios da especificação (decididos na execução)

- **Horas não usadas**: a especificação diz que ficam "a usar, sem dono". Em dinheiro, elas são divididas **pela cota**,
  porque a divisão da compra tem de somar o valor pago (senão o consolidado não fecha). Em horas, o cartão continua
  mostrando o que está a usar, sem dono. Conforme as gravações acontecem, a divisão migra para o uso real.
- **`fin_rules`**: o campo guardado é "em que projeto a regra vale", não o dono do que ela gera (o gerado sempre herda
  do episódio ou do convidado). O dono guardado ficou só no custo **mensal**, que não tem vínculo.
- **Caixa inicial**: é da casa, então entra no caixa de hoje apenas quando o recorte é a casa toda.

## Fora desta fase

- Avisos da rotina do financeiro continuam indo para quem tem `finance.read`, sem recorte de projeto (fase 7, junto com
  o isolamento de notificações).
- Estoque segue da casa (só a compra tem dono).
