// Planilha para o Excel em português: UTF-8 com BOM, ";" entre as colunas, CRLF. Texto que começa com = + - @ vira texto
// (não roda fórmula); número (-150,00) continua número, para o Excel somar.
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(,\d+)?$/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (values) => values.map(cell).join(';');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function send(res, filename, header, rows) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
  res.send(`﻿${[line(header), ...rows.map(line)].join('\r\n')}\r\n`);
}

module.exports = { cell, line, send, today };
