// Limites e boas práticas de cada plataforma, e funções para validar e ajustar texto SEM estourar nem quebrar palavra.
// Onde a documentação oficial é omissa ou as fontes divergem, o valor aqui é o CONSERVADOR (nunca acima do real).
//  - YouTube: título 100 caracteres; descrição 5000 bytes; tags 500 caracteres no total; thumbnail 1280×720, até 2 MB; sem < nem >.
//  - Instagram e TikTok: legenda 2200 caracteres (via API/agendador); só ~125 aparecem antes do "mais".
//  - Spotify: sem limite público firme; usamos 100 (título) e 3500 (descrição); capítulos: ≥3, o primeiro em 0:00, título < 40.
const LIMITS = {
  youtube: {
    title: { max: 100, ideal: 70 },
    descriptionBytes: 5000,
    descriptionSafe: 4700,      // folga para o que o YouTube conta diferente
    hook: 150,                  // o que aparece antes do "mostrar mais"
    tagsChars: 500,
    hashtagsShown: 3,
    thumbnail: { width: 1280, height: 720, maxBytes: 2 * 1024 * 1024 },
  },
  shorts: { title: { max: 100, ideal: 60 } },
  spotify: { title: { max: 100, ideal: 80 }, description: 3500, hook: 90, chapters: { min: 3, titleMax: 40 } },
  instagram: { caption: 2200, hashtags: 30, visible: 125 },
  tiktok: { caption: 2200, visible: 125, hashtagsIdeal: 5 },
  // Texto na thumbnail: curto o bastante para ler no celular.
  thumbnailText: { maxChars: 28, maxWords: 5, maxLines: 2, perLine: 16 },
};

