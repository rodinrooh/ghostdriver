# Ghost Driver

Maps every robotaxi crash reported to the US government via NHTSA's ADS incident database.

## Setup

### 1. Create Supabase table
Run `supabase/schema.sql` in your Supabase SQL editor.

### 2. Run scraper (one-time)
```bash
cd scraper
pip install -r requirements.txt
# Fill in .env with SUPABASE_URL and SUPABASE_KEY
python scrape.py
```

### 3. Start Next.js app
```bash
npm install
# Fill in .env.local with Supabase and Mapbox credentials
npm run dev
```

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `SUPABASE_URL` | `.env` | Supabase project URL |
| `SUPABASE_KEY` | `.env` | Supabase service role key |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_KEY` | `.env.local` | Supabase anon key |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | `.env.local` | Mapbox GL access token |

## GitHub Actions
Set `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets. The workflow runs every Sunday at midnight UTC.
