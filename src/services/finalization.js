// Finalização assistida por IA. Núcleo (sem banco): transcrição, escolha de quadros, leitura dos quadros e sugestões de
// títulos/descrições/thumbnails/capítulos, SEMPRE validadas contra os limites das plataformas (platformLimits).
const fs = require('fs');
const path = require('path');
const media = require('./media');
const groq = require('./groq');
const gemini = require('./gemini');
const L = require('./platformLimits');

const MARCA = [
  'Você escreve para o Pulso, um podcast de saúde, inovação, empreendedorismo e negócios ("As conversas que estão movimentando a saúde").',
  'Tom de voz da marca: direto, elegante, sério sem ser frio, jovem sem gíria. Frases curtas. Sem "imperdível", sem "corre", sem exclamações em sequência, sem urgência falsa, sem superlativo vazio ("o maior", "o melhor do Brasil"), sem promessas de cura ou de resultado.',
  'Escreva em português do Brasil, com acentuação correta. Não use emojis. Não invente fatos: só use o que está na transcrição e nos dados fornecidos.',
].join('\n');

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// ---------------------------------------------------------------- transcrição
async function transcribeVideo(videoPath, dir, { onProgress } = {}) {
  const chunks = await media.extractAudioChunks(videoPath, dir, 1200);
  if (!chunks.length) throw new Error('O vídeo não tem áudio para transcrever.');
  const segments = [];
  let durationMs = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    onProgress?.(`Transcrevendo o áudio (${i + 1}/${chunks.length})…`);
    const t = await groq.transcribe(fs.readFileSync(c.file), { filename: path.basename(c.file), contentType: 'audio/ogg', verbose: true });
    for (const s of t.segments) segments.push({ start_ms: s.start_ms + c.offset_ms, end_ms: s.end_ms + c.offset_ms, text: s.text });
    durationMs = Math.max(durationMs, c.offset_ms + t.duration_ms);
  }
  return { text: segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(), segments, duration_ms: durationMs };
}

// "[12:34] frase" por trecho: dá ao modelo os tempos para montar capítulos e achar momentos.
function transcriptForPrompt(segments) {
  return segments.map((s) => `[${L.toClock(s.start_ms)}] ${s.text}`).join('\n');
}

// ---------------------------------------------------------------- quadros
// n quadros espalhados pelo vídeo (evita a abertura e o final). Devolve [{ at_ms, file, small }].
async function pickFrames(videoPath, durationMs, dir, { count } = {}) {
  const n = count || clamp(Math.ceil(durationMs / 1000 / 20), 8, 24);
  const frames = [];
  for (let i = 0; i < n; i += 1) {
    const at = Math.round(((i + 0.5) / n) * durationMs);
    const file = path.join(dir, `frame_${String(i).padStart(3, '0')}.jpg`);
    const small = path.join(dir, `small_${String(i).padStart(3, '0')}.jpg`);
    await media.extractFrame(videoPath, at, file, { maxSide: 1920, quality: 3 });
    await media.extractFrame(videoPath, at, small, { maxSide: 768, quality: 5 });
    const probe = await media.probe(file);
    frames.push({ at_ms: at, file, small, width: probe.width, height: probe.height });
  }
  return frames;
}

const FRAME_SCHEMA = {
  type: 'OBJECT',
  properties: {
    quadros: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          indice: { type: 'INTEGER' },
          rostos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, w: { type: 'NUMBER' }, h: { type: 'NUMBER' } }, required: ['x', 'y', 'w', 'h'] } },
          olhos_abertos: { type: 'BOOLEAN' },
          expressao: { type: 'STRING' },
          nitidez: { type: 'NUMBER' },
          luz: { type: 'NUMBER' },
          texto_queimado: { type: 'BOOLEAN' },
          caixas_de_texto: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, w: { type: 'NUMBER' }, h: { type: 'NUMBER' } }, required: ['x', 'y', 'w', 'h'] } },
          nota_thumbnail: { type: 'NUMBER' },
          observacao: { type: 'STRING' },
        },
        required: ['indice', 'rostos', 'olhos_abertos', 'expressao', 'nitidez', 'luz', 'texto_queimado', 'caixas_de_texto', 'nota_thumbnail'],
      },
    },
  },
  required: ['quadros'],
};

