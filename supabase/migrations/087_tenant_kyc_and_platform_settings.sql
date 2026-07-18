-- 087: Tenant KYC fields (for RaudhahPay/Chip In disbursement + compliance)
-- and a new platform-level settings surface for the super_admin role,
-- which already behaves as a platform-wide operator role in RLS (see
-- users_select/tenants_select's `OR get_my_role() = 'super_admin'`
-- clauses) even though nothing has used that scope yet.

-- ── Tenant KYC fields ────────────────────────────────────────────────────
-- Distinct from branches.bank_* (which is the customer-facing bank
-- transfer target printed on invoices) — this is the tenant's own
-- settlement account, i.e. where Chip In Sdn Bhd pays out to.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legal_business_name text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ssm_registration_number text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settlement_bank_name text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settlement_bank_account_number text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settlement_bank_account_name text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kyc_notified_at timestamptz;

-- ── Platform settings (single-row config table, not tenant-scoped) ──────
CREATE TABLE IF NOT EXISTS platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raudhahpay_pic_email text,
  daily_statement_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

-- Seed the single row this table is meant to ever hold.
INSERT INTO platform_settings (raudhahpay_pic_email)
SELECT NULL
WHERE NOT EXISTS (SELECT 1 FROM platform_settings);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY platform_settings_select ON platform_settings FOR SELECT TO authenticated
  USING (get_my_role() = 'super_admin');

CREATE POLICY platform_settings_update ON platform_settings FOR UPDATE TO authenticated
  USING (get_my_role() = 'super_admin');

-- ── Daily statement send log (audit trail — so "did Chip In get
-- yesterday's statement" has an actual answer, not just an email that
-- may or may not have gone out silently) ────────────────────────────────
CREATE TABLE IF NOT EXISTS raudhahpay_statement_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_date date NOT NULL,
  recipient_email text NOT NULL,
  total_amount numeric NOT NULL,
  transaction_count integer NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_date)
);

ALTER TABLE raudhahpay_statement_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY raudhahpay_statement_log_select ON raudhahpay_statement_log FOR SELECT TO authenticated
  USING (get_my_role() = 'super_admin');

-- service_role (the edge function) bypasses RLS entirely, so no INSERT
-- policy for authenticated is needed here.
