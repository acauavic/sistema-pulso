# Banco de horas do estúdio — desenho

Data: 2026-11-18 · Aprovado pelo dono na conversa (resumo abaixo).

## Por que

O Pulso pagava o estúdio por episódio: sinal de R$ 150 quando o convidado vira Agendado e, na gravação, o saldo
(duração × R$ 300/h − sinal), mais horas extras (`finance.syncGuest`, `finance.recomputeStudio`). Agora o Pulso comprou do
estúdio um **banco de horas**: R$ 5.000 por 20 horas (R$ 250/h). A partir do episódio do **Sandro Ferraz** (EP.026,
`episodes.id = 29` em produção, gravado em 14/11/2026), as gravações saem do banco e não geram mais contas por episódio.
O sistema precisa mostrar quanto sobra e avisar quando for hora de renovar.

## Decidido pelo dono

- **Corte**: o episódio do Sandro Ferraz é o primeiro do banco e **conta 1 hora usada**. Daí em diante, nada de sinal,
  saldo ou hora extra por episódio.
- **O que já está pendente** (previsto) de estúdio para gravações a partir do corte e para convidados agendados é
  **cancelado pelo sistema** (sai do banco). **O que já foi pago continua como está** (inclusive sinais pagos); não vira crédito.
- **Marcar reserva, gravar desconta**: convidado Agendado (sem episódio ainda) reserva a duração esperada
  (`fin_settings.studio_minutes`, 60); episódio gravado desconta a duração real (`episodes.recording_minutes`, ou a
  esperada se não houver). Cancelou/perdeu a gravação marcada → a reserva volta.
- **Disponível** = horas compradas − usadas − reservadas. **Aviso de renovar** quando o disponível ficar em **3 h ou
  menos**; o limite é **ajustável** nos ajustes do Financeiro.
- **Comprar/renovar** registra a compra (horas + valor + data) como **despesa paga** de categoria estúdio.
- Se o banco acabar e gravações continuarem, o excedente fica como **saldo devedor de horas** (disponível negativo), e a
  próxima compra o cobre primeiro (sai naturalmente da conta comprado − usado − reservado).

## Como fica (decisões do construtor)

### Dados (migração nova, próximo número livre)
- `fin_hour_packs`: `id`, `bought_on DATE NOT NULL`, `hours NUMERIC(6,2) NOT NULL CHECK (hours > 0)`,
  `amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0)`, `note TEXT`, `entry_id` → `fin_entries(id) ON DELETE SET NULL`,
  `created_by`, `created_at`.
- `fin_settings`: `studio_mode TEXT NOT NULL DEFAULT 'hora' CHECK (studio_mode IN ('hora','banco'))`,
  `studio_bank_start_episode_id INTEGER REFERENCES episodes(id) ON DELETE SET NULL`,
  `studio_bank_alert_hours NUMERIC(5,2) NOT NULL DEFAULT 3`.
- A migração **não** liga o banco nem cria compra: isso é feito pela tela (e, em produção, pelo dono ou por nós com a
  autorização dele), para não mexer em dinheiro por migração.

### Regra de quem está no banco
- Com `studio_mode = 'banco'`, um episódio está no banco se `recorded_on >= recorded_on do episódio de início` (ou é o
  próprio episódio de início; empate de data conta). Sem `recorded_on`, vale `created_at` contra o do episódio de início.
- Convidado Agendado sem episódio: sempre no banco (é futuro).

### Serviço `services/hourBank.js`
- `status()` → `{ active, purchasedHours, usedHours, reservedHours, availableHours, alertHours, low, packs[], used[], reserved[] }`
  (`used[]`: episódio, data, minutos; `reserved[]`: convidado, data marcada, minutos). Horas com 2 casas.
- `activate({ startEpisodeId, userId })`: liga o modo banco e **cancela pelo sistema** (status `cancelado`, `cancel_reason = 'sistema'`)
  os lançamentos **previstos** de estúdio (`auto_key LIKE 'estudio-%'`) dos episódios no banco e dos convidados agendados
  sem episódio. Pago fica intocado. Registra auditoria.
