# Biobank Scanner (offline-first PWA)

- **Picklist mode:** Validate scans against a JSON picklist and show expected slot.
- **Free-scan mode:** Record barcodes without a picklist (with optional location context).
- **Offline-first:** Service worker + IndexedDB. Export CSV later.

## Use
1. Open the site once online, then **Add to Home Screen** (iOS/Android).
2. Optional: Load a picklist via the file picker (`picklist.sample.json` format).
3. Tap **Start scanner**, scan 2D DataMatrix barcodes on tube bottoms.
4. Tap **Download CSV** to export logs.

## Fields in CSV
`timestamp, tube_id, mode, result, freezer, rack, box, pos, picklist_id, operator, device`

## Deploy on GitHub Pages
- Create a new repo and add these files at the root.
- Settings → Pages → Deploy from branch → `main` → root (`/`).
- Visit the Pages URL. First load caches the app for offline use.

## Notes
- Uses the browser **BarcodeDetector** API (simple & offline). If your device lacks DataMatrix support, consider adding a ZXing fallback later.
- Keep PHI out of picklists. Use tube IDs only.
