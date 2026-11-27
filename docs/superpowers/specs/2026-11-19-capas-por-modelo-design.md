# Capas por modelo: ficha do episódio, modelos do guia e vídeos do convidado

Plano de 19/11/2026. Fonte: `docs/referencias/capas/Guia de Capas e Video Pulso.html` (Guia de peças do episódio, v1.1) e as 7 capas de exemplo em `docs/referencias/capas/thumbs/`. Branch `capas-modelos` (worktree `sistema_pulso-capas`). Nada é publicado sem autorização.

## 1. O que muda, em uma frase

Hoje o sistema escolhe um quadro, encaixa o texto onde sobra espaço e gera 3 thumbnails parecidas. Passa a existir **uma ficha por episódio** (os textos, com limite) e **modelos fixos do guia** (8 de YouTube, 3 de Spotify, 3 de Reels, 2 vídeos); toda peça nasce da ficha, e trocar de modelo é um toque, sem redigitar nada.

## 2. Quem usa e quando (jornadas)

- **Quem finaliza o episódio** (gestão ou produtora) chega no passo 2 da Finalização depois da análise por IA. Quer sair com as thumbnails do teste A/B e a capa do Spotify aprovadas. Próximo passo: checklist e publicar.
- **Quem cuida dos cortes** (social) chega na página do corte ou em Capas em lote. Quer uma capa que diga o gancho do trecho, dentro do recorte 3:4 do grid. Próximo passo: publicar.
- **Quem lança o episódio** chega na aba Vídeos no dia da estreia. Quer o story de lançamento e o teaser prontos para baixar. Próximo passo: postar.

Regra que guiou o desenho: **a pessoa nunca precisa saber o que é "YT-E"**. Ela vê a capa pronta, vê as alternativas como miniaturas e escolhe com os olhos. O código do modelo aparece só em mono pequeno, para quem conversa com o designer.

## 3. A experiência, tela por tela

### 3.1 Finalização, passo 2: "Capas e vídeos" (no lugar de "Thumbnail do YouTube")

Fechado, o passo mostra uma linha de resumo: `YouTube: 2 aprovadas · Spotify: aprovada · Vídeos: 1 de 2`. Aberto:

```
CAPAS E VÍDEOS                                             [chip: escolha as do teste]
Credencial: "Abrir clínica" · Eixo: Negócios                              Editar
[ YouTube 3 ] [ Spotify 1 ] [ Vídeos 2 ]                       (.seg.seg-tabs)

┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│   (capa A)    │  │   (capa B)    │  │   (capa C)    │
└───────────────┘  └───────────────┘  └───────────────┘
CURIOSIDADE        CONTRASTE          AUTORIDADE            (mono)
Tarja lime · YT-B  Close + palavra    Número · YT-D
[168 px ▪]  lê bem [168 px ▪] lê bem  [168 px ▪] foto ampliada 1,8×
Aprovar  Ajustar ⋯ Aprovar  Ajustar ⋯ Aprovar  Ajustar ⋯
```

- **Vazio**: uma frase ("A IA lê a transcrição, preenche os textos e monta 3 thumbnails, uma por ângulo, e a capa do Spotify.") e o lime **Gerar capas**. Um clique gera tudo: ficha, 3 thumbnails e Spotify.
- **Cada cartão**: a capa; o ângulo em mono; o nome do modelo em gente ("Tarja lime") com o código em mono; a miniatura de 168 px ao lado do veredito do teste de redução ("lê bem" neutro, "não lê a 168 px" vermelho). Assim o teste do guia vira algo que se vê, sem explicar.
- **Dois botões por cartão**: **Aprovar** e **Ajustar**. O resto (baixar, ajuste fino no editor, excluir) fica no menu da linha.
- **Aprovar várias**: a primeira aprovada é a **principal** (vai para o YouTube ao publicar; chip neutro com estrela). As outras aprovadas ficam "no teste A/B". Com 2 ou mais aprovadas aparece **Baixar para o teste** (ZIP com `pulso_ep018_yt_A.jpg`, `_B`, `_C`, os nomes do guia). O lime da área é sempre um só: Gerar capas enquanto vazio; depois, Aprovar da primeira capa sem problema.
- **Peça que não pôde ser gerada** (texto passa do limite, falta número dito no episódio): o cartão vira um espaço tracejado com o motivo e o botão Ajustar ("Autoridade: a frase tem 8 palavras, o limite é 6").
- **Aba Spotify**: uma capa, com a miniatura de 64 px ("como aparece na lista do app") e Aprovar / Ajustar / Baixar (JPG 3000×3000, abaixo de 512 KB).
- **Linha da credencial**: "Editar" abre uma janela curta com Nome como aparece, Credencial (até 6 palavras, com contador), Eixo (`.seg-radio`: Histórias, Negócios, Inovação, IA). Salvar refaz sozinho as peças que usam esses campos; peça editada à mão ganha o chip âmbar "desatualizada" em vez de ser sobrescrita.

