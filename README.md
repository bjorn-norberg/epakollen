# EPAkollen

Webbapp (PWA) som räknar ut restid, ankomsttid och bränslekostnad för en EPA-traktor.
30 km/h, rutt utan motorväg och motortrafikled.

## Tjänster som används (gratis, ingen API-nyckel)
- **Rutt:** Valhalla (valhalla1.openstreetmap.de), profil `motor_scooter` som följer mopedregler
- **Platssök / min position:** Photon (photon.komoot.io)
- **Karta:** Esri Dark Gray via Leaflet – fungerar även när filen öppnas direkt från disken
- **Bränslepris:** rikssnitt från bensinpriser.nu, sparat i `prices.js`

## Lägga upp den (krävs för att kunna installera på mobilen)
Installation som app och "Min plats" kräver https. Enklast är GitHub Pages:

1. Skapa ett repo på GitHub och ladda upp innehållet i den här mappen.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Settings → Actions → General → Workflow permissions → "Read and write".
4. Workflowen `.github/workflows/prices.yml` uppdaterar `prices.js` två gånger per dag.

Installera på mobilen: öppna sidan → Dela → "Lägg till på hemskärmen" (iPhone) eller
menyn → "Installera app" (Android).

## Köra lokalt
```
python -m http.server 8765
```
Öppna http://localhost:8765. Uppdatera priser manuellt: `python scripts/update_prices.py`.
