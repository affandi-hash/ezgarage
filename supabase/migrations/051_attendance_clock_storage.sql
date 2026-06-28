-- 051: Storage bucket for attendance selfies + RLS for attendance_records

-- ── 1. Storage bucket ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attendance-selfies',
  'attendance-selfies',
  true,
  5242880,  -- 5 MB limit per photo
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Storage policies ───────────────────────────────────────────────────────
CREATE POLICY "authenticated users can upload selfies"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-selfies');

CREATE POLICY "authenticated users can view selfies"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-selfies');

-- ── 3. RLS on attendance_records ─────────────────────────────────────────────
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;

-- Staff can read their own records; managers see all in branch
CREATE POLICY "attendance_read" ON attendance_records
  FOR SELECT TO authenticated
  USING (
    staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
    OR branch_id = (SELECT branch_id FROM users WHERE id = auth.uid())
  );

-- Staff insert their own records only
CREATE POLICY "attendance_insert" ON attendance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
  );

-- Staff update their own; managers can update any in branch
CREATE POLICY "attendance_update" ON attendance_records
  FOR UPDATE TO authenticated
  USING (
    staff_id IN (SELECT id FROM staff_profiles WHERE user_id = auth.uid())
    OR branch_id = (SELECT branch_id FROM users WHERE id = auth.uid())
  );
