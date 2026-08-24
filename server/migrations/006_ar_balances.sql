CREATE TABLE IF NOT EXISTS ar_balances (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ar_ro_number       TEXT,
  ar_customer_name   TEXT,
  ar_vehicle         TEXT,
  ar_amount          NUMERIC(10,2),
  ar_terms           TEXT,
  ar_entry_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  ar_due_date        DATE GENERATED ALWAYS AS (
                        ar_entry_date + CASE ar_terms
                          WHEN 'Net 10' THEN 10
                          WHEN 'Net 30' THEN 30
                          ELSE 0
                        END
                      ) STORED,
  ar_status          TEXT NOT NULL DEFAULT 'Open',
  ar_paid_date       DATE,
  ar_notes           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by         TEXT,
  updated_by         TEXT
);
CREATE INDEX IF NOT EXISTS idx_ar_status ON ar_balances (ar_status);
CREATE INDEX IF NOT EXISTS idx_ar_due ON ar_balances (ar_due_date);
