-- 106: ESP membership numbers were derived straight from the community's
-- public slug (e.g. "SPORTSTER-MALAYSIA-2026-0001"), since slug was the only
-- thing generate_esp_membership_number() had to key a prefix off. Slug has to
-- be long/readable for the public URL; a running-number prefix should be
-- short and staff-chosen instead -- and staff should be able to customize
-- the whole numbering convention, not just the prefix.
--
-- Adds a short "code" (e.g. "SPM") separate from slug, and a custom
-- template ("membership_number_format", e.g. "{CODE}-{YEAR}-{SEQ:4}") that
-- staff configure per community. Falls back to the old slug-derived
-- behavior if a community hasn't set either, so nothing existing breaks.

ALTER TABLE esp_communities ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE esp_communities ADD COLUMN IF NOT EXISTS membership_number_format text;

-- A format with no sequence placeholder would mint the same number for
-- every member registered in the same community+year (the counter always
-- increments regardless of whether the template uses it), silently
-- colliding on the second registration. Require {SEQ} or {SEQ:N} whenever a
-- custom format is actually set.
ALTER TABLE esp_communities ADD CONSTRAINT esp_communities_format_has_seq
  CHECK (membership_number_format IS NULL OR membership_number_format ~ '\{SEQ:?[0-9]*\}');

-- Tenant-scoped uniqueness for code (same reasoning as branches.code) --
-- unlike slug, code never appears in a public URL, so it doesn't need to be
-- globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS esp_communities_tenant_code_unique
  ON esp_communities (tenant_id, code) WHERE code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.generate_esp_membership_number(p_community_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code      TEXT;
  v_format    TEXT;
  v_year      TEXT;
  v_yy        TEXT;
  v_seq       INTEGER;
  v_seq_width INTEGER;
  v_match     TEXT[];
  v_result    TEXT;
BEGIN
  SELECT
    COALESCE(NULLIF(TRIM(code), ''), NULLIF(TRIM(upper(slug)), ''), 'ESP'),
    COALESCE(NULLIF(TRIM(membership_number_format), ''), '{CODE}-{YEAR}-{SEQ:4}')
  INTO v_code, v_format
  FROM esp_communities WHERE id = p_community_id;

  v_year := TO_CHAR(NOW(), 'YYYY');
  v_yy   := TO_CHAR(NOW(), 'YY');

  -- Same atomic per-(community, year) counter as before -- the sequence
  -- always advances regardless of where/whether {SEQ} appears in the
  -- template, which is exactly why the CHECK constraint above requires it.
  INSERT INTO esp_membership_counters (community_id, year, last_seq)
  VALUES (p_community_id, v_year, 1)
  ON CONFLICT (community_id, year)
  DO UPDATE SET last_seq = esp_membership_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;

  v_match := regexp_match(v_format, '\{SEQ:?([0-9]*)\}');
  IF v_match IS NULL OR v_match[1] IS NULL OR v_match[1] = '' THEN
    v_seq_width := 4;
  ELSE
    v_seq_width := v_match[1]::INTEGER;
  END IF;

  v_result := regexp_replace(v_format, '\{SEQ:?[0-9]*\}', LPAD(v_seq::TEXT, v_seq_width, '0'));
  v_result := replace(v_result, '{CODE}', upper(v_code));
  v_result := replace(v_result, '{YEAR}', v_year);
  v_result := replace(v_result, '{YY}', v_yy);

  RETURN v_result;
END;
$$;