### 3.2 A janela "Ajustar capa" (uma só, com prévia ao vivo)

```
┌ Ajustar capa · Curiosidade ───────────────────────────────────────┐
│                               │ [ Texto ] [ Modelo ] [ Foto ]      │
│      PRÉVIA AO VIVO           │                                    │
│   (canvas, mesmo motor        │ Antes da tarja   O imóvel pode 3/4 │
│    do servidor)               │ Palavra em destaque  fechar   1/1  │
│                               │ Depois           sua clínica  2/3  │
│   [168 px ▪] lê bem           │ Total 6 de 6 palavras              │
│                               │ Sugerir com IA  → 3 opções em chip │
│                               │                    Cancelar Salvar │
└────────────────────────────────────────────────────────────────────┘
```

- **Texto**: só os campos que aquele modelo usa, com contador ao lado de cada um (palavras ou letras, como no guia). Passou do limite: contador vermelho e Salvar desligado, com a regra do guia em uma linha ("Se não cabe, troque de ângulo; não reduza a fonte"). "Sugerir com IA" devolve 3 alternativas em chips; tocar troca, com Desfazer.
- **Modelo**: grade de miniaturas **da mesma capa em cada modelo do ângulo**, já com o texto e a foto. Tocar troca a prévia. Modelo que pede um campo que falta aparece apagado com o motivo ("pede um número dito no episódio"). O Lime total (YT-G) mostra "episódio especial · último uso EP.016" e avisa se foi usado nos últimos 4 episódios.
- **Foto**: abas Quadros do vídeo | Fotos da gravação. Cada miniatura mostra o aviso "ampliada 1,8×" quando passa de 1,5×. O recorte sai do rosto. Foto sem rosto reconhecido: "Toque no rosto" (um toque marca).
- No celular a janela vira folha: prévia presa no topo, abas embaixo.
- O editor livre de hoje continua como **ajuste fino** no menu. Depois dele a capa fica "editada" e trocar de modelo pede confirmação.

### 3.3 Cortes (página do corte e Capas em lote)

- As 3 opções de capa de cada corte passam a vir em **modelos diferentes**: gancho corrigido (RL-A com logo e rótulo dentro do grid), tarja central (RL-C) e frase (RL-B, quando o corte tem uma frase literal forte). A variedade chega sem controle novo na tela.
- A mesma janela Ajustar, com os campos do corte: gancho (até 9 palavras, com a palavra de destaque), apoio (até 12) e frase (até 10).
- Em Capas em lote a linha continua igual (capas como rádios, texto com "Sugerir com IA"); cada rádio mostra o modelo em mono.
- Trava nova: capa de corte com "Q&A", "Corte" ou só o nome do convidado vira aviso ("diga o gancho do trecho").

### 3.4 Vídeos do convidado (aba Vídeos)

- Dois cartões: **Story de lançamento · 11 s** (para quem já segue) e **Teaser · 15 s** (para público frio). Cada um: capa do vídeo com play, **Gerar vídeo** (leva 1 a 2 minutos; mostra o andamento e dá para sair da tela), Baixar, Refazer.
- O teaser usa o gancho da capa de curiosidade, o nome com a credencial e a **frase literal na voz do convidado**, com a legenda entrando palavra por palavra. Ele só fica disponível com a frase conferida (tempo na ficha) e o vídeo editado no sistema; sem isso o cartão diz o que falta.
- Antes de gerar, uma linha de conferência: "Frase: 'Reforma não salva imóvel errado.' · 00:42:17 · ouvir" (toca o trecho).

