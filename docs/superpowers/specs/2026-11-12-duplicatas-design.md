# Duplicatas de convidados e patrocinadores (desenho)

Pedido do dono em 2026-11-12: o sistema reconhece convidado ou patrocinador cadastrado em dobro, pelo nome ou pelo @ do Instagram,
avisa quando é **possível** duplicata e quando tem **certeza**, e deixa **juntar** os dois cadastros.

## O que existe hoje

- Convidados: 173 em produção, nenhuma duplicata por @, e-mail, telefone ou nome parecido. A importação por planilha
  (`csvImport.markDuplicates`) já barra @ e e-mail repetidos; o assistente (`assistant.js`) também.
- Patrocinadores: 159, com **4 pares duplicados** (Mundo Verde, Mustela, PleniMed, Vitha), IDs seguidos e criados no mesmo dia:
  clique duplo no "Criar" (o formulário não trava o botão). Patrocinador **não tem campo de Instagram** e não vai ganhar um
  (decisão do dono): compara por empresa, site, e-mail e telefone do contato.
- Probiótica e Max Titanium usam o mesmo e-mail (`marketing@supley.com.br`, mesmo grupo) e **não** são duplicata.

## Regras de comparação (`src/services/duplicates.js`, funções puras + consultas)

Normalização:
- **Instagram**: minúsculas, sem `@`, sem `https://(www.)instagram.com/`, sem `/` e sem `?…` (`@Fulano`, `instagram.com/fulano/`
  e `fulano` são iguais). Vazio não compara.
- **E-mail**: minúsculas, sem espaços.
- **Telefone**: só dígitos; sem o `55` do começo quando sobram 10 ou 11 dígitos. Menos de 10 dígitos não compara.
- **Nome de pessoa**: minúsculas, sem acento, sem títulos no começo (Dr., Dra., Dr.ª, Prof., Profa.), só letras e espaços.
- **Empresa**: como nome de pessoa, mais sem sufixos societários (ltda, s.a., sa, eireli, me, epp) e sem pontuação.
- **Site**: só o domínio, sem `www.`, sem caminho nem parâmetros (`https://www.mustela.com.br/?utm…` = `mustela.com.br`).
  Domínios de redes e agregadores (instagram.com, linktr.ee, facebook.com, wa.me, bit.ly) não comparam.

Níveis (cada par devolve o nível mais alto e os motivos, ex.: "mesmo @", "nome parecido"):
- **Convidado, certa**: mesmo Instagram, mesmo e-mail ou mesmo telefone.
- **Convidado, possível**: nome parecido: nomes normalizados iguais; ou mesmo primeiro e último nome (com 2+ palavras);
  ou distância de edição até 2 com nomes de 8+ letras (até 1 com menos).
- **Patrocinador, certa**: mesma empresa normalizada ou mesmo site.
- **Patrocinador, possível**: empresa parecida (mesma regra de distância), mesmo e-mail de contato ou mesmo telefone.

Cálculo na hora, em JS (300 cadastros = ~50 mil pares, barato); nada de extensão nova no Postgres. O único estado guardado é o par
dispensado.

## Onde aparece

1. **Ao cadastrar** (formulário de convidado e de patrocinador, convidado/patrocinador novo pela tela de episódio, assistente):
   antes de gravar, procura duplicatas. Havendo, **não grava** e volta ao formulário (com tudo preenchido) com um `.notice`
   (âmbar para possível, vermelho para certa): a lista do que já existe (nome em display, etapa em chip, responsável e motivo em
   mono, link **Abrir cadastro**) e o botão secundário **Cadastrar mesmo assim** (campo `confirmar_duplicata=1`). O assistente
   devolve o aviso e só cria com `confirmado`. A planilha passa a usar as mesmas regras de "certa" (as linhas vêm marcadas como
   repetidas, como hoje).
2. **Clique duplo**: os formulários de criar convidado e patrocinador levam `data-busy`. A segunda requisição igual cai na regra
   acima (mesma empresa = certa) e não grava.
3. **No cadastro que já existe**: faixa `.conn-alert` no topo (ícone `copy`, vermelha para certa; âmbar para possível), "Duplicata
   de X" / "Possível duplicata de X" com o motivo em mono, botão **Comparar e juntar** e o link pequeno "não é duplicata" (some o
   aviso daquele par para todos). Com 2+ candidatos, uma linha por candidato.
4. **Gestão > Sistema > Duplicatas** (`/gestao/duplicatas`): abas Convidados | Patrocinadores (`data-tabs`, contagem em mono),
   uma linha `.req-row` por par (os dois nomes em display, etapas em chip, motivo em mono, chip Duplicata/Possível), à direita
   **Comparar e juntar** e "não é duplicata". Certas primeiro. Vazio ensina: "Nenhuma duplicata. O sistema confere a cada cadastro
   novo." Os pares dispensados ficam num `<details>` "Marcados como não duplicata (N)" com "voltar a avisar".

