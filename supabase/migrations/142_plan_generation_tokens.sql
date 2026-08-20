-- 142: Marketing Plan generation isn't a chat -- one action, one result --
-- so there's no per-turn history to attach a token count/timestamp to.
-- created_at already exists (132); this adds the token count so the
-- generation cost can be shown alongside it in the UI.

ALTER TABLE sales_marketing_plans ADD COLUMN IF NOT EXISTS generation_tokens integer;