### 3.5 Estados e avisos (valem em todas as abas)

- Problema que impede aprovar: chip vermelho com o motivo em português (texto sobre o rosto, fora do recorte 3:4, texto no canto da duração, abaixo do tamanho mínimo).
- Aviso que não impede: chip âmbar (foto ampliada, logo sobre área clara, lime repetido).
- Frase que a IA devolveu e não está na transcrição: "não achei esta frase no áudio; confira antes de usar" e o modelo de frase fica apagado até alguém confirmar.

## 4. A ficha (os dados)

Guardada em `episode_metadata.cover_sheet` (JSONB) e, por corte, em `episode_clips.cover_sheet`. Ninguém vê JSON: os campos aparecem na peça que os usa.

- `guest` (2 linhas) · `tag` credencial (6 palavras) · `axis` (4 opções) · `ep` (3 dígitos, automático)
- `angles[]` curiosidade, contraste, autoridade: `model`, e conforme o modelo `pre`/`hl`/`post` (4 + 1 + 3 palavras, total 6), `setup`/`punch` (4 palavras + 1 de até 9 letras), `num`/`line` (3 caracteres + 6 palavras)
- `quote` frase literal (8 palavras) com `at_ms` · `spotify_hook` (7 palavras, diferente do título e das capas)
- corte: `hook` (9 palavras, com `hl`), `sub` (12), `quote` (10)

Quem preenche: um pedido à IA com o prompt base do guia, a transcrição e o cadastro do convidado. O servidor confere todo limite, procura a frase na transcrição (acha o tempo) e confere se o número foi dito. Campo reprovado não gera a peça dele.

## 5. Modelos

- **YouTube 1280×720**: YT-A painel lateral · YT-B tarja lime · YT-C plum dividido · YT-A+ credenciais · YT-D número · YT-E close + palavra · YT-F frase (fundo creme) · YT-G lime total. Por ângulo: curiosidade B, E, C · contraste B, F · autoridade A+, D, G.
- **Spotify 3000×3000**: SP-A padrão · SP-B foto cheia · SP-C plum com retrato. Entra sozinho o SP-A; o SP-B quando há foto de câmera vertical em alta.
- **Reels 1080×1920**: RL-A (corrigido) · RL-B frase · RL-C tarja central.
- **Vídeo 1080×1920**: VD-A story de lançamento (11 s) · VD-B teaser (15 s).

As medidas (posições, tamanhos, degradês, tarjas) vêm do próprio arquivo do guia, que traz cada modelo em pixels, e o recorte da foto usa a mesma conta do guia (rosto na altura-alvo, centrado no ponto do modelo, com esmaecimento no topo quando a foto não alcança).

## 6. Como fica por dentro

- **Um motor só** (`src/public/design/engine.js`, o mesmo no navegador e no servidor), para a prévia ao vivo ser igual ao arquivo final. Ganha camadas novas: foto recortada em retângulo ou círculo com máscara, degradê de vários pontos, tarja (texto com fundo ajustado à largura), aspas, filete, etiquetas de credencial, padrão de pontos, linha de pulso.
- **`src/public/design/models.js`** (novo, também compartilhado): cada modelo é uma função `build(ficha, foto) -> spec`, com os limites dos campos e a conferência própria. `spec.model` e `spec.sheet` ficam guardados na capa: trocar de modelo é reconstruir, sem perder nada.
- **Conferência** (`lint`): tamanho mínimo por peça, rosto + 40 px livre, canto da duração, recorte 3:4, um destaque por peça, teste de redução (render a 168 px ou 64 px e contraste da palavra de destaque), foto ampliada.
- **Banco** (migração 092): `cover_sheet` nas duas tabelas; `episode_covers.model`, `angle`, `main`; tipo novo `spotify_cover`; tabela `episode_teasers` para os dois vídeos.
- **Olhar do convidado**: a análise dos quadros passa a dizer para que lado a pessoa olha; os modelos de painel põem o texto desse lado (regra 02 do guia). Quadro antigo, sem essa leitura, usa a posição do rosto.
- **Vídeos**: quadros desenhados pelo mesmo motor (30 por segundo) e montados com o FFmpeg que o servidor já tem; o trecho da fala é cortado do vídeo editado e retranscrito com tempo por palavra para a legenda.
- **Compatibilidade**: capas antigas continuam abrindo e editando como hoje. A geração nova substitui só o que é automático e não aprovado, como já acontece.

