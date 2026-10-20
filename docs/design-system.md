# Pulso — Design System de Interface (v1.0)

> Fonte: `docs/referencias/Pulso_UI_Design_System.dc.html` (original do designer; os `{{ }}` e `./support.js` dele
> só renderizam no ambiente de origem). Este arquivo é a versão de trabalho: **toda tela, componente ou e-mail novo
> deste projeto segue o que está aqui.** Marca/logo/voz: `docs/manual-de-marca.md`. Implementação: `src/public/app.css`.

## Princípios (regras de ouro)

- **Lime é ação.** Um único elemento lime por área: o botão principal, o status "publicado" ou o dado que importa. Nunca decoração.
- **Dados em mono.** Números, datas, horários, contagens e rótulos em JetBrains Mono (caixa alta, tracking largo). Números alinhados à direita em tabelas.
- **Plum é externo.** Plum marca o que o patrocinador e o convidado veem. A equipe trabalha em preto e bone.
- **Serifa só para gente.** Instrument Serif itálico aparece em boas-vindas, frases de convidados e mensagens pessoais. Nunca em controles.
- Sem emoji na interface. Ícones são **Lucide**, traço 2px, 16px no desktop e 20px no mobile (`icon('nome')` em `src/utils/icons.js`).

## Experiência e jornada (regra de criação — vale antes de qualquer tela nova ou alterada)

**O copo fica na cozinha.** Só mostre uma ferramenta quando a pessoa precisa dela, no ponto da jornada em que ela precisa. Ninguém vê o copo no banheiro: só vai à cozinha buscar quando tem sede.

- **Antes de escrever a tela, descreva a jornada** em uma linha: quem é a pessoa, em que momento chega aqui, o que quer fazer e qual é o próximo passo natural. Depois da tela pronta, **abra no navegador (desktop e celular) e percorra essa jornada**; se precisar rolar, ler ou ignorar muita coisa para achar o que quer, a tela não está pronta.
- **Uma ação principal por tela** (o botão lime). O resto é secundário, discreto ou fica escondido.
- **Formulário nunca vem aberto "por via das dúvidas".** O que é de edição eventual (nome, textos, configurações) mostra primeiro o **valor atual, legível**, com um botão **Editar** que abre uma **janela (modal)** só com aqueles campos. Criar algo novo também é um botão + janela.
- **Listas mostram resumo, não formulário por linha.** Cada item: título, dados em mono, status e um botão de editar/ações. Editar abre janela. Nada de uma linha com 5 campos e 2 botões repetida 10 vezes.
- **Muito conteúdo = abas ou seções que abrem** (`data-tabs`, `<details>`): uma coisa por vez (ex.: Ouro | Diamond, e não um embaixo do outro).
- **Condicional pelo momento:** campo ou bloco só aparece quando faz sentido (data preenchida pede confirmação; etapa pede só os dados que faltam; "personalizado" só depois de pedir para personalizar).
- **Ações destrutivas e raras** (excluir, regenerar, reaplicar) ficam pequenas e longe da ação principal, sempre com confirmação.
- **Estado vazio ensina o primeiro passo**; estado preenchido some com a explicação.
- **Teste de contagem:** mais de ~6 campos, ou mais de 2 botões visíveis ao mesmo tempo no mesmo bloco, é sinal para esconder em janela, aba ou condicional.

## Temas

- **Escuro (padrão — equipe e patrocinador)**, **claro (opcional — convidado e relatórios)**. O painel tem botão "Tema" (guarda em `localStorage`, `src/public/theme.js`).
- Tokens do escuro: `bg/base #0A0A0A` (fundo), `bg/surface #121212` (cards, tabelas), `bg/raised #1A1A1A` (hover, item ativo, busca), `border/default #262626`, `border/strong #333333` (campos, botão secundário), `text/primary #FAFAFA`, `text/secondary #B5B5B5`, `text/muted #6B6B6B` (rótulos, metadados), `accent/action #C8FF42`.
- Tokens do claro: `bg/base #F4F2EC`, `bg/surface #FFFFFF`, `bg/raised #E9E5DA`, `border/default #E2DED3`, `border/strong #D6D1C4`, `text/primary #0A0A0A`, `text/secondary #4A4A4A`, `accent/action #0A0A0A` (botão principal preto **com ponto lime**), `accent/external #2D1B4E` (plum).
- No CSS: variáveis `--bg --surface --raised --line --line-strong --text --text-2 --muted --action --on-action --external`. **Nunca escreva cor hexadecimal solta numa view/CSS novo — use o token.**

## Status (chips) — escuro / claro

