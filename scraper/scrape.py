import csv
import io
import time
import requests
from supabase import create_client, Client
from dotenv import load_dotenv
import os

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

CSV_URL = "https://static.nhtsa.gov/odi/ffdd/sgo-2021-01/SGO-2021-01_Incident_Reports_ADS.csv"

TARGET_COMPANIES = ["waymo", "zoox", "motional", "avride", "aurora", "weride"]

COLUMN_MAP = {
    "Report ID": "report_id",
    "Reporting Entity": "company",
    "City": "city",
    "State": "state",
    "Incident Date": "date",
    "Incident Time (24:00)": "time",
    "Crash With": "crash_with",
    "Highest Injury Severity Alleged": "injury",
    "Narrative": "narrative",
}


def download_csv():
    print("Downloading CSV from NHTSA...")
    response = requests.get(CSV_URL, timeout=60)
    response.raise_for_status()
    print(f"Downloaded {len(response.content)} bytes.")
    # NHTSA files sometimes use latin-1; decode manually to handle BOM/encoding issues
    try:
        return response.content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return response.content.decode("latin-1")


def parse_rows(csv_text):
    reader = csv.DictReader(io.StringIO(csv_text))
    rows = []
    for row in reader:
        entity = row.get("Reporting Entity", "")
        if not any(company in entity.lower() for company in TARGET_COMPANIES):
            continue

        narrative = row.get("Narrative", "").strip()
        if not narrative or "redacted" in narrative.lower():
            continue

        record = {}
        for csv_col, db_col in COLUMN_MAP.items():
            record[db_col] = row.get(csv_col, "").strip()

        rows.append(record)

    print(f"Found {len(rows)} matching rows after filtering.")
    return rows


def geocode(city: str, state: str) -> tuple[float, float] | None:
    url = f"https://nominatim.openstreetmap.org/search?q={city},{state}&format=json&limit=1"
    try:
        response = requests.get(
            url,
            headers={"User-Agent": "GhostDriverApp/1.0"},
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()
        if data:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception as e:
        print(f"  Geocoding error for {city}, {state}: {e}")
    return None


def geocode_all(rows):
    unique_pairs = {(r["city"], r["state"]) for r in rows if r.get("city") and r.get("state")}
    coords: dict[tuple[str, str], tuple[float, float] | None] = {}

    print(f"Geocoding {len(unique_pairs)} unique city/state pairs...")
    for i, (city, state) in enumerate(unique_pairs, 1):
        print(f"  [{i}/{len(unique_pairs)}] Geocoding: {city}, {state}")
        coords[(city, state)] = geocode(city, state)
        time.sleep(1)

    for row in rows:
        key = (row.get("city", ""), row.get("state", ""))
        result = coords.get(key)
        if result:
            row["lat"], row["lng"] = result
        else:
            row["lat"] = None
            row["lng"] = None

    return rows


def upsert_to_supabase(rows):
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"Upserting {len(rows)} rows to Supabase...")
    # Supabase upsert with ignore on conflict
    result = supabase.table("incidents").upsert(rows, on_conflict="report_id", ignore_duplicates=True).execute()
    print(f"Upsert complete. {len(result.data) if result.data else 0} rows processed.")


def main():
    csv_text = download_csv()
    rows = parse_rows(csv_text)
    rows = geocode_all(rows)
    upsert_to_supabase(rows)
    print("Done!")


if __name__ == "__main__":
    main()
