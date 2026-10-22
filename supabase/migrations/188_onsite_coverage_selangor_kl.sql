-- 188: ON-SITE covers Selangor and Kuala Lumpur (the Klang Valley), no radius and no travel surcharge.
-- Two zones at RM 0. Any other postcode goes to the waitlist request.
-- KL: 50000-60999. Selangor: 40000-48999, 63000-64999 (Cyberjaya, KLIA), 68000-68199 (Ampang/Gombak side).
DO $$
DECLARE t uuid := (SELECT id FROM tenants WHERE slug = 'motoverse-garage');
BEGIN
  UPDATE os_zones SET name = 'Selangor', surcharge = 0, is_active = true, sort_order = 1,
         postcodes = ARRAY['40','41','42','43','44','45','46','47','48','63','64','680','681'], note = 'Whole of Selangor'
   WHERE tenant_id = t AND name = 'Puchong';
  IF NOT FOUND THEN
    INSERT INTO os_zones (tenant_id, name, postcodes, surcharge, note, sort_order, is_active)
    VALUES (t, 'Selangor', ARRAY['40','41','42','43','44','45','46','47','48','63','64','680','681'], 0, 'Whole of Selangor', 1, true);
  END IF;
  INSERT INTO os_zones (tenant_id, name, postcodes, surcharge, note, sort_order, is_active)
  SELECT t, 'Kuala Lumpur', ARRAY['50','51','52','53','54','55','56','57','58','59','60'], 0, 'Whole of Kuala Lumpur', 2, true
   WHERE NOT EXISTS (SELECT 1 FROM os_zones WHERE tenant_id = t AND name = 'Kuala Lumpur');
  UPDATE os_settings SET zones_enabled = true WHERE tenant_id = t;
END $$;
