# Daily research task (for Claude)

Goal: every day, add **3–8 new verified references** about the road Dammam → Latakia to `data/curated.json`, for the Unity project *Arar_Station*.

Rotate the focus by weekday:

| Day | Focus |
|-----|-------|
| Mon | Hotels / furnished apartments / motels on the Tapline Road (Hafar Al-Batin, Rafha, Arar, Turaif, Qurayyat) |
| Tue | Mosques (roadside & historic), prayer stops |
| Wed | Fuel & rest stations, truck stops, tea stands, small shops (bakala, tyre repair) |
| Thu | Camel areas, camel markets, herding regions, camel-crossing zones |
| Fri | Borders: Al-Haditha/Al-Omari, Jaber/Nassib – current status, procedures, photos |
| Sat | People & NPC references: drivers, herders, Tapline history, oral histories, documentaries |
| Sun | Jordan & Syria legs: Azraq, Mafraq, Daraa, Damascus, Homs, Tartus, Latakia |

Rules
- Every item needs at least one working reference URL (`refs`). Prefer Wikipedia, Wikimedia Commons, Saudi Aramco/Tapline archives, news, YouTube/documentaries, official tourism sites.
- Set `"approx": true` unless the coordinates come from a reliable map source.
- `people` entries are fictional NPC archetypes; never add private real individuals.
- Use a `wiki` field (English Wikipedia title) when an article exists – the site shows its photo automatically.
- Add `"added": "<today YYYY-MM-DD>"` so the site highlights it as new.
- Append one entry at the top of `data/updates.json` `log`: `{"date": "...", "kind": "curated", "note": "...", "added": [ids]}`.
- Validate JSON (`python3 -m json.tool data/curated.json`), commit and push to the branch GitHub Pages publishes from.
