-- 067: Payment priority on supplier invoices, auto-sync paid status back to
-- linked stock purchases, and harden the supplier-invoices storage bucket.

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS payment_priority text NOT NULL DEFAULT 'normal'
  CHECK (payment_priority IN ('low', 'normal', 'high', 'urgent'));

-- The supplier-invoices bucket was created manually (outside migrations) as
-- public. Switch it to private now that both Accounts Payable and Stock
-- Purchases serve files via signed URLs instead of direct public links.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760, -- 10 MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
WHERE id = 'supplier-invoices';

-- When a supplier invoice tied to a stock purchase becomes fully paid,
-- advance that stock purchase's status from 'ordered' to 'paid' so it can
-- proceed to 'received'. This is the single source of truth for payment —
-- Accounts Payable is where invoices actually get marked paid.
CREATE OR REPLACE FUNCTION sync_stock_purchase_paid_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.stock_purchase_id IS NOT NULL THEN
    UPDATE parts_requests
    SET status = 'paid', updated_at = now()
    WHERE id = NEW.stock_purchase_id AND status = 'ordered';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_stock_purchase_paid_status ON supplier_invoices;
CREATE TRIGGER trg_sync_stock_purchase_paid_status
  AFTER INSERT OR UPDATE OF status ON supplier_invoices
  FOR EACH ROW
  EXECUTE FUNCTION sync_stock_purchase_paid_status();