// O modelo às vezes responde em 0–1 e às vezes em 0–1000 (a escala nativa do Gemini para caixas). Leva tudo para 0–1, descarta caixa
// sem sentido e mantém tudo dentro do quadro. Valores acima de 1000 são tratados como pixels.
function normalizeBoxes(boxes, { width, height } = {}) {
  const list = (boxes || []).map((b) => ({ x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h) })).filter((b) => [b.x, b.y, b.w, b.h].every(Number.isFinite));
  if (!list.length) return [];
  const maxV = Math.max(...list.flatMap((b) => [b.x + b.w, b.y + b.h]));
  let divX = 1; let divY = 1;
  if (maxV > 1000.5 && width && height) { divX = width; divY = height; } else if (maxV > 1.05) { divX = 1000; divY = 1000; }
  return list.map((b) => ({ x: b.x / divX, y: b.y / divY, w: b.w / divX, h: b.h / divY }))
    .map((b) => ({ x: Math.max(0, Math.min(1, b.x)), y: Math.max(0, Math.min(1, b.y)), w: Math.min(b.w, 1 - Math.max(0, b.x)), h: Math.min(b.h, 1 - Math.max(0, b.y)) }))
    .filter((b) => b.w > 0.005 && b.h > 0.005);
}

// Lê os quadros com visão computacional: onde estão os rostos e o texto queimado (legendas), nitidez, expressão e nota.
// Coordenadas normalizadas (0 a 1, origem no canto superior esquerdo).
async function analyzeFrames(frames, { onProgress, attempts, timeoutMs } = {}) {
  const out = new Array(frames.length).fill(null);
  const BATCH = 8;
  for (let start = 0; start < frames.length; start += BATCH) {
    const batch = frames.slice(start, start + BATCH);
    onProgress?.(`Analisando quadros (${Math.min(start + BATCH, frames.length)}/${frames.length})…`);
    const parts = [{ text: [
      'Você analisa quadros de vídeo de um podcast para escolher a melhor capa. Para CADA quadro (na ordem em que aparecem, com o índice indicado) devolva:',
      '- rostos: caixa de cada rosto humano visível (x, y = canto superior esquerdo; w, h = largura e altura; tudo de 0 a 1 relativo ao quadro). Inclua o cabelo e a testa na caixa.',
      '- olhos_abertos: true se as pessoas principais estão de olhos abertos (não no meio de uma piscada).',
      '- expressao: uma palavra (falando, sorrindo, sério, pensativo, rindo, olhando-de-lado, de-olhos-fechados).',
      '- nitidez e luz: de 0 a 10 (10 = nítido / bem iluminado).',
      '- texto_queimado: true se há legendas ou texto gravado na imagem (não conte logotipos de cenário); caixas_de_texto: onde estão (mesma convenção).',
      '- nota_thumbnail: de 0 a 10 — rosto grande e legível, olhos abertos, expressão com emoção, boa luz, sem legenda por cima do rosto, sem mãos cobrindo a boca.',
      '- observacao: no máximo 12 palavras.',
    ].join('\n') }];
    batch.forEach((f, i) => {
      parts.push({ text: `Quadro índice ${start + i} (${L.toClock(f.at_ms)}):` });
      parts.push(gemini.imagePart(fs.readFileSync(f.small)));
    });
    const { data } = await gemini.generateJson({ parts, schema: FRAME_SCHEMA, temperature: 0.1, thinking: 'low', ...(attempts ? { attempts } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
    for (const q of data.quadros || []) {
      const idx = Number(q.indice);
      if (Number.isInteger(idx) && idx >= start && idx < start + batch.length) {
        const f = frames[idx];
        out[idx] = { ...q, rostos: normalizeBoxes(q.rostos, f), caixas_de_texto: normalizeBoxes(q.caixas_de_texto, f) };
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- sugestões de texto
const SUGGEST_SCHEMA = {
  type: 'OBJECT',
  properties: {
    resumo: { type: 'STRING' },
    temas: { type: 'ARRAY', items: { type: 'STRING' } },
    titulos_youtube: { type: 'ARRAY', items: { type: 'OBJECT', properties: { texto: { type: 'STRING' }, angulo: { type: 'STRING' } }, required: ['texto', 'angulo'] } },
    textos_thumbnail: { type: 'ARRAY', items: { type: 'OBJECT', properties: { texto: { type: 'STRING' }, angulo: { type: 'STRING' } }, required: ['texto', 'angulo'] } },
    titulo_spotify: { type: 'STRING' },
    abertura_youtube: { type: 'STRING' },
    topicos: { type: 'ARRAY', items: { type: 'STRING' } },
    sobre_convidado: { type: 'STRING' },
    abertura_spotify: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    hashtags: { type: 'ARRAY', items: { type: 'STRING' } },
    capitulos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { inicio: { type: 'STRING' }, titulo: { type: 'STRING' } }, required: ['inicio', 'titulo'] } },
    citacoes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { frase: { type: 'STRING' }, inicio: { type: 'STRING' }, quem: { type: 'STRING' } }, required: ['frase', 'inicio', 'quem'] } },
    momentos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { inicio: { type: 'STRING' }, fim: { type: 'STRING' }, titulo: { type: 'STRING' }, motivo: { type: 'STRING' } }, required: ['inicio', 'fim', 'titulo', 'motivo'] } },
  },
  required: ['resumo', 'titulos_youtube', 'textos_thumbnail', 'titulo_spotify', 'abertura_youtube', 'topicos', 'sobre_convidado', 'abertura_spotify', 'tags', 'hashtags', 'capitulos', 'citacoes', 'momentos'],
};

const L2 = L.LIMITS;
function instructions(durationMs) {
  const long = durationMs > 8 * 60_000;
  return [
    `Duração do vídeo: ${L.toClock(durationMs)}. Os tempos [mm:ss] da transcrição são reais: use-os para capítulos, citações e momentos.`,
    '',
    'ENTREGUE (JSON):',
    `1. titulos_youtube: EXATAMENTE 3 títulos, cada um com ângulo diferente (1: tema ou benefício direto; 2: afirmação forte do convidado, fiel ao que ele disse; 3: pergunta ou curiosidade honesta). Cada um com no máximo ${L2.youtube.title.ideal} caracteres (limite duro do YouTube: ${L2.youtube.title.max}). Palavras mais importantes no começo. Inclua o nome do convidado em pelo menos um. Seja concreto, não genérico: evite "na prática", "tudo o que você precisa saber", "os segredos de", "o poder de". Nada de CAIXA ALTA, nada de clickbait que a conversa não cumpra, sem os sinais < >.`,
    `2. textos_thumbnail: EXATAMENTE 3 textos para a thumbnail: de 2 a 4 palavras, no máximo ${L2.thumbnailText.maxChars - 4} caracteres, que gerem curiosidade e se leiam no celular em 1 segundo. Não repita o título; complemente-o. Ângulos diferentes entre si. PREFIRA um trecho curto que o convidado realmente disse (ex.: "Sem ego, sem vaidade"), uma tensão ("Prazo pra sair do cargo") ou uma pergunta; NUNCA um rótulo genérico como "Liderança" ou "Governança" sozinho. O texto precisa fazer sentido sozinho, sem o título ao lado.`,
    `3. titulo_spotify: 1 título (até ${L2.spotify.title.ideal} caracteres), claro e pesquisável, com o tema e o nome do convidado.`,
    `4. Descrição do YouTube, em PARTES (a montagem final é nossa): abertura_youtube = 1 a 2 frases, até ${L2.youtube.hook} caracteres no total, que façam sentido sozinhas (só elas aparecem antes de "mostrar mais") e usem palavras que as pessoas buscariam; topicos = de 3 a 5 tópicos curtos do que é abordado, sem "- " no começo, sem ponto final; sobre_convidado = 1 parágrafo sobre quem é o convidado, usando apenas os dados fornecidos. NÃO cite patrocinadores nem escreva "Patrocínio" ou "Apoio" (há um bloco próprio). Sem os sinais < >.`,
    `5. abertura_spotify: 2 a 4 frases em texto simples para o aplicativo de áudio, sem HTML, no máximo 900 caracteres. Os primeiros ${L2.spotify.hook} caracteres precisam funcionar como gancho.`,
    `6. tags: de 8 a 14 palavras-chave para o YouTube (sem #), da mais importante para a menos.`,
    `7. hashtags: exatamente 3 (com #), curtas, sem acento nem espaço, relevantes.`,
    `8. capitulos: ${long ? 'de 6 a 14' : 'de 3 a 5'} capítulos com tempo real da conversa. O primeiro começa em 0:00. Cada um com pelo menos 10 segundos de distância do anterior, em ordem. Título com no máximo ${L2.spotify.chapters.titleMax - 5} caracteres, descritivo (não "Parte 2").`,
    '9. citacoes: de 4 a 8 frases FORTES ditas por pessoas na conversa, copiadas da transcrição SEM mudar o sentido nem inventar palavras (pode tirar muletas de fala como "então", "né", "aí", "tá" e corrigir pontuação), com 6 a 22 palavras cada, que funcionem sozinhas fora de contexto e soem bem escritas. Descarte frases que dependam de "isso", "aqui" ou "lá" sem referência. "inicio" é o tempo em que a frase começa. "quem" é o nome de quem falou, se der para saber, senão "".',
    '10. momentos: de 3 a 8 trechos que dariam bons cortes verticais de 20 a 90 segundos: começam com um gancho e terminam numa ideia completa (sem cortar frase no meio). Informe inicio e fim reais, um título curto e o motivo.',
    '11. resumo: 3 a 4 frases do que a conversa trata, para uso interno.',
    '12. temas: 3 a 6 temas centrais, em poucas palavras.',
  ].join('\n');
}

function buildContext({ episode, guest, sponsors }) {
  const lines = [`Podcast: Pulso. Episódio: ${episode.number ? `EP.${String(episode.number).padStart(3, '0')} — ` : ''}${episode.title}`];
  if (guest) {
    lines.push(`Convidado(a): ${guest.name}${guest.instagram ? ` (@${guest.instagram})` : ''}`);
    if (guest.positioning) lines.push(`Posicionamento: ${guest.positioning}`);
    if (guest.bio) lines.push(`Biografia: ${guest.bio}`);
    if (guest.topic) lines.push(`Temas combinados: ${guest.topic}`);
  }
  if (sponsors?.length) {
    lines.push(`Patrocinadores deste episódio: ${sponsors.map((s) => s.company).join(', ')}. NÃO invente falas de patrocinador e NÃO os cite nos títulos; eles entram na descrição por um bloco próprio.`);
    const restrict = sponsors.filter((s) => s.restrictions).map((s) => `${s.company}: ${s.restrictions}`);
    if (restrict.length) lines.push(`Restrições de comunicação (respeite): ${restrict.join(' | ')}`);
  }
  if (episode.editor_notes) lines.push(`Observações da equipe: ${episode.editor_notes}`);
  return lines.join('\n');
}

// A IA às vezes escreve "Patrocínio: …" por conta própria; esse bloco é nosso (deterministic), então o dela sai.
const dropSponsorLines = (s) => String(s ?? '').split('\n').filter((l) => !/^\s*(patroc[ií]nio|apoio|patrocinador(es)?)\b/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n');
const stripEmoji = (s) => String(s ?? '').replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/ {2,}/g, ' ');

// Tempo "mm:ss" ou "h:mm:ss" do modelo -> ms (tolera "1:05" e "01:05:00").
const parseTime = (t) => L.parseClock(String(t ?? '').replace(/[^\d:]/g, '').replace(/^:+|:+$/g, ''));

// Valida e ajusta tudo o que a IA devolveu. Devolve { suggestions, issues } — issues = o que ainda ficou fora das regras.
function normalizeSuggestions(raw, { durationMs, episode, guest, sponsors }) {
  const issues = [];
  const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.texto.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };

  // títulos do YouTube
  let titles = uniq((raw.titulos_youtube || []).map((t) => ({
    texto: L.fitWords(L.balanceQuotes(L.stripAngles(stripEmoji(t.texto))), L2.youtube.title.max), angulo: L.tidy(t.angulo || ''),
  })).filter((t) => t.texto));
  titles = titles.map((t) => ({ ...t, check: L.checkYoutubeTitle(t.texto) }));
  if (titles.length < 3) issues.push(`A IA devolveu ${titles.length} título(s) do YouTube em vez de 3.`);

  // textos da thumbnail
  let thumbs = uniq((raw.textos_thumbnail || []).map((t) => ({
    texto: L.fitWords(L.balanceQuotes(stripEmoji(t.texto)).replace(/[.!]+$/g, ''), L2.thumbnailText.maxChars), angulo: L.tidy(t.angulo || ''),
  })).filter((t) => t.texto));
  thumbs = thumbs.map((t) => ({ ...t, lines: L.thumbnailLines(t.texto) }));
  if (thumbs.length < 3) issues.push(`A IA devolveu ${thumbs.length} texto(s) de thumbnail em vez de 3.`);
  const badThumbs = thumbs.filter((t) => !t.lines.ok);
  if (badThumbs.length) issues.push(`Texto de thumbnail fora do padrão: ${badThumbs.map((t) => `“${t.texto}” (${t.lines.issues.join(' ')})`).join(' | ')}`);

  // capítulos
  const chapters = [];
  for (const c of raw.capitulos || []) {
    const at = parseTime(c.inicio);
    const title = L.fitWords(L.balanceQuotes(stripEmoji(c.titulo)), L2.spotify.chapters.titleMax - 1);
    if (at == null || !title) continue;
    if (durationMs && at >= durationMs - 5000) continue;
    chapters.push({ at_ms: at, title });
  }
  chapters.sort((a, b) => a.at_ms - b.at_ms);
  const cleanChapters = [];
  for (const c of chapters) {
    if (!cleanChapters.length) { cleanChapters.push({ at_ms: 0, title: c.title }); continue; } // o primeiro sempre em 0:00
    if (c.at_ms - cleanChapters[cleanChapters.length - 1].at_ms >= 10_000) cleanChapters.push(c);
  }
  const chaptersText = L.formatChapters(cleanChapters);
  const chapterCheck = L.parseChapters(chaptersText, { durationMs });
  const chaptersUsable = chapterCheck.issues.length === 0;
  if (!chaptersUsable && durationMs > 3 * 60_000) issues.push(`Capítulos: ${chapterCheck.issues.join(' ')}`);

  // blocos fixos (não são escritos pela IA, para não inventar nada)
  const sponsorLines = (sponsors || []).map((s) => `Apoio: ${s.company}${s.landing_url ? ` — ${s.landing_url}` : (s.website ? ` — ${s.website}` : '')}`);
  const guestLine = guest ? `Convidado: ${guest.name}${guest.instagram ? ` (@${guest.instagram})` : ''}` : '';
  const hashtags = (raw.hashtags || []).map((h) => `#${String(h).replace(/[^\p{L}\p{N}_]/gu, '')}`).filter((h) => h.length > 1).slice(0, L2.youtube.hashtagsShown);
  const hashLine = [...new Set(hashtags)].join(' ');

  // descrição do YouTube: partes da IA + blocos fixos, cabendo em 5000 bytes (a estrutura é nossa, não do modelo)
  const clean = (s) => L.stripAngles(stripEmoji(dropSponsorLines(s)));
  const tail = [chaptersUsable ? `Capítulos\n${chaptersText}` : '', [guestLine, ...sponsorLines].filter(Boolean).join('\n'), hashLine].filter(Boolean).join('\n\n');
  const topics = (raw.topicos || []).map((t) => L.fitWords(clean(t).replace(/^[-•*\s]+/, '').replace(/[.;]+$/, ''), 140)).filter(Boolean).slice(0, 6);
  const opening = L.fitWords(clean(raw.abertura_youtube), 600);
  const about = L.fitWords(clean(raw.sobre_convidado), 900);
  const parts = [opening, topics.length ? `Neste episódio:\n${topics.map((t) => `- ${t}`).join('\n')}` : '', about];
  const budget = L2.youtube.descriptionSafe - L.utf8(`\n\n${tail}`);
  const body = L.fitBytes(parts.filter(Boolean).join('\n\n'), Math.max(300, budget));
  const ytDescription = L.tidy(`${body}\n\n${tail}`);

  // Spotify
  const spTail = [chaptersUsable ? `Capítulos\n${chaptersText}` : '', [guestLine, ...sponsorLines].filter(Boolean).join('\n')].filter(Boolean).join('\n\n');
  const spBody = truncateAtSentence(clean(raw.abertura_spotify), Math.max(300, L2.spotify.description - spTail.length - 4));
  const spDescription = L.tidy(`${spBody}\n\n${spTail}`);
  const spTitle = L.fitWords(L.balanceQuotes(stripEmoji(raw.titulo_spotify)), L2.spotify.title.max);

  const tags = L.fitTags(raw.tags || []);

  // citações e momentos (para os posts e cortes da fase 3 e 4)
  const quotes = (raw.citacoes || []).map((q) => ({ frase: L.tidy(q.frase), at_ms: parseTime(q.inicio), quem: L.tidy(q.quem || '') }))
    .filter((q) => q.frase.split(/\s+/).length >= 4 && q.frase.length <= 220 && (q.at_ms == null || !durationMs || q.at_ms < durationMs));
  const moments = (raw.momentos || []).map((m) => ({ start_ms: parseTime(m.inicio), end_ms: parseTime(m.fim), titulo: L.fitWords(stripEmoji(m.titulo), 60), motivo: L.tidy(m.motivo) }))
    .filter((m) => m.start_ms != null && m.end_ms != null && m.end_ms - m.start_ms >= 8000 && (!durationMs || m.end_ms <= durationMs + 1000));

  const yd = L.checkYoutubeDescription(ytDescription);
  if (!yd.ok) issues.push(`Descrição do YouTube: ${yd.issues.join(' ')}`);
  const sd = L.checkSpotifyDescription(spDescription);
  if (!sd.ok) issues.push(`Descrição do Spotify: ${sd.issues.join(' ')}`);

  return {
    suggestions: {
      resumo: L.tidy(raw.resumo), temas: (raw.temas || []).map(L.tidy).filter(Boolean),
      youtube_titles: titles, thumbnail_texts: thumbs, spotify_title: spTitle,
      youtube_description: ytDescription, spotify_description: spDescription, tags, hashtags, chapters: cleanChapters, quotes, moments,
      checks: { youtube_description: yd, spotify_description: sd, spotify_title: L.checkSpotifyTitle(spTitle) },
    },
    issues,
  };
}

