// Revisão do vídeo editado: comentários que acompanham as versões, o "feito" do editor, o "conferido" de quem revisa e os
// marcadores para o programa de edição.
//
// Ciclo: a gestão comenta na v1 (minutagem da v1) → o editor marca "feito" em cada ajuste → ao subir a v2, o que foi marcado
// vira "feito na v2" → quem revisa confere ("Conferido") ou devolve ("Ainda não"). O comentário nunca some com a versão: a
// versão que tem comentários não pode ser apagada (a correção sobe como versão nova) e, se o arquivo sair por outro caminho,
// o comentário fica com a versão anotada.
//
// As minutagens são ORIENTAÇÃO: o ajuste quase nunca é no segundo exato. Tudo o que vai para o editor diz isso.
const db = require('../db/pool');
const fmt = require('../utils/format');

const NOTE = 'As minutagens são aproximadas: mostram onde está o ajuste, não o quadro exato. Assista um pouco antes e depois e escolha o ponto certo.';

// Estado do comentário para a tela: resolvido (conferido), conferir (o editor fez e falta conferir) ou aberto.
const stateOf = (c) => (c.resolved ? 'resolvido' : c.fixed_at ? 'conferir' : 'aberto');

const latestEdited = (episodeId) => db.query(
  "SELECT id, version, fps, width, height FROM episode_files WHERE episode_id = $1 AND kind = 'editado' AND status = 'pronto' ORDER BY version DESC, id DESC LIMIT 1",
  [episodeId]).then((r) => r.rows[0] || null);

// O editor marca (ou desmarca) "feito". A correção entra na versão mais nova que já está no ar se ela for posterior à comentada;
// senão fica "entra na próxima versão" até o editor subir a nova.
async function markFixed(episodeId, commentId, done, user) {
  const { rows: [c] } = await db.query('SELECT * FROM episode_comments WHERE id = $1 AND episode_id = $2', [commentId, episodeId]);
  if (!c) return null;
  if (!done) {
    const { rows: [u] } = await db.query('UPDATE episode_comments SET fixed_at = NULL, fixed_by = NULL, fixed_version = NULL WHERE id = $1 RETURNING *', [c.id]);
    return u;
  }
  const latest = await latestEdited(episodeId);
  const into = latest && c.version != null && latest.version > c.version ? latest.version : null;
  const { rows: [u] } = await db.query(
    'UPDATE episode_comments SET fixed_at = coalesce(fixed_at, now()), fixed_by = coalesce(fixed_by, $2), fixed_version = coalesce(fixed_version, $3) WHERE id = $1 RETURNING *',
    [c.id, user.id, into]);
  return u;
}

// Nova versão no ar: o que o editor marcou como feito e ainda esperava versão passa a ser "feito nesta versão".
async function versionUploaded(file) {
  const { rows } = await db.query(
    `UPDATE episode_comments SET fixed_version = $2
      WHERE episode_id = $1 AND fixed_at IS NOT NULL AND fixed_version IS NULL AND NOT resolved AND (version IS NULL OR version < $2)
      RETURNING id`, [file.episode_id, file.version]);
  return rows.length;
}

// Quem revisa devolve ("Ainda não"): volta a ser ajuste em aberto para o editor.
const reopenFix = (episodeId, commentId) => db.query(
  'UPDATE episode_comments SET fixed_at = NULL, fixed_by = NULL, fixed_version = NULL, resolved = false, resolved_by = NULL, resolved_at = NULL WHERE id = $1 AND episode_id = $2 RETURNING *',
  [commentId, episodeId]).then((r) => r.rows[0] || null);

// Quantos comentários prendem esta versão (não pode ser apagada enquanto tiver algum).
const commentsOnFile = (fileId) => db.query('SELECT count(*)::int AS n FROM episode_comments WHERE file_id = $1', [fileId]).then((r) => r.rows[0].n);

