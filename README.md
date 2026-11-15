# EPAkollen

Webbapp (PWA) som räknar ut rutt, restid, ankomsttid och bränslekostnad för EPA-traktor,
A-traktor (30 km/h) och mopedbil (45 km/h). Rutten undviker motorväg och motortrafikled.
Du kan välja mellan två vägval (kortast och lugnast), spara Hem och Skolan, och dela resan som en länk.

Adress: **https://epa.junestaden.se**

## Tjänster som används (gratis, ingen API-nyckel)
- **Rutt:** Valhalla (valhalla1.openstreetmap.de), profil `motor_scooter` som följer mopedregler
- **Platssök / min position:** Photon (photon.komoot.io)
- **Karta:** Esri Dark Gray via Leaflet, fungerar även när filen öppnas direkt från disken
- **Bränslepris:** rikssnitt från bensinpriser.nu, sparat i `prices.js`

## Publicering
Sidan serveras av **Cloudflare Pages** (projektet `epakollen`) och publiceras automatiskt vid varje push till `main`.
Ingen build: rotmappen är utdata. Installation som app och "Min plats" kräver https, vilket Cloudflare ger.

Workflowen `.github/workflows/prices.yml` uppdaterar `prices.js` två gånger per dag.
Den kräver att Settings → Actions → General → Workflow permissions är "Read and write".
Filen `CNAME` är en rest från GitHub Pages och används inte av Cloudflare.

Installera på mobilen: öppna sidan → Dela → "Lägg till på hemskärmen" (iPhone) eller
menyn → "Installera app" (Android).

## Köra lokalt
```
python -m http.server 8765
```
Öppna http://localhost:8765. Uppdatera priser manuellt: `python scripts/update_prices.py`.
Höj `CACHE` i `sw.js` när du ändrar appens filer, annars visar installerade appar den gamla versionen.