- **PAUTA**: `#1F1F1F`/`#B5B5B5` · `#E9E5DA`/`#4A4A4A`
- **AGENDADO**: `#241A38`/`#B9A6E8` · `#E9E3F5`/`#2D1B4E`
- **GRAVADO**: `#262626`/`#FAFAFA` · `#0A0A0A`/`#FAFAFA`
- **EM EDIÇÃO**: `#2E2412`/`#FFC266` · `#FBEFD9`/`#7A4E00`
- **PUBLICADO** (único lime): `#2A3311`/`#C8FF42` · `#C8FF42`/`#0A0A0A`
- **CANCELADO**: `#2E1614`/`#FF7A6B` · `#FBE3E0`/`#9E2A1E`
- Chip: raio 2, mono 11px, caixa alta, tracking .12em. Classes `.badge` + `.b-st-*` / `.b-green` (publicado/ativo) / `.b-amber` / `.b-red` / `.b-gray`.
- **Etapas do convidado → chip** (CRM, `src/constants.js`): prospect → PAUTA · convite_enviado → AGENDADO (plum: convidado vê) · em_agendamento → EM EDIÇÃO (âmbar, em andamento) · agendado → AGENDADO (plum: data combinada com o convidado) · gravado → GRAVADO · publicado → PUBLICADO · perdido/cancelado → CANCELADO.

## Tipografia

- **Space Grotesk** (display: títulos, nomes, números grandes, wordmark; tracking −4 a −6%), **Inter** (texto e UI), **JetBrains Mono** (dados), **Instrument Serif itálico** (voz).
- Escala: display 40 · h1 28 · h2 20 · body 14 · label 13 · data 12 (mono) · voz 24 (serifa).
- Fontes **hospedadas no repo** (`src/public/fonts/`, woff2 latin) porque a CSP só aceita recursos `'self'`. Não use Google Fonts/CDN.

## Espaçamento, raios, elevação, movimento

- Base 4: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- Raios: **2** tag/chip · **6** card/tabela · **10** campo · **full** botão.
- Escuro: profundidade = superfície mais clara + borda, **sem sombra**. Claro: sombra única `0 8px 24px rgba(10,10,10,.08)` só em menus e modais.
- Transições 160ms `cubic-bezier(.2,.8,.2,1)`; respeitar `prefers-reduced-motion`. Ponto "ao vivo" pulsa a 1,2s.

## Componentes