function truncateAtSentence(text, max) {
  const s = L.tidy(text);
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return (end > max * 0.4 ? cut.slice(0, end + 1) : L.fitWords(cut, max)).trim();
}

// Gera as sugestões a partir da transcrição. Se algo sair das regras, pede UMA correção ao modelo com o que errou.
async function suggestMetadata({ episode, guest, sponsors, transcript, durationMs, onProgress }) {
  const system = `${MARCA}`;
  const prompt = `${buildContext({ episode, guest, sponsors })}\n\n${instructions(durationMs)}\n\nTRANSCRIÇÃO:\n${transcriptForPrompt(transcript.segments)}`;
  onProgress?.('Escrevendo títulos, descrições e capítulos…');
  const first = await gemini.generateJson({ system, parts: [{ text: prompt }], schema: SUGGEST_SCHEMA, temperature: 0.8 });
  let result = normalizeSuggestions(first.data, { durationMs, episode, guest, sponsors });
  let attempts = 1;
  if (result.issues.length) {
    onProgress?.('Ajustando o que passou dos limites…');
    const fix = `${prompt}\n\nSUA RESPOSTA ANTERIOR TEVE PROBLEMAS. Corrija e devolva o JSON completo de novo:\n- ${result.issues.join('\n- ')}`;
    const second = await gemini.generateJson({ system, parts: [{ text: fix }], schema: SUGGEST_SCHEMA, temperature: 0.5 });
    const again = normalizeSuggestions(second.data, { durationMs, episode, guest, sponsors });
    attempts = 2;
    if (again.issues.length <= result.issues.length) result = again;
  }
  return { ...result, model: first.model, attempts, usage: first.usage };
}

// ---------------------------------------------------------------- escolha do quadro para a thumbnail
// Pontuação final: nota da IA, penaliza legenda queimada e olho fechado; recompensa rosto grande.
function scoreFrame(a) {
  if (!a) return 0;
  const faces = a.rostos || [];
  const biggest = faces.reduce((m, f) => Math.max(m, f.w * f.h), 0);
  let s = Number(a.nota_thumbnail || 0);
  s += (Number(a.nitidez || 0) + Number(a.luz || 0)) / 10;
  s += Math.min(2, biggest * 12);
  if (a.texto_queimado) s -= 3;
  if (a.olhos_abertos === false) s -= 3;
  if (!faces.length) s -= 4;
  return Math.round(s * 100) / 100;
}

module.exports = {
  MARCA, normalizeBoxes, transcribeVideo, transcriptForPrompt, pickFrames, analyzeFrames, suggestMetadata, normalizeSuggestions, scoreFrame, parseTime, stripEmoji, buildContext,
};
