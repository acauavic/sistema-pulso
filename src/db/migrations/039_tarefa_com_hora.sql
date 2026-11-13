-- Tarefas com hora: o prazo continua sendo uma data (due_on) e, quando a pessoa quer, ganha uma hora (horário de Brasília).
ALTER TABLE tasks ADD COLUMN due_time TIME;
ALTER TABLE tasks ADD CONSTRAINT tasks_due_time_needs_date CHECK (due_time IS NULL OR due_on IS NOT NULL);