// Resumo para avisos e para a tela: { total, aberto, conferir, resolvido }.
async function summary(episodeId) {
  const { rows: [s] } = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT resolved AND fixed_at IS NULL)::int AS aberto,
            count(*) FILTER (WHERE NOT resolved AND fixed_at IS NOT NULL)::int AS conferir, count(*) FILTER (WHERE resolved)::int AS resolvido
       FROM episode_comments WHERE episode_id = $1`, [episodeId]);
  return s;
}

// Frase curta do andamento dos ajustes, para os avisos ("3 de 5 ajustes marcados como feitos").
async function progressLine(episodeId) {
  const s = await summary(episodeId);
  const pending = s.aberto + s.conferir;
  if (!pending) return null;
  return s.conferir ? `${s.conferir} de ${pending} ajuste${pending > 1 ? 's' : ''} marcado${s.conferir > 1 ? 's' : ''} como feito${s.conferir > 1 ? 's' : ''} para conferir.` : `${pending} ajuste${pending > 1 ? 's' : ''} ainda sem marcar como feito.`;
}

// Versão nova enviada com o episódio já em revisão: quem revisa fica sabendo (e o que conferir).
async function newVersionNotice(file, fixedNow, user) {
  const { rows: [ep] } = await db.query('SELECT id, number, title, status FROM episodes WHERE id = $1', [file.episode_id]);
  if (!ep || ep.status !== 'em_revisao' || file.version < 2) return;
  const { PERMISSIONS } = require('../permissions');
  const { rows } = await db.query('SELECT id FROM users WHERE active AND role = ANY($1)', [PERMISSIONS['production.review'] || []]);
  const label = `${ep.number ? `EP.${String(ep.number).padStart(3, '0')}` : 'Episódio'} · ${ep.title}`;
  await require('./notify').notify({
    type: 'episodio', users: rows.map((r) => r.id), actorId: user.id, entity: { type: 'episode', id: ep.id }, url: `/episodios/${ep.id}#revisao`,
    title: `Nova versão (v${file.version}) para revisar: ${label}`,
    body: (await progressLine(ep.id)) || `${user.name} enviou a versão ${file.version}.`,
  });
}

// ---------------------------------------------------------------- marcadores para o programa de edição
const FPS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
const pickFps = (v, fallback = 30) => { const n = Number(v); return FPS.find((f) => Math.abs(f - n) < 0.02) || fallback; };

// Minutagem (ms) -> timecode SMPTE sem drop frame (o padrão das linhas do tempo do DaVinci), começando em startHour.
function timecode(ms, fps, startHour = 1) {
  const base = Math.round(fps);
  let frames = Math.round((ms / 1000) * fps) + startHour * 3600 * base;
  const f = frames % base; frames = (frames - f) / base;
  const s = frames % 60; frames = (frames - s) / 60;
  const m = frames % 60; const h = (frames - m) / 60;
  return [h, m, s, f].map((n) => String(n).padStart(2, '0')).join(':');
}
const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim().slice(0, max);
const COLOR = { aberto: 'ResolveColorRed', conferir: 'ResolveColorYellow', resolvido: 'ResolveColorGreen' };
const STATE_LABEL = { aberto: 'em aberto', conferir: 'feito, falta conferir', resolvido: 'conferido' };

// Premiere: cor do marcador em <pproColor> (inteiro com os bytes A,B,G,R). Vermelho é o valor que o próprio Premiere exporta;
// sem <pproColor> o marcador fica verde (o padrão do Premiere), então "conferido" não leva cor.
const PPRO_COLOR = { aberto: 4281740498, conferir: 0xFF2BA1D0 };
const xml = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NTSC = [23.976, 29.97, 59.94];

