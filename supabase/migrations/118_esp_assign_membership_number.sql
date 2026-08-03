-- 118: Staff need to hand-assign a specific membership number to an existing
-- member -- e.g. freeing up a low number range a club committee wants to
-- reserve for themselves, by moving whoever currently holds it elsewhere
-- first. Same auth/tenant-scoping pattern as esp_renew_member and
-- esp_move_member_community. Keeps the member's existing community/year
-- (only the numeric suffix changes) -- moving communities is what
-- esp_move_member_community is for.
--
-- Mirrors generate_esp_membership_number()'s {CODE}/{YEAR}/{YY}/{SEQ:N}
-- template logic (106_esp_membership_number_custom_format.sql) rather than
-- assuming a bare slug-derived prefix -- communities configure their own
-- short code (e.g. "SMXMG") and format, and getting this wrong produces a
-- garbled number like "SPORTSTER-MALAYSIA-2026-0035" instead of
-- "SMXMG-2026-0035".

CREATE OR REPLACE FUNCTION public.esp_assign_membership_number(
  p_member_id   uuid,
  p_new_last4   text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_member     RECORD;
  v_code       TEXT;
  v_format     TEXT;
  v_year       TEXT;
  v_yy         TEXT;
  v_seq_width  INTEGER;
  v_match      TEXT[];
  v_new_number TEXT;
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;

  SELECT * INTO v_member FROM esp_members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'member_not_found'); END IF;
  IF v_member.tenant_id <> get_my_tenant() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'front_desk'])) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  IF p_new_last4 !~ '^[0-9]{1,6}$' THEN
    RETURN json_build_object('error', 'invalid_number');
  END IF;

  SELECT
    COALESCE(NULLIF(TRIM(code), ''), NULLIF(TRIM(upper(slug)), ''), 'ESP'),
    COALESCE(NULLIF(TRIM(membership_number_format), ''), '{CODE}-{YEAR}-{SEQ:4}')
  INTO v_code, v_format
  FROM esp_communities WHERE id = v_member.community_id;

  -- Keep the member's existing year rather than assuming the current one --
  -- a renewal can carry a membership across years, and this only touches
  -- the numeric suffix.
  v_year := split_part(v_member.membership_number, '-', 2);
  v_yy := right(v_year, 2);

  v_match := regexp_match(v_format, '\{SEQ:?([0-9]*)\}');
  IF v_match IS NULL OR v_match[1] IS NULL OR v_match[1] = '' THEN
    v_seq_width := 4;
  ELSE
    v_seq_width := v_match[1]::INTEGER;
  END IF;

  v_new_number := regexp_replace(v_format, '\{SEQ:?[0-9]*\}', LPAD(p_new_last4, v_seq_width, '0'));
  v_new_number := replace(v_new_number, '{CODE}', upper(v_code));
  v_new_number := replace(v_new_number, '{YEAR}', v_year);
  v_new_number := replace(v_new_number, '{YY}', v_yy);

  IF v_new_number = v_member.membership_number THEN
    RETURN json_build_object('error', 'same_number');
  END IF;

  IF EXISTS (
    SELECT 1 FROM esp_members
     WHERE tenant_id = v_member.tenant_id AND membership_number = v_new_number
  ) THEN
    RETURN json_build_object('error', 'number_taken');
  END IF;

  UPDATE esp_members
     SET membership_number = v_new_number, updated_at = now()
   WHERE id = p_member_id;

  RETURN json_build_object(
    'success', true,
    'old_membership_number', v_member.membership_number,
    'new_membership_number', v_new_number
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN json_build_object('error', 'number_taken');
END;
$$;

GRANT EXECUTE ON FUNCTION esp_assign_membership_number(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION esp_assign_membership_number(uuid, text) FROM PUBLIC;
