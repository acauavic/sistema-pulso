# Link do estúdio: o material da gravação sobe direto para o episódio (desenho)

Pedido do dono em 2026-11-13.

## Por que

Hoje, quando a gravação termina, o estúdio (o Danilo) manda o material pelo WeTransfer. Alguém do Pulso baixa no computador e sobe
de novo no sistema. São duas transferências de dezenas de GB e uma pessoa parada no meio. A ideia é o Danilo subir **uma vez**,
direto para o episódio, por um link que o dono manda pelo WhatsApp.

**Sucesso:** o Danilo abre o link, arrasta os arquivos, espera subir, clica "Terminei o envio" e o material está na aba Material do
episódio, com a equipe avisada. Ninguém do Pulso baixa nem reenvia nada.

## Objetivos

- Ao **marcar como gravado** (o episódio nasce), o episódio ganha um link de envio do estúdio.
- A página do link funciona **sem login**, é **rápida** (o mesmo envio direto em partes do painel) e **segura** (o link só deixa
  enviar para aquele episódio).
- O Danilo **só envia**: não escolhe tipo nem rótulo. A equipe organiza depois, se quiser.
- Ao confirmar, o link **fecha**. O painel pode **pedir reenvio**, e isso gera um link novo.

## Fora do escopo e o que não queremos

- Não é uma área do estúdio: nada de login, lista de episódios ou download.
- O link não mostra nada do sistema além do nome do episódio e do convidado, nem o que outras pessoas subiram.
- Não muda a etapa do episódio sozinho: "Liberar para edição" continua sendo da produção.
- Não manda o link sozinho para ninguém: quem manda é a pessoa, pelo WhatsApp.
- **Seria um fracasso** se o envio ficasse mais lento que no painel, se travasse com arquivos grandes, ou se o link servisse para ver,
  baixar ou apagar o material.

## Formas consideradas

1. **Página pública com o mesmo motor de envio do painel (escolhida pelo dono).** O envio vai do navegador direto para o Backblaze, em
   partes, 6 em paralelo, até 4 arquivos ao mesmo tempo, com retomada. As permissões vêm do código do link. É o mais rápido possível no
   navegador e não tem custo novo.
2. Usuário temporário para o Danilo: mais atrito (senha, sessão expirando no meio do envio) e mais risco (uma conta dentro do sistema).
3. Pasta compartilhada no armazenamento, importada depois: uma credencial por episódio, uma importação para quebrar, e o ganho de
  velocidade é pequeno (o limite é a internet do estúdio).

## Como funciona

### O link

- Tabela nova `episode_upload_links`:
  - `id`, `episode_id` (apaga junto com o episódio), `token` (32 bytes aleatórios em base64url, único);
  - `created_by`, `created_at`, `last_activity_at`;
  - `finished_at` (o Danilo confirmou), `closed_at` + `closed_by` + `close_reason` (`reenvio` | `fechado` | `expirado`).
- **Um link aberto por episódio** (índice único parcial em `episode_id` onde `finished_at` e `closed_at` são nulos).
- **Válido** enquanto não foi confirmado nem fechado e houve uso nos últimos **7 dias**, contados de `coalesce(last_activity_at,
  created_at)`. Cada arquivo iniciado e cada parte confirmada renovam `last_activity_at`, então um envio longo nunca expira no meio.
- **Nasce quando o episódio nasce da gravação**: convidado marcado como Gravado (`production.syncFromGuest`), convidado já
  cadastrado em Gravado, ou episódio registrado pelo "Novo episódio". Episódio antigo, sem link, mostra "Gerar link do estúdio".
- **Pedir reenvio** fecha o link atual (`close_reason = 'reenvio'`) e cria outro com token novo. O link antigo deixa de funcionar na hora.
- **Fechar link** (link pequeno, com confirmação) fecha sem criar outro.
- Endereço público: `https://sistema.podcastpulso.com/estudio/<token>`.

### A página do Danilo (`/estudio/:token`)

Jornada: o Danilo recebe o link no WhatsApp logo depois da gravação, abre no computador do estúdio, arrasta tudo, espera subir e
confirma. O próximo passo dele é fechar a aba.

```
pulso.
EP.014 · DRA. ANA LIMA
Material da gravação
Arraste aqui os arquivos da gravação (vídeos das câmeras, áudio, fotos). Pode mandar tudo de uma vez.
┌──────────────────────────────────────────┐
│   Arraste os arquivos ou  [Escolher arquivos]  │
└──────────────────────────────────────────┘
CAM_A_0001.MOV   18,4 GB  ███████░░░ 71%  · 42 MB/s · faltam 3 min
AUDIO_MIX.WAV     2,1 GB  ██████████ pronto
3 de 5 prontos · 31,2 de 48,0 GB · faltam ~6 min
Mantenha esta página aberta até terminar.
[ Terminei o envio ]   (lime; só ativo quando nada está subindo)
```

