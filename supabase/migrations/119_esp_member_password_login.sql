-- 119: ESP member self-service login, via password instead of OTP.
--
-- Why password over the original membership_number+phone check: ESP members
-- are club communities where members plausibly know each other's phone
-- numbers (shared WhatsApp groups, meetups) -- unlike the main Customer
-- Portal's plate+phone+IC check, which is "safe enough" only because random
-- garage customers have no reason to know anything about each other. A
-- password is a secret the member alone chooses, not derivable from public/
-- semi-public facts like a sequential membership number or a phone number
-- passed around a club group chat.
--
-- Why not OTP: no outbound SMS/WhatsApp Business API integration exists
-- anywhere in this codebase (checked before building this) -- that's real
-- infra and real per-message cost to stand up from scratch. Password is
-- free and ships today; OTP can replace this later if/when that
-- infrastructure exists.
--
-- Password lives on customers (not esp_members) -- one login covers every
-- membership tied to that customer (a customer can hold more than one, e.g.
-- across renewals or multiple communities). esp_set_password only works
-- while the hash is NULL (brand new member, or after a staff-initiated
-- reset) -- once set, the only way back in after a forgotten password is
-- esp_reset_member_password, a staff-only action gated the same way as
-- esp_move_member_community/esp_assign_membership_number, so "forgot
-- password" can never bypass to self-service and defeat the whole point.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS esp_portal_password_hash text;

-- ── esp_set_password ─────────────────────────────────────────────────────
-- First-time setup (or post-reset re-setup) via the original 2-factor check.
-- Deliberately refuses once a password already exists -- that path is
-- esp_login from here on, and "forgot it" goes through staff, not this RPC.
CREATE OR REPLACE FUNCTION public.esp_set_password(
  p_membership_number text,
  p_phone             text,
  p_new_password      text,
  p_tenant_slug        text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_member    RECORD;
  v_customer  RECORD;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, customer_id INTO v_member
    FROM esp_members
   WHERE membership_number = p_membership_number AND tenant_id = v_tenant_id
   LIMIT 1;
  IF NOT FOUND THEN RETURN json_build_object('error', 'not_found'); END IF;

  SELECT id, phone, esp_portal_password_hash INTO v_customer
    FROM customers WHERE id = v_member.customer_id;
  IF NOT FOUND OR normalize_my_phone(v_customer.phone) = '' OR normalize_my_phone(v_customer.phone) <> normalize_my_phone(p_phone) THEN
    RETURN json_build_object('error', 'phone_mismatch');
  END IF;

  IF v_customer.esp_portal_password_hash IS NOT NULL THEN
    RETURN json_build_object('error', 'password_already_set');
  END IF;

  IF length(coalesce(p_new_password, '')) < 6 THEN
    RETURN json_build_object('error', 'password_too_short');
  END IF;

  UPDATE customers SET esp_portal_password_hash = crypt(p_new_password, gen_salt('bf'))
   WHERE id = v_customer.id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_set_password(text, text, text, text) TO anon, authenticated;

-- ── esp_login ────────────────────────────────────────────────────────────
-- Phone + password -> every ESP membership tied to that customer. Same
-- error for "no such phone" and "wrong password" -- don't let a login
-- attempt reveal whether a phone number is registered at all.
CREATE OR REPLACE FUNCTION public.esp_login(
  p_phone       text,
  p_password    text,
  p_tenant_slug text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer  RECORD;
  v_members   JSON;
BEGIN
  v_tenant_id := resolve_portal_tenant(p_tenant_slug);
  IF v_tenant_id IS NULL THEN RETURN json_build_object('error', 'tenant_not_found'); END IF;

  SELECT id, full_name, esp_portal_password_hash INTO v_customer
    FROM customers
   WHERE tenant_id = v_tenant_id
     AND normalize_my_phone(phone) = normalize_my_phone(p_phone)
     AND normalize_my_phone(phone) <> ''
   LIMIT 1;

  IF NOT FOUND
     OR v_customer.esp_portal_password_hash IS NULL
     OR crypt(p_password, v_customer.esp_portal_password_hash) <> v_customer.esp_portal_password_hash
  THEN
    RETURN json_build_object('error', 'invalid_credentials');
  END IF;

  SELECT json_agg(json_build_object(
           'membership_number', em.membership_number,
           'status', em.status,
           'valid_until', em.valid_until,
           'community_name', ec.name
         ) ORDER BY em.registered_at DESC)
    INTO v_members
    FROM esp_members em
    JOIN esp_communities ec ON ec.id = em.community_id
   WHERE em.customer_id = v_customer.id AND em.tenant_id = v_tenant_id;

  RETURN json_build_object(
    'success', true,
    'full_name', v_customer.full_name,
    'phone', p_phone,
    'memberships', coalesce(v_members, '[]'::json)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION esp_login(text, text, text) TO anon, authenticated;

-- ── esp_reset_member_password (staff-only) ──────────────────────────────
-- The only way back in for a forgotten password -- nulls the hash so the
-- member can go through esp_set_password again. Staff verify identity
-- themselves (in person, or asking IC digits over a call) before doing
-- this; same auth/tenant-scoping pattern as esp_move_member_community.
CREATE OR REPLACE FUNCTION public.esp_reset_member_password(p_member_id uuid)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, extensions
AS $$
DECLARE
  v_member RECORD;
BEGIN
  IF NOT is_active_user() THEN RETURN json_build_object('error', 'forbidden'); END IF;

  SELECT * INTO v_member FROM esp_members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN json_build_object('error', 'member_not_found'); END IF;
  IF v_member.tenant_id <> get_my_tenant() THEN RETURN json_build_object('error', 'forbidden'); END IF;
  IF NOT (get_my_role() = ANY (ARRAY['super_admin', 'ops_manager', 'front_desk'])) THEN
    RETURN json_build_object('error', 'forbidden');
  END IF;

  UPDATE customers SET esp_portal_password_hash = NULL WHERE id = v_member.customer_id;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION esp_reset_member_password(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION esp_reset_member_password(uuid) FROM PUBLIC;
