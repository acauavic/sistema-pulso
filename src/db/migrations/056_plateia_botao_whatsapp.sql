-- Botão flutuante de WhatsApp nas páginas da plateia: clique conta como evento "contact".
ALTER TABLE plateia_events DROP CONSTRAINT IF EXISTS plateia_events_type_check;
ALTER TABLE plateia_events ADD CONSTRAINT plateia_events_type_check
  CHECK (type IN ('view', 'agenda_click', 'signup_click', 'form_open', 'lead', 'whatsapp', 'contact'));
