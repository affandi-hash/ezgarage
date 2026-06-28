-- =============================================================================
-- 013_invoices.sql
-- Motoverse MGOD V3 — Invoices Module
-- =============================================================================


-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------

DROP TYPE IF EXISTS invoice_status CASCADE;
CREATE TYPE invoice_status AS ENUM ('draft', 'sent', 'paid', 'void', 'overdue');

DROP TYPE IF EXISTS payment_method CASCADE;
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'online_transfer', 'cheque', 'other');


-- -----------------------------------------------------------------------------
-- SEQUENCE — invoice number auto-increment
-- -----------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;


-- -----------------------------------------------------------------------------
-- TABLE: invoices
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoices (
    id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Relationships
    branch_id           uuid            NOT NULL REFERENCES branches(id),
    job_id              uuid            REFERENCES jobs(id) ON DELETE SET NULL,
    customer_id         uuid            REFERENCES customers(id),

    -- Invoice number (set by trigger)
    invoice_number      text            UNIQUE NOT NULL DEFAULT '',

    -- Denormalized customer snapshot (historical record)
    customer_name       text            NOT NULL,
    customer_phone      text,
    customer_email      text,

    -- Denormalized vehicle snapshot
    vehicle_plate       text,
    vehicle_info        text,           -- eg "2019 Toyota Vios"

    -- Dates
    issue_date          date            NOT NULL DEFAULT CURRENT_DATE,
    due_date            date,

    -- Status
    status              invoice_status  NOT NULL DEFAULT 'draft',

    -- Line items: array of {description, qty, unit_price, amount}
    line_items          jsonb           NOT NULL DEFAULT '[]',

    -- Financials
    subtotal            numeric(10,2)   NOT NULL DEFAULT 0,
    discount_pct        numeric(5,2)    NOT NULL DEFAULT 0,
    discount_amount     numeric(10,2)   NOT NULL DEFAULT 0,
    tax_pct             numeric(5,2)    NOT NULL DEFAULT 0,
    tax_amount          numeric(10,2)   NOT NULL DEFAULT 0,
    total_amount        numeric(10,2)   NOT NULL DEFAULT 0,
    amount_paid         numeric(10,2)   NOT NULL DEFAULT 0,
    balance_due         numeric(10,2)   GENERATED ALWAYS AS (total_amount - amount_paid) STORED,

    -- Payment details
    payment_method      payment_method,
    payment_date        date,
    payment_reference   text,

    -- Notes
    notes               text,

    -- Audit
    created_by          uuid            REFERENCES auth.users(id),
    created_at          timestamptz     NOT NULL DEFAULT now(),
    updated_at          timestamptz     NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- TRIGGER: auto-generate invoice_number on INSERT
-- Format: INV-YYYY-NNNN  (eg INV-2026-0001)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.invoice_number := 'INV-'
        || to_char(now(), 'YYYY')
        || '-'
        || lpad(nextval('invoice_seq')::text, 4, '0');
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_number ON invoices;
CREATE TRIGGER trg_invoice_number
    BEFORE INSERT ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION generate_invoice_number();


-- -----------------------------------------------------------------------------
-- TRIGGER: updated_at auto-stamp
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION touch_updated_at();


-- -----------------------------------------------------------------------------
-- ALTER jobs — add invoice_id foreign key back-reference
-- -----------------------------------------------------------------------------

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL;


-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_invoices_branch_id   ON invoices (branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job_id      ON invoices (job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status      ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date  ON invoices (issue_date);


-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin sees all; other active staff see their branch only
DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select"
    ON invoices
    FOR SELECT
    USING (
        is_active_user()
        AND (
            get_my_role() = 'super_admin'
            OR branch_id = get_my_branch()
        )
    );

-- INSERT: front_desk, ops_manager, super_admin, finance
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert"
    ON invoices
    FOR INSERT
    WITH CHECK (
        is_active_user()
        AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'finance')
    );

-- UPDATE: same roles as INSERT
DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update"
    ON invoices
    FOR UPDATE
    USING (
        is_active_user()
        AND get_my_role() IN ('super_admin', 'ops_manager', 'front_desk', 'finance')
    );

-- DELETE: super_admin and ops_manager only
DROP POLICY IF EXISTS "invoices_delete" ON invoices;
CREATE POLICY "invoices_delete"
    ON invoices
    FOR DELETE
    USING (
        is_active_user()
        AND get_my_role() IN ('super_admin', 'ops_manager')
    );