- **Botão**: pill (raio full). Primário (lime no escuro / preto + ponto lime no claro), secundário (contorno `border/strong`), fantasma, perigo (vermelho), plum para ação externa. Alturas 32 (`.sm`) · 40 · 48 (`.lg`). Um primário por área.
- **Campo**: raio 10, borda `border/strong`; foco = borda lime + halo 15% (no claro: preto). Rótulo 13px acima, `text/secondary`.
- **Seleção**: checkbox/radio com `accent-color` lime; controle segmentado (Lista | Quadro | Calendário) é `.seg`.
- **Tag/eixo**: mono caixa alta entre colchetes quando for tema (`[ NEGÓCIOS ]`). **Avatar**: círculo; host em plum, convidado em grafite.
- **Métrica**: rótulo mono caixa alta + valor em Space Grotesk 40 + delta mono (▲ lime, ▼ vermelho, neutro muted). `.stat`.
- **Feedback**: `.flash` com filete lateral (lime ok / vermelho erro). Estado vazio: linha de pulso plana + título + frase útil (`partials/pulse-line.ejs`, classe `.empty`).
- **Tabela**: cabeçalho mono caixa alta muted; linha com hover `raised`; colunas de data/número em mono; ações à direita.
- **Menu recolhível**: no computador o botão do topo leva a barra lateral a **76px, só ícones** (nome na dica, "p." no lugar do logo, contadores viram um ponto no canto do ícone); a escolha persiste (`localStorage`). Só a lista de itens rola; rodapé fixo.
- **Painel de gestão**: menu em dois níveis. Em cima, os grupos (`.subnav-groups`: Visão geral · Equipe · Operação · Convites e parcerias · Sistema); embaixo, as abas do grupo como pílulas (`.subnav-inner`), só quando o grupo tem mais de uma. Página nova de gestão entra em um grupo existente em `partials/gestao-nav.ejs`.
- **Navegação**: barra lateral 248px com wordmark "pulso." no topo, itens com ícone Lucide + rótulo, ativo = fundo `raised` + ícone lime; rodapé com avatar/perfil, tema e sair. No mobile vira barra superior com menu.
- **Foto do convidado**: moldura única **4:3** (raio 6), a mesma na página da plateia, no media kit, no portal do patrocinador e no painel (`.guest-photo`, `.cal-photo`, `.confirmed-avatar`). Nada de círculo para foto de convidado; círculo com iniciais só quando não há foto. O envio passa pelo recorte (`cropper.js`), que entrega 1200×900.
- **Calendário geral**: evento = linha de uma linha (ícone Lucide do tipo + hora mono + título); cor só por estado: **gravação** em plum (`--st-agendado-*`), **lembrete** em âmbar, **atrasado** em vermelho, **concluído** apagado e riscado, **a confirmar** em tracejado; o resto, neutro (`raised`). Hoje = o único lime da grade. Os filtros ficam atrás de um botão **Filtros** (contador + resumo) que abre um painel; visualizações = chips arredondados; "Salvar esta visualização" é o chip tracejado. No celular a grade vira lista dos dias com evento.
- **Versão e novidades**: a versão aparece em mono (`v1.1.0`) no rodapé do menu e leva a `/novidades` (cartão por versão, itens com chip Novo/Ajuste/Correção). O aviso "Sistema atualizado" é um cartão pequeno no canto superior direito, uma vez por versão e por pessoa, com X para dispensar.
- **Cadência**: o botão lime "Registrar abordagem" fica no próximo passo (convite enviado / prospecção) e abre uma janela curta (canal em controle segmentado, qual endereço, o que aconteceu, quando, observação). Estado do follow-up em chip (`.outreach-chip`: âmbar = hoje, vermelho = atrasado/possível perdido, neutro = em dia), histórico dentro de `<details>`. Metas e gráficos usam SVG com `rect` (nunca `style=`): o lime só aparece quando a meta é batida. "Hoje" no Início junta follow-ups e meta numa faixa só.
- **Envios em segundo plano**: arquivos grandes sobem por uma fila única (`src/public/uploads.js`, `window.PulsoUploads`) que não depende da página. A **bandeja** (`.upl-tray`, canto inferior direito; no celular, acima do menu) mostra o resumo (arquivos, %, velocidade, tempo) e, aberta, uma linha por arquivo com barra (lime só no andamento), cancelar e tentar de novo; fica vermelha só quando há falha e some sozinha depois que tudo termina. Enquanto há envio ativo, links e formulários abrem num quadro (`iframe.upl-shell`) por cima da página que está enviando, para a navegação não derrubar o upload. A escolha do que enviar é uma **janela de triagem** (`[data-material-dialog]`): seções por tipo (Vídeos, Áudios, Imagens, Outros), rótulo só onde faz sentido, "Todos como…" para decidir em bloco; fotografias e bastidores nunca pedem rótulo.
- **Texto rico e anexos** (`partials/rich-editor.ejs` + `src/public/richtext.js`; tarefas e comentários das tarefas): editor com barra enxuta (negrito, itálico, sublinhado, tachado, título, listas, citação, código, link, tabela, anexar e, nos comentários, microfone), que ocupa o lugar de uma caixa de texto e herda o visual de campo (borda `border/strong`, foco lime). O texto salvo é lido em `.rich-content`; edição é sob demanda (valor atual + botão **Editar**). Imagens ficam no texto; documentos (PDF, HTML, ZIP) em **Anexos**, sempre para baixar; áudio vira player + **Transcrição** (bloco com filete lateral). Link tem duas formas, escolhidas por quem cola: só a URL ou **miniatura** (`.link-card`: imagem, título, resumo e domínio em mono). Tabela: cabeçalho em `raised`, bordas `border/strong`, barra contextual de linhas e colunas só quando o cursor está nela.
- **Quadro (Kanban)**: ocupa a altura da tela; **barra horizontal no pé da tela, grossa e visível**; **cada coluna rola na vertical sozinha**. Coluna = `surface` com chip da etapa + contagem mono; card = `raised`, nome em display, meta em mono 10px.

## Telas de referência (no HTML original)

- A) Painel da equipe (escuro) — saudação "Bom dia, Nome." + semana, KPIs, lista de episódios, próximas gravações, patrocínio ativo.
- B) Gestão de episódios — quadro (claro). C) Portal do patrocinador (escuro + plum). D) Portal do convidado (mobile, claro). E) Produção no estúdio (mobile, escuro).
- Módulos de navegação previstos: Painel · Episódios · Convidados · Gravações · Cortes e distribuição · Métricas · Patrocinadores · Financeiro e contratos · Configurações. **Hoje o sistema implementa Painel, Tarefas, Calendário (tudo que tem data), Convidados, Patrocinadores, Episódios (produção, capas e posts, cortes), Social (publicações, ideias, insights e automações), Financeiro (contas, custos automáticos e estoque) e o Painel de gestão** (Usuários, Auditoria, Integrações); os demais módulos seguem este guia quando forem construídos.

## Checklist ao criar/alterar UI

- **Jornada**: escrevi quem/quando/próximo passo e percorri a tela no navegador (desktop e celular)? Só aparece o que a pessoa precisa agora (copo na cozinha)? Edição eventual está em janela, e não em formulário aberto?
- Usa só tokens do `app.css` e as classes existentes? Dados/datas/contagens em mono? Só um elemento lime na área?
- Lime não virou decoração? Plum só em algo que o externo vê? Serifa só em "voz"?
- Sem emoji; ícone Lucide via `icon()`; estados vazio/erro/foco tratados; funciona no claro e no mobile.
- Texto no tom da marca (ver `docs/manual-de-marca.md`): direto, sem "!!!", sem "imperdível".
- Nada de `<script>`/`style=` inline relevante: a CSP do painel é `'self'` (CSS e JS em `src/public/`).
