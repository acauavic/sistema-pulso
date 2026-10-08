# Pulso — Manual de Identidade Visual (v2.0 · 2026)

> Fonte: `docs/referencias/Manual_de_Marca_Pulso.dc.html`. Resumo de trabalho para qualquer peça, tela, e-mail ou
> texto do projeto. Interface: `docs/design-system.md`.

## Essência

- **Tagline**: "As conversas que estão movimentando a saúde." Eixos: Saúde · Inovação · Empreendedorismo · Negócios.
- **Ideia**: a saúde precisa de melhores conversas. A marca é um estúdio de alto padrão que também se veste: séria na mesa, jovem na rua, premium em cada objeto.
- **Quatro atributos**: **Jovem** (lime elétrico, caixa baixa, ritmo) · **Elegante** (muito preto, muito espaço, serifa itálica para a voz dos convidados) · **Séria** (dados em mono, numeração de episódio, grid rígido) · **Premium** (Deep Plum, tom sobre tom, relevo seco).
- **Tom de voz — falamos assim**: "Você é nosso convidado." · "Uma conversa que fica." · "Grandes nomes. Uma mesma mesa." · "Obrigado por sentar à mesa."
- **Evitamos**: "Imperdível!!!", "Corre que é hoje", "O maior podcast de saúde do Brasil", "Clique aqui e descubra o segredo". Sem exagero, sem urgência falsa, sem superlativo vazio.

## Logotipo — "O ponto é o pulso"

- Wordmark **pulso.** em Space Grotesk Bold, **caixa baixa**, espacejamento −6%. O ponto final é o batimento e vira símbolo autônomo.
- Versões: principal (negativo, ponto lime sobre preto) · sobre lime (preto) · premium (plum + bone).
- Assinaturas: wordmark (padrão) · completa com "PODCAST" (capas, institucional) · monograma **p.** (avatar, bordado, relevo) · o Ponto (favicon, botão).
- Área de proteção: margem mínima = 1,5× o diâmetro do ponto. Tamanho mínimo 64px digital / 18mm impresso; abaixo disso, use o monograma.
- **Não faça**: distorcer · caixa alta (`PULSO.`) · baixo contraste · trocar o ponto (`pulso!`).
- No código: `<span class="wordmark">pulso<span class="dot">.</span></span>`.

## Cores

- **Pulse Lime `#C8FF42`** (acento — nunca mais de 10% da peça) · **Deep Black `#0A0A0A`** · **Deep Plum `#2D1B4E`** (premium, objetos e momentos especiais) · **Pure White `#FAFAFA`**.
- Apoio: **Bone `#F0EDE3`** · **Graphite `#1F1F1F`** · **Steel `#6B6B6B`** · **Silver `#B5B5B5`**.
- Proporção de uso: **60% preto · 20% branco/bone · 12% plum · 8% lime** ("Preto domina. Lime pulsa.").
- Pantone aprox.: Lime 375 C · Black 6 C · Plum 2695 C.

## Tipografia — quatro vozes

- **Space Grotesk** (display, 500/700, tracking −4 a −6%): logotipo, títulos, nomes de convidados, chamadas.
- **Instrument Serif Itálico** (voz, 400): exclusiva para frases de convidados, citações e taglines.
- **Inter** (texto, 300/400/500): textos corridos, descrições, legendas.
- **JetBrains Mono** (dados, 400/500, caixa alta, tracking +18%): numeração de episódio, datas, rótulos, créditos.
- Hierarquia em uso: rótulo mono → nome em display → frase em serifa → contexto em Inter. Ex.: `EP.012 · EMPREENDEDORISMO MÉDICO` / **Dr. Márcio Martins** / *"Médico que não entende de negócio vira refém do próprio consultório."*

## Símbolos de apoio

- **Linha de Pulso**: batimento que vira onda de áudio; divisor, barra de progresso, bordado lateral. (No código: `partials/pulse-line.ejs`.)
- **O Selo**: carimbo de pertencimento (lacre de caixa, adesivo, bordado). **O Contador**: número de 3 dígitos em mono com o Ponto como separador (`EP.014`).
- **As Aspas**: só a de abertura, em lime sobre preto ou plum. **Os Colchetes**: enquadram temas (`[ à mesa ]`). **Os Eixos**: cada pauta ganha uma variação do Ponto (HISTÓRIAS · INOVAÇÃO · NEGÓCIOS · IA).

## Padrões

- P1 campo de pontos (usado no fundo do login) · P2 monograma tom sobre tom (premium) · P3 batimento corrido · P4 wordmark corrido.

## Aplicações digitais

- O convidado é o protagonista; a marca assina com discrição. Capa YouTube 1280×720, feed Instagram 1080×1350, carrossel de frases 1080×1350 (rotação fixa **preto → plum → bone**), Reels/Story 1080×1920 (área segura: texto acima dos 22% inferiores e abaixo dos 8% superiores).
- Assinatura de e-mail: "Abraços," + monograma + nome e cargo ("Host · Pulso Podcast"), contato e @.
- **E-mails do sistema** (`src/services/mailer.js`): cabeçalho preto com wordmark, corpo claro, botão preto com ponto lime, rodapé mono.

## Aplicações físicas (referência)

- Backdrop de estúdio (letreiro neon, painel ripado preto, mesa com filete lime, tapete plum), caneca, camiseta "eu sentei à mesa", tote plum, boné com monograma, kit do convidado (caixa preta fosca, relevo seco, filete lime, interior plum, cartão de agradecimento). Poucos elementos, muito acabamento, **um único ponto lime**.
