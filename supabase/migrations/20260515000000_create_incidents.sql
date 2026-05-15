CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  report_id TEXT UNIQUE NOT NULL,
  company TEXT,
  city TEXT,
  state TEXT,
  date TEXT,
  time TEXT,
  crash_with TEXT,
  injury TEXT,
  narrative TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_incidents_company ON incidents(company);
CREATE INDEX IF NOT EXISTS idx_incidents_date ON incidents(date);
