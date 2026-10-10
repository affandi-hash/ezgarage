-- 169: the payment context says when it is a BB booking, so the gateway page reads "BB Care Day", not "ON-SITE".

CREATE OR REPLACE FUNCTION os_payment_context(p_token text, p_invoice uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b os_bookings; inv invoices; nxt jsonb;
BEGIN
  PERFORM os_expire_holds();
  SELECT * INTO b FROM os_bookings WHERE token = p_token AND invoice_id = p_invoice;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO inv FROM invoices WHERE id = b.invoice_id;
  IF b.service_mode = 'bb_pickup' THEN
    -- the workshop invoice: payable once issued; one instalment at a time when it is on a plan
    IF inv.status NOT IN ('sent', 'overdue') OR inv.total_amount - inv.amount_paid <= 0 THEN RETURN NULL; END IF;
    nxt := invoice_plan_next(inv.id);
    RETURN jsonb_build_object('kind', 'balance', 'mode', 'bb_pickup', 'booking_number', b.booking_number,
                              'amount', coalesce((nxt->>'pay_now')::numeric, inv.total_amount - inv.amount_paid));
  END IF;
  IF b.status = 'awaiting_deposit' AND b.deposit_status = 'unpaid' AND inv.status <> 'void' THEN
    RETURN jsonb_build_object('kind', 'deposit', 'amount', b.deposit_amount - inv.amount_paid, 'booking_number', b.booking_number);
  ELSIF b.status = 'completed' AND inv.status <> 'void' AND inv.total_amount - inv.amount_paid > 0 THEN
    RETURN jsonb_build_object('kind', 'balance', 'amount', inv.total_amount - inv.amount_paid, 'booking_number', b.booking_number);
  END IF;
  RETURN NULL;
END $$;
