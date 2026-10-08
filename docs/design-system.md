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
- **Etapas do convidado → chip** (CRM, `src/constants.js`): prospect → PAUTA · convite_enviado → AGENDADO (plum: convidado vê) · confirmado → GRAVADO · gravado → EM EDIÇÃO (pós-produção) · publicado → PUBLICADO · recusou/cancelado → CANCELADO.

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
- **Navegação**: barra lateral 248px com wordmark "pulso." no topo, itens com ícone Lucide + rótulo, ativo = fundo `raised` + ícone lime; rodapé com avatar/perfil, tema e sair. No mobile vira barra superior com menu.
- **Quadro (Kanban)**: coluna = `surface` com chip da etapa + contagem mono; card = `raised`, nome em display, meta em mono 10px.

## Telas de referência (no HTML original)

- A) Painel da equipe (escuro) — saudação "Bom dia, Nome." + semana, KPIs, lista de episódios, próximas gravações, patrocínio ativo.
- B) Gestão de episódios — quadro (claro). C) Portal do patrocinador (escuro + plum). D) Portal do convidado (mobile, claro). E) Produção no estúdio (mobile, escuro).
- Módulos de navegação previstos: Painel · Episódios · Convidados · Gravações · Cortes e distribuição · Métricas · Patrocinadores · Financeiro e contratos · Configurações. **Hoje o sistema implementa só Painel, Convidados, Modelos de convite e a área "Sistema"** (Usuários, Auditoria, Integrações); os demais módulos seguem este guia quando forem construídos.

## Checklist ao criar/alterar UI

- Usa só tokens do `app.css` e as classes existentes? Dados/datas/contagens em mono? Só um elemento lime na área?
- Lime não virou decoração? Plum só em algo que o externo vê? Serifa só em "voz"?
- Sem emoji; ícone Lucide via `icon()`; estados vazio/erro/foco tratados; funciona no claro e no mobile.
- Texto no tom da marca (ver `docs/manual-de-marca.md`): direto, sem "!!!", sem "imperdível".
- Nada de `<script>`/`style=` inline relevante: a CSP do painel é `'self'` (CSS e JS em `src/public/`).