- **Tema escuro do painel**, wordmark "pulso.", rótulo mono com EP e convidado, título em display e uma frase curta. Uma ação
  principal: **Terminei o envio**.
- **Envio:** o mesmo `src/public/uploads.js`, apontado para as rotas do link (abaixo). Fica só a bandeja ou a lista de arquivos, sem o
  quadro `upl-shell`, que é do painel. Uma linha por arquivo com barra, %, velocidade e tempo, mais "cancelar" e "tentar de novo".
  No topo, o resumo geral.
- **Pasta ou arquivos soltos** (o Danilo manda dos dois jeitos; em geral 4 câmeras e às vezes o áudio): dá para arrastar uma ou várias pastas, arrastar arquivos soltos ou usar os botões "Escolher arquivos" e "Escolher pasta". De pasta, o sistema lê tudo o que está dentro (subpastas incluídas), ignora arquivos ocultos e de sistema (`.DS_Store`, `._*`, `Thumbs.db`) e guarda o **caminho relativo** junto ao nome (`CAM_A/C0001.MP4`), porque câmeras repetem o nome do arquivo. O caminho aparece na página, no painel (nome do arquivo) e vira o rótulo inicial com o nome da pasta de cima (ex.: "CAM_A"), que a equipe pode trocar em Organizar.
- **Retomada:** escolher os mesmos arquivos ou a mesma pasta de novo continua de onde parou; o reconhecimento é pelo caminho completo + tamanho (não só pelo nome), para dois `C0001.MP4` de câmeras diferentes não se confundirem.
- **Página aberta:** aviso fixo "Mantenha esta página aberta até terminar", confirmação do navegador ao tentar sair durante o envio,
  e a tela não apaga enquanto sobe (Wake Lock, quando o navegador permitir).
- **"Terminei o envio":** ativo só quando nenhum arquivo deste link está subindo. Se algum falhou e não foi refeito, a confirmação
  diz quantos e pergunta se quer terminar mesmo assim. Ao confirmar, o link fecha, a página mostra "Recebido. Obrigado." com a
  lista do que chegou, e a equipe é avisada.
- **Link fechado, confirmado, expirado ou inexistente:** a mesma página simples, com "Este link não está mais aberto. Se precisar
  enviar de novo, fale com a produção." e nada além disso. A página não diz se o link existiu.
- **O que aparece na lista:** só os arquivos enviados **por este link**. Arquivos que a equipe subiu pelo painel nunca aparecem.

### Rotas públicas (`src/routes/studioUpload.js`)

Espelham as do painel, com o link no lugar do login:

- `GET /estudio/:token` mostra a página;
- `POST /estudio/:token/arquivos/iniciar`;
- `GET /estudio/:token/arquivos/:fid/direto` (links assinados das partes);
- `POST /estudio/:token/arquivos/:fid/parte/:n/ok`;
- `PUT /estudio/:token/arquivos/:fid/parte/:n` (envio pelo servidor, quando o direto não estiver disponível);
- `GET /estudio/:token/arquivos/:fid/partes`;
- `POST /estudio/:token/arquivos/:fid/concluir`;
- `POST /estudio/:token/arquivos/:fid/cancelar`;
- `POST /estudio/:token/terminei`.

Regras:

- Toda rota confere se o link é válido.
- O arquivo (`fid`) só é aceito se foi criado **por este link**: coluna nova `episode_files.upload_link_id`.
- Sem CSRF: o segredo é o token na URL, como no convite e no portal.
- Limites de requisição por token e por IP, generosos para as partes. Um envio de 48 GB em partes de 64 MB são cerca de 750 partes.
  Os limites existem contra abuso, não contra o Danilo.
- `iniciar`:
  - aceita vídeo, áudio, imagem e "outro" com as extensões que o painel já aceita para material bruto;
  - recusa vídeo editado;
  - limite de 200 GB por arquivo, o mesmo de hoje;
  - o tipo sai sozinho pela extensão: vídeo vira `bruto_video`, áudio vira `bruto_audio`, imagem vira `foto`, o resto vira `outro`;
  - rótulo vazio, `uploaded_by` nulo e `upload_link_id` preenchido;
  - Backblaze cheio responde como no painel.
