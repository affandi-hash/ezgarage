-- 117: Real members have accidentally registered under the wrong community
-- (the public picker lists ~30 similarly-named clubs with no confirmation
-- step -- see EspCommunityPickerPage.tsx fix in the same change). Staff had
-- no way to correct this themselves. membership_number encodes the
-- community (generate_esp_membership_number()'s slug prefix), so moving a
-- member isn't a bare community_id UPDATE -- it needs a fresh number under
-- the target community's own counter too. Mirrors esp_renew_member's
-- auth/tenant-scoping pattern exactly.

CREATE OR REPLACE FUNCTION public.esp_move_member_community(
  p_member_id       uuid,
  p_new_community_id uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_member    RECORD;
  v_community RECORD;
  v_old_number TEXT;
  v_new_number TEXT;
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;

  SELECT * INTO v_member FROM esp_members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'member_not_found'); END IF;
  IF v_member.tenant_id <> get_my_tenant() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'front_desk'])) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  IF p_new_community_id = v_member.community_id THEN
    RETURN json_build_object('error', 'already_in_community');
  END IF;

  SELECT * INTO v_community FROM esp_communities WHERE id = p_new_community_id;
  IF NOT FOUND OR v_community.tenant_id <> v_member.tenant_id THEN
    RETURN json_build_object('error', 'community_not_found');
  END IF;
  IF NOT v_community.is_active THEN RETURN json_build_object('error', 'community_inactive'); END IF;

  v_old_number := v_member.membership_number;
  v_new_number := generate_esp_membership_number(p_new_community_id);

  UPDATE esp_members
     SET community_id = p_new_community_id,
         branch_id = v_community.home_branch_id,
         membership_number = v_new_number,
         updated_at = now()
   WHERE id = p_member_id;

  RETURN json_build_object(
    'success', true,
    'old_membership_number', v_old_number,
    'new_membership_number', v_new_number,
    'new_community_name', v_community.name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_move_member_community(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION esp_move_member_community(uuid, uuid) FROM PUBLIC;