// comments: os da revisão (com author_name). which: 'abertos' (não conferidos) | 'todos'.
// format: 'premiere' (XML do Final Cut 7, que o Premiere importa como uma sequência com os marcadores)
//       | 'davinci' (EDL de marcadores: Linha do tempo > Importar > Marcadores da linha do tempo a partir de EDL) | 'texto'.
function markers({ ep, comments, format = 'davinci', fps = 30, startHour = 1, which = 'abertos', latestVersion = null, width = null, height = null }) {
  const list = comments.filter((c) => which === 'todos' || !c.resolved)
    .sort((a, b) => (a.at_ms ?? -1) - (b.at_ms ?? -1) || a.id - b.id);
  const timed = list.filter((c) => c.at_ms != null);
  const general = list.filter((c) => c.at_ms == null);
  const epNo = ep.number ? `EP.${String(ep.number).padStart(3, '0')}` : 'Episódio';
  const slug = `${ep.number ? `ep${String(ep.number).padStart(3, '0')}` : `episodio-${ep.id}`}-ajustes-da-revisao`;
  const vTag = (c) => (c.version != null && latestVersion != null && c.version !== latestVersion ? `minutagem da v${c.version}` : (c.version != null ? `v${c.version}` : ''));

  if (format === 'texto') {
    const out = [
      `${epNo} · ${ep.title}`,
      `Ajustes da revisão (${which === 'todos' ? 'todos' : 'em aberto'}) · gerado em ${fmt.formatDateTime(new Date())}`,
      '',
      `IMPORTANTE: ${NOTE}`,
      'Quando o ajuste for "cortar daqui até ali", trate como uma indicação do trecho: ajuste a entrada e a saída no ponto que fica natural.',
      '',
    ];
    timed.forEach((c, i) => {
      out.push(`${i + 1}. ≈ ${fmt.formatRange(c.at_ms, c.end_ms)}${vTag(c) ? ` (${vTag(c)})` : ''} · ${STATE_LABEL[stateOf(c)]}`);
      out.push(`   ${String(c.body || '').replace(/\r?\n/g, '\n   ')}`);
      out.push(`   — ${c.author_name || 'revisão'} · ${fmt.formatDateTime(c.created_at)}`, '');
    });
    if (general.length) {
      out.push('Comentários gerais (sem minutagem):');
      general.forEach((c) => out.push(`- ${oneLine(c.body, 2000)} (${STATE_LABEL[stateOf(c)]})`));
      out.push('');
    }
    if (!list.length) out.push('Nenhum ajuste nesta lista.');
    return { filename: `${slug}.txt`, contentType: 'text/plain; charset=utf-8', body: `﻿${out.join('\r\n')}` };
  }

  if (format === 'premiere') {
    // XML do Final Cut 7 (xmeml), que o Premiere importa (Arquivo > Importar) como uma sequência nova com os marcadores.
    // A sequência começa em 00:00:00:00, como no Premiere; <in>/<out> são quadros desde o início (out -1 = marcador de ponto).
    const frame = (ms) => Math.round((ms / 1000) * fps);
    const rate = `<rate><timebase>${Math.round(fps)}</timebase><ntsc>${NTSC.includes(fps) ? 'TRUE' : 'FALSE'}</ntsc></rate>`;
    const w = width > 0 ? width : 1920; const h = height > 0 ? height : 1080;
    const seqName = `${epNo} · ajustes da revisão`;
    const last = timed.reduce((m, c) => Math.max(m, frame(c.end_ms ?? c.at_ms)), 0);
    const marks = timed.map((c) => {
      const st = stateOf(c);
      const tag = vTag(c) && vTag(c).startsWith('minutagem') ? `[${vTag(c)}] ` : '';
      const inF = frame(c.at_ms);
      const outF = c.end_ms != null ? Math.max(inF + 1, frame(c.end_ms)) : -1;
      const comment = `${tag}${oneLine(c.body || 'ajuste', 2000)} (${c.author_name || 'revisão'} · ${STATE_LABEL[st]}). Minutagem aproximada: confira um pouco antes e depois.`;
      return ['    <marker>',
        `      <comment>${xml(comment)}</comment>`,
        `      <name>${xml(`~ ${oneLine(c.body || 'ajuste', 80)}`)}</name>`,
        `      <in>${inF}</in>`, `      <out>${outF}</out>`,
        ...(PPRO_COLOR[st] ? [`      <pproColor>${PPRO_COLOR[st]}</pproColor>`] : []),
        '    </marker>'].join('\n');
    });
    const tracks = (n) => Array.from({ length: n }, () => '<track></track>').join('');
    const body = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE xmeml>',
      `<!-- ${xml(`${epNo} · ${ep.title}. ${NOTE}`).replace(/-{2,}/g, '-')} -->`, // comentário de XML não aceita "--"
      '<xmeml version="4">',
      '  <sequence id="sequence-1">',
      `    <name>${xml(seqName)}</name>`,
      `    <duration>${last + Math.round(fps * 10)}</duration>`,
      `    ${rate}`,
      `    <timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`,
      '    <media>',
      `      <video><format><samplecharacteristics>${rate}<width>${w}</width><height>${h}</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>${tracks(3)}</video>`,
      `      <audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${tracks(4)}</audio>`,
      '    </media>',
      ...marks,
      '  </sequence>', '</xmeml>', ''].join('\n');
    return { filename: `${slug}.xml`, contentType: 'application/xml; charset=utf-8', body };
  }

  // EDL de marcadores no formato que o próprio DaVinci Resolve exporta (e importa de volta).
  const lines = [`TITLE: ${oneLine(`${epNo} ajustes da revisao`, 60)}`, 'FCM: NON-DROP FRAME', ''];
  timed.forEach((c, i) => {
    const inTc = timecode(c.at_ms, fps, startHour);
    const dur = Math.max(1, Math.round((((c.end_ms ?? c.at_ms) - c.at_ms) / 1000) * fps));
    const outTc = timecode(c.at_ms + Math.max(1, dur) * (1000 / fps), fps, startHour);
    const tag = vTag(c) && vTag(c).startsWith('minutagem') ? `[${vTag(c)}] ` : '';
    // "~" = aproximado (ASCII: alguns programas estragam símbolos no EDL)
    const name = oneLine(`~ ${tag}${c.body || 'ajuste'} (${c.author_name || 'revisão'})`, 240);
    lines.push(`${String(i + 1).padStart(3, '0')}  001      V     C        ${inTc} ${outTc} ${inTc} ${outTc}  `);
    lines.push(` |C:${COLOR[stateOf(c)]} |M:${name} |D:${dur}`);
    lines.push('');
  });
  return { filename: `${slug}.edl`, contentType: 'text/plain; charset=utf-8', body: lines.join('\r\n') };
}

module.exports = { progressLine, newVersionNotice, NOTE, FPS, stateOf, latestEdited, markFixed, versionUploaded, reopenFix, commentsOnFile, summary, markers, timecode, pickFps };