- `concluir` segue o caminho do painel para material bruto (`prod.finishUpload`, evento do arquivo) e registra "Enviado pelo link do
  estúdio".
- `cancelar` só vale para arquivo deste link que ainda está subindo. O link nunca apaga arquivo pronto.
- **Cabeçalhos da página:**
  - CSP própria, como a do portal, com `connect-src` liberado para a origem do Backblaze por causa do envio direto;
  - `noindex`;
  - `Referrer-Policy: no-referrer`, para o token não vazar;
  - `Cache-Control: no-store`.

### No painel

- **Aba Material do episódio**, cartão "Link do estúdio" no topo do material bruto, mostrando o estado:
  - **Aguardando envio** (criado em, em mono):
    - **Copiar link** é o lime do cartão;
    - "Mandar no WhatsApp" é secundário e só aparece com o número do estúdio configurado. Abre o `wa.me` com a mensagem pronta e o link.
  - **Enviando:** "N arquivos chegando pelo link", com a última atividade em mono.
  - **Concluído:** "Material recebido em 13/11 18:40 · 5 arquivos · 48 GB", em mono. **Pedir reenvio** é secundário, com confirmação:
    "O link novo substitui o antigo".
  - **Fechado ou expirado:** "Link fechado", com **Gerar link novo**.
  - "fechar link" fica como link pequeno, com confirmação, enquanto o link estiver aberto.
- **No convidado:** depois de "Marcar como gravado", o cartão do próximo passo mostra o mesmo link com Copiar, enquanto ele estiver
  aguardando envio.
- **Número do estúdio:** Gestão > WhatsApp dos convites ganha o grupo **Estúdio**, com número e mensagem. A mensagem padrão é "Oi!
  Segue o link para subir o material da gravação de {nome}: {link}". Sem número, só aparece o Copiar.
- **Organizar** em cada arquivo do material bruto (vale também para os enviados pelo painel). Abre uma janela com o tipo (Vídeo bruto,
  Áudio bruto, Bastidores, Fotografia, Outro) e o rótulo livre (ex.: "Câmera 2"). Permissão `production.upload`. O vídeo editado
  fica de fora.
- **Arquivos que vieram pelo link** levam a marca "estúdio" em mono na linha.
- **Avisos** (notificação do tipo "Etapas do episódio", para quem recebe os avisos da produção do episódio):
  - o primeiro arquivo chegou pelo link: "O estúdio começou a enviar o material do EP.014";
  - o Danilo confirmou: "Material do EP.014 recebido pelo link do estúdio · 5 arquivos".
- **Linha do tempo do episódio:** link gerado, link copiado não entra, primeiro envio, confirmação, pedido de reenvio, link fechado.
- **Auditoria:** gerar, reenviar e fechar.

## Decisões da revisão (calls do construtor, conferir na leitura)

- **Quem vê e mexe no link:** quem tem `production.upload` (superadmin, gestão, produtora). O cartão no convidado e na aba Material só aparece para esses perfis; o editor de vídeo não vê o link.
- **Limite por link:** até **1 TB somados e 500 arquivos** (além dos 200 GB por arquivo). Passou disso, o envio recusa com "Este link chegou ao limite de material. Fale com a produção." Protege o Backblaze se o link vazar (Backblaze cheio para todos os envios do painel).
- **Pedir reenvio é aditivo:** o material que já chegou continua no episódio; o link novo só traz o que faltava ou o que precisa ser trocado (a equipe apaga o que não serve). O cartão "Concluído" conta só o link atual; os anteriores aparecem como linhas no histórico do episódio.
- **Ao fechar um link** (reenvio, fechar ou "Terminei" com falhas), os envios dele que pararam no meio são cancelados no Backblaze (liberam espaço); o link novo não retoma arquivo de outro link.
- **Avisos:** vão para as produtoras ativas, a gestão e quem gerou o link (o Danilo não é usuário, então ninguém é pulado).

## Restrições

- Tudo em pt-BR, no tom da marca. Design system: um lime por área, dados em mono, sem `style=` nem `<script>` inline, só tokens.
- Release minor 1.66.0 em `src/releases.js` e `package.json`; atualizar `memory.md`, `README.md`, `assistantKnowledge` e
  `docs/design-system.md`.
- Testes com o Backblaze simulado, como na suíte atual.

## O que fica para quem constrói

- Como adaptar o `uploads.js` para a página pública, seja por opção de configuração ou por um modo "público" sem o quadro do painel,
  desde que o motor de envio (paralelismo, partes, retomada, envio direto) seja o mesmo.
- Os números exatos dos limites de requisição.
- A redação final das frases curtas, dentro do tom da marca.
