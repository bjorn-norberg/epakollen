"""Hämtar rikssnittet för 95 (E10) och diesel från bensinpriser.nu och skriver prices.js.

prices.js laddas med en <script>-tagg så att priset fungerar även när index.html öppnas direkt från disken.

Körs dagligen av GitHub Actions (.github/workflows/prices.yml) men går också att köra lokalt:
    python scripts/update_prices.py
"""
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

URL = "https://bensinpriser.nu/prisutveckling"
OUT = Path(__file__).resolve().parent.parent / "prices.js"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (EPAkollen price bot)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def find(html, label):
    m = re.search(r"Snittpriset för " + label + r" i Sverige är (\d{1,2},\d{2}) kr", html, re.I)
    return float(m.group(1).replace(",", ".")) if m else None


def main():
    html = fetch(URL)
    bensin = find(html, r"95 \(E10\)")
    diesel = find(html, r"diesel")
    if not bensin or not diesel:
        sys.exit("Hittade inga priser - har sidan ändrats?")
    data = {
        "bensin": bensin,
        "diesel": diesel,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "bensinpriser.nu (rikssnitt)",
    }
    OUT.write_text("window.EPA_PRICES = " + json.dumps(data, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")
    print(data)


if __name__ == "__main__":
    main()
