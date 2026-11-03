-- Lembretes da gravação: quantas vezes cada um foi mandado (o botão "Reenviar" soma uma).
ALTER TABLE guest_reminders ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;
UPDATE guest_reminders SET send_count = 1 WHERE sent_at IS NOT NULL;
