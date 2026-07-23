-- 097: customers and staff_profiles both already have an updated_at column
-- but nothing was touching it on edit, so "last modified" was always stale.
-- Reuses the existing touch_updated_at() trigger function (already wired up
-- on invoices) rather than introducing a second convention.

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_staff_profiles_updated_at
  BEFORE UPDATE ON public.staff_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
