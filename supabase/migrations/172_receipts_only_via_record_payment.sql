-- 172: receipts are created only by record_payment and the payment gateway.
-- Apply after the screens that call record_payment are live (see 170).
DROP POLICY IF EXISTS receipts_insert_legacy ON receipts;
