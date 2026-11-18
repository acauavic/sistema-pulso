-- Metas por pessoa (Gestão > Equipe > Metas): até 3 por pessoa. Cada uma diz o que contar (a chave do catálogo em
-- src/services/goals.js), o período (dia útil, semana, mês), o alvo (número ou porcentagem, quando o que se conta é uma taxa) e
-- como aparece no Início (número "12 de 20" ou porcentagem da meta). O sistema conta sozinho, com o que já registra.
CREATE TABLE IF NOT EXISTS user_goals (
  id         SERIAL PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric     TEXT NOT NULL,
  period     TEXT NOT NULL CHECK (period IN ('dia', 'semana', 'mes')),
  target     NUMERIC(10, 2) NOT NULL CHECK (target > 0),
  display    TEXT NOT NULL DEFAULT 'numero' CHECK (display IN ('numero', 'porcentagem')),
  position   SMALLINT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_goals_user_idx ON user_goals (user_id, position);

-- A meta diária de abordagens de patrocinadores da Cadência vira uma meta: quem tinha número próprio leva o dele; as produtoras
-- ativas sem número próprio levam o padrão que estava configurado (5, se nunca mudou). A tabela antiga fica sem uso (sai depois).
DO $$
DECLARE std integer := 5;
BEGIN
  BEGIN
    SELECT coalesce((value::jsonb ->> 'sponsorGoal')::integer, 5) INTO std FROM app_settings WHERE key = 'outreach_config';
    std := coalesce(std, 5);
  EXCEPTION WHEN others THEN std := 5;
  END;
  IF NOT EXISTS (SELECT 1 FROM user_goals WHERE metric = 'abordagens_patrocinadores') THEN
    INSERT INTO user_goals (user_id, metric, period, target)
    SELECT user_id, 'abordagens_patrocinadores', 'dia', daily_target FROM outreach_goals WHERE daily_target > 0;
    IF std > 0 THEN
      INSERT INTO user_goals (user_id, metric, period, target)
      SELECT u.id, 'abordagens_patrocinadores', 'dia', std FROM users u
       WHERE u.active AND u.role = 'produtora' AND NOT EXISTS (SELECT 1 FROM outreach_goals g WHERE g.user_id = u.id);
    END IF;
  END IF;
END $$;
