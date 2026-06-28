-- Migration 018: Add source column to bookings (to distinguish staff vs online public bookings)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'staff'
  CHECK (source IN ('staff', 'online', 'whatsapp', 'phone'));