## 7. Entregas (cada uma testada e publicável sozinha)

1. **Motor, modelos e ficha (base)**: camadas novas, os 14 modelos de imagem, ficha com IA e limites, conferência. Prova: renderizo o exemplo do guia (Ricardo, Carol, Mari, com as fotos do próprio guia) e comparo lado a lado com o guia.
2. **Finalização: Capas e vídeos**: passo 2 novo, janela Ajustar com prévia ao vivo, aprovar várias com principal, ZIP do teste, aba Spotify.
3. **Cortes**: 3 opções em modelos diferentes, janela Ajustar no corte, Capas em lote, fotos de câmera como fonte.
4. **Vídeos do convidado**: VD-A e VD-B, com andamento, conferência da frase e download.

Em todas: testes automatizados (limites da ficha, cada modelo gera sem problema com o exemplo do guia, conferências, rotas e permissões), página Novidades, `memory.md`, README e design system. Percorro desktop e celular antes de te chamar, porque aqui o resultado é visual.

## 8. Fora deste plano

- Publicar a capa no Spotify (o envio continua manual; o sistema entrega o arquivo no padrão).
- Teste A/B automático no YouTube (o YouTube não abre isso para sistemas; o ZIP sai pronto para subir no Studio).
- O selo redondo do YT-A+ ("01 · único no Brasil"): entra sem o selo; se quiser, vira um campo opcional depois.

## 9. Decisões do dono (19/11/2026)

- **Sem trilha nos vídeos**: a trilha entra na hora de postar.
- **Arquivo da thumbnail**: PNG quando cabe em 2 MB, senão JPG. O sistema guarda o JPG e monta o PNG na hora de baixar.
- **Aprovar várias thumbnails**: a primeira aprovada é a principal (vai para o YouTube); as outras ficam no teste A/B, com o ZIP nos nomes do guia.

## 10. O que mudou em relação ao plano, durante a construção

- **Ajuste fino no editor livre**: as capas dos modelos do guia não abrem no editor livre (ele não conhece as camadas novas: foto recortada, tarja, degradê). Em troca, a aba Foto da janela Ajustar ganhou "toque no rosto", Aproximar, Afastar e Espelhar o desenho. Capas antigas e posts continuam no editor livre.
- **Credencial**: o limite na tela é de 8 palavras (o ideal continua 6), porque o próprio guia usa uma credencial de 8.
- **O editor livre voltou (2.11.0, 26/11/2026, pedido do dono)**: "quero voltar a ter aquele poder de edição completo". O editor
  completo passou a conhecer as camadas novas (foto recortada, tarja, degradê, pontos, linha de pulso, rótulos contornados) e abre
  as capas dos modelos, como o plano previa em 3.2: o cartão tem um "Editar" só, com Editor completo e Ajustar pelo modelo. Depois
  do editor a capa fica "editada" (`spec.edited`): a ficha nova não a sobrescreve (vira desatualizada) e montar de novo pelo
  modelo pede confirmação. No editor livre os limites de palavras do guia não travam: a conferência e o teste de redução avisam.

## 11. Perguntas originais (respondidas acima)

1. **Trilha da vinheta** (arquivo de áudio) para o fim do teaser e para o story. Sem ela, os vídeos saem sem trilha.
2. **Arquivo das thumbnails**: o guia pede PNG até 2 MB; foto em PNG costuma passar disso. Proposta: PNG quando couber, senão JPG de alta qualidade. Confirma?
3. **Aprovar várias thumbnails** (principal + teste A/B), como descrito em 3.1: pode ser assim?
