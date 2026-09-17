BEGIN;
CREATE TABLE IF NOT EXISTS inventory_locations(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK(kind IN ('cart','storage')),
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  shelf_count INTEGER,
  has_top BOOLEAN NOT NULL DEFAULT false,
  ros TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  updated_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_locations_name ON inventory_locations(lower(name));
CREATE INDEX IF NOT EXISTS idx_inventory_locations_zone ON inventory_locations(zone);

-- part_cost is an editable, CCC-sourced ESTIMATE (labeled as such in the UI), not a verified
-- vendor purchase cost -- CCC's LIN price fields are undocumented and, for LKQ/aftermarket
-- lines, already include a shop markup. Staff correct it when they know the real number.
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS part_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS part_qty NUMERIC NOT NULL DEFAULT 1 CHECK(part_qty>=0),
  ADD COLUMN IF NOT EXISTS part_location UUID REFERENCES inventory_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS part_shelf TEXT,
  ADD COLUMN IF NOT EXISTS part_aging_alert_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_parts_location ON parts(part_location);
COMMIT;