const utf8 = (s) => Buffer.byteLength(String(s ?? ''), 'utf8');
const tidy = (s) => String(s ?? '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const stripAngles = (s) => String(s ?? '').replace(/[<>]/g, '');

// Palavras que não podem ficar sozinhas no fim de um título cortado.
const DANGLING = new Set(['a', 'o', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'e', 'ou', 'que', 'por', 'para', 'pra', 'com', 'sem', 'ao', 'à', 'se', 'sua', 'seu', 'como']);

// Aspas e parênteses que abrem e não fecham (ou o contrário) ficam feios e mudam o sentido: se não fecham, saem todos.
function balanceQuotes(text) {
  let s = String(text ?? '');
  const straight = (s.match(/"/g) || []).length;
  if (straight % 2) s = s.replace(/"/g, '');
  const open = (s.match(/“/g) || []).length; const close = (s.match(/”/g) || []).length;
  if (open !== close) s = s.replace(/[“”]/g, '');
  const lp = (s.match(/\(/g) || []).length; const rp = (s.match(/\)/g) || []).length;
  if (lp !== rp) s = s.replace(/[()]/g, '');
  return s.replace(/ {2,}/g, ' ').trim();
}

// Corta em fronteira de palavra (nunca no meio) e sem deixar pontuação ou artigo pendurado no fim.
function fitWords(text, max) {
  let s = tidy(text).replace(/\n+/g, ' ');
  if (s.length <= max) return s;
  s = s.slice(0, max + 1);
  const cut = s.lastIndexOf(' ');
  s = (cut > max * 0.5 ? s.slice(0, cut) : s.slice(0, max)).trim();
  for (;;) {
    const m = s.match(/^(.*?)[\s,;:\-–—]*\s+(\S+)$/);
    s = s.replace(/[\s,;:\-–—(\["“]+$/, '');
    const last = s.split(' ').pop().toLowerCase().replace(/[^\p{L}]/gu, '');
    if (m && DANGLING.has(last)) s = s.slice(0, s.lastIndexOf(' ')).trim(); else break;
  }
  return s;
}

// Corta um texto longo em fronteira de parágrafo/linha/frase para caber em `maxBytes` (UTF-8).
function fitBytes(text, maxBytes) {
  let s = tidy(text);
  if (utf8(s) <= maxBytes) return s;
  while (utf8(s) > maxBytes) {
    const cutAt = Math.max(s.lastIndexOf('\n'), s.lastIndexOf('. '));
    if (cutAt < s.length * 0.3) { s = s.slice(0, Math.floor(s.length * 0.9)); continue; }
    s = s.slice(0, cutAt + (s[cutAt] === '.' ? 1 : 0)).trim();
  }
  return s;
}

function capsRatio(s) {
  const letters = String(s).match(/\p{L}/gu) || [];
  if (letters.length < 8) return 0;
  return letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / letters.length;
}

// Resultado comum: { ok, length, bytes, max, issues[] (impedem), warnings[] (avisos) }
function check(text, { max, maxBytes, ideal, noAngles = false, label = 'Texto' }) {
  const s = String(text ?? '');
  const issues = [];
  const warnings = [];
  if (!s.trim()) issues.push(`${label} vazio.`);
  if (max && s.length > max) issues.push(`${label} passa de ${max} caracteres (${s.length}).`);
  if (maxBytes && utf8(s) > maxBytes) issues.push(`${label} passa de ${maxBytes} bytes (${utf8(s)}).`);
  if (noAngles && /[<>]/.test(s)) issues.push(`${label} não pode ter os sinais < ou >.`);
  if (ideal && s.length > ideal) warnings.push(`${label} acima de ${ideal} caracteres pode ser cortado nos resultados.`);
  if (capsRatio(s) > 0.6) warnings.push(`${label} está quase todo em maiúsculas.`);
  if (/!{2,}|\?{3,}/.test(s)) warnings.push(`${label} com exclamações repetidas foge do tom da marca.`);
  return { ok: issues.length === 0, length: s.length, bytes: utf8(s), max: max || null, maxBytes: maxBytes || null, issues, warnings };
}

const checkYoutubeTitle = (t) => check(t, { max: LIMITS.youtube.title.max, ideal: LIMITS.youtube.title.ideal, noAngles: true, label: 'O título' });
const checkYoutubeDescription = (t) => check(t, { maxBytes: LIMITS.youtube.descriptionBytes, noAngles: true, label: 'A descrição' });
const checkSpotifyTitle = (t) => check(t, { max: LIMITS.spotify.title.max, ideal: LIMITS.spotify.title.ideal, label: 'O título' });
const checkSpotifyDescription = (t) => check(t, { max: LIMITS.spotify.description, label: 'A descrição' });
const checkInstagramCaption = (t) => {
  const r = check(t, { max: LIMITS.instagram.caption, label: 'A legenda' });
  if (hashtagsIn(t).length > LIMITS.instagram.hashtags) r.issues.push(`A legenda passa de ${LIMITS.instagram.hashtags} hashtags.`);
  r.ok = r.issues.length === 0;
  return r;
};
const checkTiktokCaption = (t) => check(t, { max: LIMITS.tiktok.caption, label: 'A legenda' });

const hashtagsIn = (s) => String(s ?? '').match(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+/gu) || [];

// Tags do YouTube: limpa, remove repetidas e corta para somar no máximo 500 caracteres (vírgulas contam).
function fitTags(tags, maxChars = LIMITS.youtube.tagsChars) {
  const seen = new Set();
  const out = [];
  let total = 0;
  for (const raw of tags || []) {
    const t = stripAngles(tidy(raw)).replace(/^#/, '').replace(/,/g, ' ').trim();
    const k = t.toLowerCase();
    if (!t || t.length > 60 || seen.has(k)) continue;
    const cost = t.length + (out.length ? 1 : 0) + (/\s/.test(t) ? 2 : 0); // tag com espaço ganha aspas na contagem do YouTube
    if (total + cost > maxChars) continue;
    seen.add(k); out.push(t); total += cost;
  }
  return out;
}

// Quebra o texto da thumbnail em até 2 linhas equilibradas, sem partir palavra. { lines, ok, issues }
function thumbnailLines(text, { perLine = LIMITS.thumbnailText.perLine, maxLines = LIMITS.thumbnailText.maxLines } = {}) {
  const words = tidy(text).replace(/\n+/g, ' ').split(' ').filter(Boolean);
  const issues = [];
  if (!words.length) return { lines: [], ok: false, issues: ['Texto vazio.'] };
  if (words.length > LIMITS.thumbnailText.maxWords) issues.push(`Mais de ${LIMITS.thumbnailText.maxWords} palavras fica pequeno no celular.`);
  if (words.some((w) => w.length > perLine)) issues.push(`Há uma palavra com mais de ${perLine} letras.`);
  let best = null;
  for (let split = 1; split <= words.length; split += 1) { // 1 linha (split=n) ou 2 linhas
    const lines = split === words.length ? [words.join(' ')] : [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    if (lines.length > maxLines) continue;
    const longest = Math.max(...lines.map((l) => l.length));
    const score = longest + (lines.length > 1 ? Math.abs(lines[0].length - lines[1].length) * 0.3 : 0);
    if (!best || score < best.score) best = { lines, longest, score };
  }
  if (best.longest > perLine) issues.push(`Uma linha ficou com ${best.longest} letras (o ideal é até ${perLine}).`);
  if (words.join(' ').length > LIMITS.thumbnailText.maxChars) issues.push(`Passa de ${LIMITS.thumbnailText.maxChars} caracteres.`);
  return { lines: best.lines, ok: issues.length === 0, issues };
}

// ---- capítulos ("0:00 Título", um por linha) ----
const toClock = (ms) => {
  const t = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const parseClock = (str) => {
  const m = String(str).trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return ((Number(m[1] || 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
};

// Lê as linhas, valida (primeiro em 0:00, ordem crescente, ≥3, espaçados ≥10 s, título curto) e devolve { chapters, issues }.
function parseChapters(text, { durationMs = null, titleMax = LIMITS.spotify.chapters.titleMax } = {}) {
  const issues = [];
  const chapters = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = line.trim().match(/^(\d{1,2}(?::\d{2}){1,2})\s+(.+)$/);
    if (!m) continue;
    const at = parseClock(m[1]);
    if (at == null) continue;
    chapters.push({ at_ms: at, title: tidy(m[2]) });
  }
  if (chapters.length < LIMITS.spotify.chapters.min) issues.push(`São precisos ao menos ${LIMITS.spotify.chapters.min} capítulos.`);
  if (chapters.length && chapters[0].at_ms !== 0) issues.push('O primeiro capítulo precisa começar em 0:00.');
  for (let i = 1; i < chapters.length; i += 1) {
    if (chapters[i].at_ms <= chapters[i - 1].at_ms) { issues.push('Os capítulos precisam estar em ordem crescente.'); break; }
    if (chapters[i].at_ms - chapters[i - 1].at_ms < 10_000) { issues.push('Cada capítulo precisa durar pelo menos 10 segundos.'); break; }
  }
  if (durationMs && chapters.some((c) => c.at_ms >= durationMs)) issues.push('Há capítulo depois do fim do vídeo.');
  for (const c of chapters) if (c.title.length > titleMax) { issues.push(`Título de capítulo acima de ${titleMax} caracteres: “${c.title}”.`); break; }
  return { chapters, issues };
}
const formatChapters = (chapters) => chapters.map((c) => `${toClock(c.at_ms)} ${c.title}`).join('\n');

// Duração aceita para cortes (vídeo vertical), em segundos [mínimo, máximo]. Fora disso a Outstand recusa o post INTEIRO (422), e
// nenhuma rede recebe: por isso conferimos antes de agendar. Fontes: documentação da Outstand (Reels do Facebook 3 a 90 s; Reels do
// Instagram 3 s a 15 min; Threads até 5 min), YouTube Shorts até 3 min, TikTok até 10 min (a conta pode ter menos: conferido no envio),
// LinkedIn 3 s a 10 min (conservador). O X aceita 2 min e 20 s em conta comum: é só aviso (pode ser conta Premium).
const CLIP_SECONDS = { instagram: [3, 900], facebook: [3, 90], threads: [1, 300], youtube: [1, 180], tiktok: [3, 600], linkedin: [3, 600] };
const X_SECONDS = 140;
function checkClipDuration(platforms, durationMs, labelOf = (p) => p) {
  const issues = []; const warnings = [];
  const s = Number(durationMs) / 1000;
  if (!Number.isFinite(s) || s <= 0) return { issues, warnings };
  const clock = (n) => (n >= 60 ? `${Math.floor(n / 60)} min${n % 60 ? ` ${Math.round(n % 60)} s` : ''}` : `${Math.round(n)} s`);
  for (const p of platforms) {
    if (p === 'x') { if (s > X_SECONDS) warnings.push(`X: o vídeo tem ${clock(s)}; conta comum aceita até ${clock(X_SECONDS)}.`); continue; }
    const lim = CLIP_SECONDS[p]; if (!lim) continue;
    if (s < lim[0]) issues.push(`${labelOf(p)}: o vídeo tem ${clock(s)} e a rede pede pelo menos ${clock(lim[0])}.`);
    if (s > lim[1]) issues.push(`${labelOf(p)}: o vídeo tem ${clock(s)} e a rede aceita até ${clock(lim[1])}. Tire esta rede ou use um corte mais curto.`);
  }
  return { issues, warnings };
}

module.exports = {
  LIMITS, CLIP_SECONDS, utf8, tidy, stripAngles, balanceQuotes, fitWords, fitBytes, capsRatio, check, hashtagsIn, fitTags, thumbnailLines,
  checkYoutubeTitle, checkYoutubeDescription, checkSpotifyTitle, checkSpotifyDescription, checkInstagramCaption, checkTiktokCaption, checkClipDuration,
  toClock, parseClock, parseChapters, formatChapters,
};