## Juntar

Janela **Comparar e juntar** (`<dialog>`, rota `GET /duplicatas/:tipo/:a/:b` devolve a página da comparação quando aberta direto):
- Dois cartões lado a lado (no celular, um embaixo do outro): nome, etapa, responsável, criado em (mono) e contagens em mono do que
  cada um tem (abordagens, comentários, tarefas, episódio, reuniões, lançamentos, arquivos).
- **Qual fica**: `.seg-radio` com os dois; já vem marcado o de etapa mais avançada (ordem do funil) e, empatando, o com mais
  histórico, e então o mais antigo.
- **Campos em conflito**: só os preenchidos nos dois com valor diferente (depois de normalizar), um `.seg-radio` por campo com os
  dois valores. Vazio de um lado é preenchido com o do outro sem perguntar.
- Valor que não ficou vai para as observações (`notes`) do que fica: "Do cadastro juntado (Fulano, #123): e-mail x@y.com; telefone …".
- Avisos em `.notice` quando o que sai tem link público ativo (convite, portal, página da plateia, media kit/portal do patrocinador):
  "O link … deste cadastro deixa de funcionar."
- Frase da lixeira: "O cadastro que sai vai para a lixeira. Restaurar devolve os dados dele, mas o histórico continua aqui."
- Botão primário **Juntar no cadastro de Fulano** (`data-busy`, `data-confirm`).

O que o servidor faz (`duplicates.merge(type, keepId, dropId, choices, user)`), numa transação com trava nas duas linhas:
- Confere de novo que os dois existem, são do mesmo tipo e diferentes.
- Aplica no que fica os valores escolhidos e os vazios preenchidos, e acrescenta as observações.
- **Move tudo que aponta para o que sai**: as chaves estrangeiras são descobertas no banco (`pg_constraint` para `guests`/`sponsors`),
  então tabela nova futura entra sozinha. Para cada uma, antes do UPDATE, apaga do que sai as linhas que bateriam num índice
  único com as do que fica (fica a do que permanece: ex. o mesmo episódio ligado duas vezes, dois briefings). Tabelas sem chave
  estrangeira, ditas uma a uma: `comments` (entity_type/entity_id), `outreach_attempts` (subject_type/subject_id).
- O que sai vai para a lixeira pelo caminho normal (`trash.remove`), já sem o que foi movido.
- Linha do tempo do que fica: "Juntado com o cadastro de X (criado em 26/10/2026) por Fulano." Auditoria
  `convidado.juntado` / `patrocinador.juntado` com os dois ids e os campos escolhidos.
- Volta para o cadastro que ficou com o flash `flash-undo` ("X foi para a lixeira", com Desfazer, que restaura o cadastro que saiu
  como qualquer item da lixeira).

## Par dispensado

Tabela `duplicate_dismissals (kind 'guest'|'sponsor', a_id, b_id com a_id < b_id, dismissed_by, dismissed_at, PK (kind, a_id, b_id))`.
Some do aviso no cadastro e da lista; "voltar a avisar" apaga a linha. Apagar um dos cadastros deixa a linha órfã sem efeito.

## Permissões

Ver aviso, dispensar e juntar: quem tem `guests.write` (convidados) ou `sponsors.write` (patrocinadores). A página da gestão:
permissão nova `duplicates.manage` para gestão e superadmin (em `src/permissions.js`), e quem tem só a de escrever vê os avisos
nos cadastros.

## Testes (`test/duplicatas.test.js`)

- Normalização e níveis com casos reais: Mustela com site cheio de `utm` (certa), "Dr. Bruno Bindi" × "Bruno Bindi" (possível),
  Probiótica × Max Titanium (possível, só e-mail), @ em formatos diferentes (certa), telefone com e sem 55 (certa), linktr.ee não
  compara.
- Cadastro: aviso aparece e não grava; "Cadastrar mesmo assim" grava; nada parecido grava direto; assistente pede confirmação.
- Aviso no cadastro existente, dispensar e voltar a avisar; lista da gestão e permissões (editor de vídeo 403).
- Juntar: abordagens, comentários, eventos, tarefas, lançamentos e reunião passam para o que fica; repetidos resolvidos (mesmo
  episódio de patrocínio); valor descartado nas observações; vazio preenchido; o que sai na lixeira; restaurar devolve o cadastro;
  juntar com ele mesmo ou de tipos diferentes é recusado.

## Fora do escopo

- Campo de Instagram no patrocinador (decisão do dono).
- Comparar convidado com patrocinador.
- Desfazer a junção movendo o histórico de volta.
- Redirecionar o link público do cadastro que saiu.
