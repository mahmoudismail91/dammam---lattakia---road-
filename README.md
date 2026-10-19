# Dammam → Latakia Road Map

Interactive map of the journey from **Dammam (Saudi Arabia)** to **Latakia (Syria)** – along the Tapline Road (Hwy 85) through Hafar Al-Batin, Rafha, **Arar**, Turaif and Al-Qurayyat, across Jordan (Al-Omari → Azraq → Mafraq → Jaber) and Syria (Nassib → Daraa → Damascus → Homs → Tartus → Latakia).

Reference research for the Unity project **Arar_Station**.

## What's on the map

| Layer | Source |
|-------|--------|
| Cities, borders, Tapline pump stations, landmarks, camel areas, NPC archetypes, game ideas | `data/curated.json` (hand-curated, with references) |
| Hotels, mosques, fuel, rest stops, food, shops, markets, border posts, camel-named places | `data/osm_pois.json` – OpenStreetMap, auto-updated daily |
| Road line | `data/route.geojson` – built from OSRM through `data/waypoints.json` |
| Photos | Loaded live from Wikipedia + geotagged Wikimedia Commons photos near each point |

Click any marker → photo, description, game idea, references, nearby photos (click to enlarge), Google Maps / Street View / OSM links.

## Daily updates

- **GitHub Action** `.github/workflows/daily-update.yml` runs every day: scans a few chunks of the road on OpenStreetMap (whole road every 4 days), commits new places; GitHub Pages republishes automatically. New places pulse on the map and appear in the **New** tab.
- **Claude research task** (scheduled from Claude Code) adds curated references following `docs/DAILY_TASK.md`.

Run manually: *Actions → Daily road update → Run workflow* (tick **full** for a full scan).

## One-time setup

1. *Settings → Pages → Source: **Deploy from a branch** → branch `claude/dammam-latakia-road-map-dl0y0g`, folder `/ (root)`*.
2. *Actions → Daily road update → Run workflow* with **full** + **route** ticked.
3. Site: `https://mahmoudismail91.github.io/dammam---lattakia---road-/`

## Local preview

```
python3 -m http.server 8000   # then open http://localhost:8000
python3 scripts/update.py --full --route   # fetch OSM data locally
```

## Using the data in Unity

`data/curated.json` and `data/osm_pois.json` are plain JSON (`lat`, `lon`, `cat`, `name`, `name_ar`, `km` can be computed from the route). Load with `JsonUtility`/Newtonsoft to place stops along a spline built from `route.geojson`.

Data © OpenStreetMap contributors (ODbL). Photos © their authors on Wikimedia Commons (licences shown in the viewer).
