-- Resumo da reunião de patrocinador era gravado como JSON ({"html":…,"text":…}) em vez do HTML limpo: fica só o HTML.
UPDATE sponsor_meetings
   SET summary = nullif(summary::jsonb ->> 'html', '')
 WHERE summary ~ '^\{"html":';