- `addPack({ boughtOn, hours, amountCents, note, userId })`: cria a compra e a despesa paga (`fin_entries`: saída, categoria
  `estudio`, `status 'pago'`, `paid_on = boughtOn`, descrição "Estúdio · banco de horas (20 h)"), ligando `entry_id`.
- `isBankEpisode(ep)` / `bankActive()` para os ganchos.

### Ganchos no Financeiro (`services/finance.js`)
- `syncGuest`: com o banco ativo, **não** cria sinal; se havia sinal previsto, cancela pelo sistema.
- `recomputeStudio`: episódio no banco → **não** cria saldo/extra e cancela pelo sistema o que estiver previsto.
- Episódios antes do corte continuam no modelo antigo (nada muda para eles).

### Aviso de renovar
- Na rotina `financeiro` (já existe, de hora em hora): se `low` e banco ativo, `notify({ type: 'financeiro', ... })` para a
  gestão: "Banco de horas do estúdio: restam 2,5 h (com as gravações marcadas). Hora de renovar." com link para o Financeiro;
  `dedupe` por dia e por faixa (para não repetir a cada hora).
- No Início da gestão e na página do Financeiro, enquanto `low`: faixa `.notice` (filete âmbar; vermelho se negativo).

### Tela (Financeiro)
- Cartão **"Banco de horas do estúdio"** no topo da página do Financeiro (`views/finance/index.ejs`), só com o banco ativo:
  número grande em display = horas disponíveis (`12,5 h`), ao lado "de 20 h" em mono; barra SVG de 6 px (`rect`, sem `style=`;
  neutra; âmbar quando `low`; vermelha quando negativo; **nunca lime** — medir não é ação); linha mono: `USADAS 6,5 H ·
  RESERVADAS 1 H`; botão secundário **"Registrar compra"** (janela curta: data, horas, valor em R$, observação) e um
  `<details>` "Ver uso" com as listas de usadas e reservadas (data mono, nome, minutos mono) e as compras.
- Banco desligado: nos ajustes do Financeiro, um bloco "Estúdio" com o modo atual ("Por hora: R$ 300/h, sinal R$ 150") e o
  botão **"Ligar banco de horas"** (janela: episódio de início — lista com busca dos episódios gravados —, primeira
  compra: data, horas, valor) com a frase do que acontece ("As contas de estúdio ainda não pagas desses episódios e das
  gravações marcadas serão canceladas. O que já foi pago fica como está."). Confirmação antes.
- Ajustes: campo "Avisar quando restarem (horas)" (`studio_bank_alert_hours`).
- Permissões: ler = `finance.read`; ligar banco, registrar compra e ajustar = a permissão de escrita/ajustes do Financeiro
  que já existe.

## Metas / não-metas / anti-metas
- Metas: nenhuma conta de estúdio nova por episódio depois do corte; o saldo de horas sempre certo; aviso na hora.
- Não-metas: relatório do estúdio, nota fiscal, preço por hora do banco nas contas (só a compra conta como despesa).
- Anti-metas: cancelar algo **pago**; cobrar duas vezes (banco + sinal); mexer em episódios antes do corte.

## Restrições
- Design system e marca (`docs/design-system.md`), tokens, sem `style=`, sem lime em medição, português.
- Release: entrada no topo de `src/releases.js` e `package.json` com a próxima minor livre na branch de produção;
  `memory.md` e `README.md` atualizados no mesmo commit final.
- Testes no banco `*_test` próprio (`.superpowers/testdb.env`); a suíte inteira uma vez no fim.

## Produção (depois do deploy, com o OK do dono)
- Ligar o banco com início no episódio `id 29` (Sandro Ferraz) e registrar a compra: **13/11/2026** (sexta-feira, confirmado
  pelo dono), 20 h, R$ 5.000,00.
