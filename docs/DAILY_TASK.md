# Daily research task (for Claude)

Goal: every day, add **3–8 new verified references** about the road Dammam → Latakia to `data/curated.json`, for the Unity project *Arar_Station*.

Rotate the focus by weekday:

| Day | Focus |
|-----|-------|
| Mon | Highway motels / rest houses (استراحات) on the Tapline Road between towns |
| Tue | Roadside mosques and prayer stops at fuel stations |
| Wed | Fuel & rest stations, truck stops, tea stands, small shops (bakala, tyre repair) |
| Thu | Camel areas, camel markets, herding regions, camel-crossing zones |
| Fri | Borders: Al-Haditha/Al-Omari, Jaber/Nassib – current status, procedures, photos |
| Sat | People & NPC references for the 2000s: clothing (men, women, Bedouin), travellers, drivers, shop keepers – update `data/references.json` |
| Sun | Jordan & Syria legs: the highway between Al-Omari, Azraq, Mafraq, Jaber, the M5 and the Homs–Tartus–Latakia road |

**Main focus: traveller stops** – the places travellers actually stopped at to **pray, sleep, fuel, eat, rest, use restrooms, and pass checkpoints/borders**. Prefer these over everything else, and add photos of them.

Rules
- **Only places ON the road between towns** – what a driver passes or stops at on the highway: roadside fuel stations, truck stops, rest areas, highway mosques/musallas, tea stands, tyre shops, checkpoints, toll/weigh stations, Tapline pump stations and pipeline markers, camel crossings and herds beside the road, roadside camel/livestock markets, isolated motels, abandoned buildings, signs, junctions. Nothing inside a town's `urban_km` radius (see `data/waypoints.json`) – city sights are not wanted.
- Every item needs at least one working reference URL (`refs`). Prefer Wikipedia, Wikimedia Commons, Saudi Aramco/Tapline archives, news, YouTube/documentaries, official tourism sites.
- Set `"approx": true` unless the coordinates come from a reliable map source.
- `people` entries are fictional NPC archetypes; never add private real individuals.
- Use a `wiki` field (English Wikipedia title) when an article exists – the site shows its photo automatically.
- **Pictures matter most.** For each place you add (and for older places with no photos), look for real photos of what a traveller sees there: the building, the road, the station, the shop front, the border queue. Search beyond Google Maps: Wikimedia Commons, Flickr (CC licensed), Mapillary/KartaView, news photos, travel blogs, YouTube driving videos (link with timestamp), Instagram place pages, Saudi/Jordan/Syria tourism sites. Add them as `"images": [{"u": "<image url>", "thumb": "<optional small url>", "page": "<page it came from>", "t": "<what it shows>", "credit": "<author · licence/source>"}]`. Only use direct image URLs that load; otherwise put the page in `refs`.
- Add `"added": "<today YYYY-MM-DD>"` so the site highlights it as new.
- Append one entry at the top of `data/updates.json` `log`: `{"date": "...", "kind": "curated", "note": "...", "added": [ids]}`.
- Validate JSON (`python3 -m json.tool data/curated.json`), commit and push to the branch GitHub Pages publishes from.

## People / 2000s reference boards (`data/references.json`)

The game is set in the **2000s**. Every day (not only Saturday) also improve at least one board in `data/references.json`:
- add better Commons search queries (`commons`) that return real photos of people, clothing, shops, street scenes or vehicles of that region;
- add `"images": [{"u", "thumb", "page", "t", "credit", "year"}]` with photos **taken 2000–2009** where possible (Flickr with taken-date filter, old news photos, blogs, archived forums, YouTube stills/timestamps);
- add short, factual `notes` useful for modelling NPCs (what people wore, carried, drove; what shops sold) – no stereotypes, no private individuals' names or faces from personal accounts;
- new boards are welcome (e.g. children, police/army uniforms, prayer at roadside mosques, food).
