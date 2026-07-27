-- 110: Seeds 29 real ESP communities for Motoverse Garage (the biker/motorcycle
-- clubs the workshop is onboarding beyond the existing Sportster Malaysia deal).
-- Deliberately created is_active = false with membership_fee/discounts left at
-- their zero defaults -- these are placeholders pending real negotiated terms
-- per club, not yet meant to be publicly registerable. Staff activate each one
-- from ESP Community Settings once its actual fee/validity/discount terms are
-- filled in. home_branch_id is Motoverse Garage's only branch.

DO $$
DECLARE
  v_tenant_id uuid;
  v_branch_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'motoverse-garage';
  SELECT id INTO v_branch_id FROM branches WHERE tenant_id = v_tenant_id LIMIT 1;

  INSERT INTO esp_communities (tenant_id, home_branch_id, name, slug, is_active)
  SELECT v_tenant_id, v_branch_id, v.name, v.slug, false
  FROM (VALUES
    ('East Coast Malaysia MC', 'east-coast-malaysia-mc'),
    ('Gear Seven Asia MG', 'gear-seven-asia-mg'),
    ('Hardheads Singapore MC', 'hardheads-singapore-mc'),
    ('Heaven Respect Brotherhood Motorcycle Club', 'heaven-respect-brotherhood-motorcycle-club'),
    ('Hulubalang Malacca', 'hulubalang-malacca'),
    ('I.P.O.H Malaysia', 'ipoh-malaysia'),
    ('Independent Malaysia MC', 'independent-malaysia-mc'),
    ('Jivathma Bikers Malaysia MC', 'jivathma-bikers-malaysia-mc'),
    ('Jokers Malaysia', 'jokers-malaysia'),
    ('Kepala Kuasa MG', 'kepala-kuasa-mg'),
    ('King Cobra Official MC', 'king-cobra-official-mc'),
    ('Klawar Brotherhood MG', 'klawar-brotherhood-mg'),
    ('Murka Malaysia MC', 'murka-malaysia-mc'),
    ('Muscle Riders', 'muscle-riders'),
    ('Northern Demons Malaysia MC', 'northern-demons-malaysia-mc'),
    ('Penanggal MC (Kuala Lumpur)', 'penanggal-mc-kuala-lumpur'),
    ('Postcode Seven Malaysia MC', 'postcode-seven-malaysia-mc'),
    ('Sandugo Malaysia MC', 'sandugo-malaysia-mc'),
    ('Santana Riders Malaysia MC', 'santana-riders-malaysia-mc'),
    ('SDMC South Malaysia', 'sdmc-south-malaysia'),
    ('Sedarah International MC', 'sedarah-international-mc'),
    ('Soulz Malaysia MC', 'soulz-malaysia-mc'),
    ('Southern Cartel Malaysia MC', 'southern-cartel-malaysia-mc'),
    ('Southsiders Malaya', 'southsiders-malaya'),
    ('Taikun Raiders MG', 'taikun-raiders-mg'),
    ('Violent Storm MC', 'violent-storm-mc'),
    ('WAR Malaysia', 'war-malaysia'),
    ('War Pigs Malaysia MC', 'war-pigs-malaysia-mc'),
    ('Youngster Malaysia', 'youngster-malaysia')
  ) AS v(name, slug)
  ON CONFLICT (slug) DO NOTHING;
END $$;
