-- Enable RLS and allow public read access (incidents are public government data)
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_public_read" ON incidents
  FOR SELECT
  TO anon, authenticated
  USING (true);
