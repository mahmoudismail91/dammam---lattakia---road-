#!/usr/bin/env python3
"""Collect photos taken ALONG the road (not only at named places) into data/photos.json.

Sources (all free):
- Wikimedia Commons  – geotagged photos within PHOTO_CORRIDOR_KM of the road (no key)
- Panoramax          – open street-level imagery (no key)
- KartaView          – open street-level / dashcam imagery (no key)
- Mapillary          – street-level / dashcam imagery, only if env MAPILLARY_TOKEN is set
                       (free client token from https://www.mapillary.com/dashboard/developers)

Standard library only. Every source is optional: failures are logged and skipped.
"""
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update import DATA, densify, haversine, http, in_town, load, route_line, save  # noqa: E402

PHOTO_CORRIDOR_KM = 0.8     # Commons photos must be this close to the road
COMMONS_STEP_KM = 15        # Commons query spacing (radius 10 km)
STREET_STEP_KM = 8          # street-level query spacing
MAX_COMMONS_PER_SAMPLE = 10


# satellite / space-station / aerial shots are useless as ground references
NOT_GROUND = re.compile(r"\b(iss\s?-?\d{2,3}|iss\d|international space station|space station|expedition\s?\d+|from space|from orbit|in orbit|satellite|landsat|sentinel[- ]?\d|modis|copernicus|earth observ\w*|earth from|nasa|esa|jaxa|roscosmos|astronaut\w*|cosmonaut\w*|aerial|bird'?s[- ]eye|planet labs|worldview|google earth|airliner|from (an |the )?(aircraft|airplane|plane)|window seat)\b", re.I)


def is_ground(title, m):
    text = " | ".join([title] + [str(m.get(k, {}).get("value", "")) for k in ("Categories", "Artist", "ImageDescription", "Credit")])
    return not NOT_GROUND.search(text)


def strip(h):
    return re.sub(r"<[^>]+>", "", h or "").strip()


def year_of(text):
    m = re.search(r"\b(19[5-9]\d|20[0-2]\d)\b", text or "")
    return int(m.group(1)) if m else 0


def commons_get(url):
    """Wikimedia rate-limits bursts (HTTP 429): wait and retry instead of skipping."""
    for wait in (0, 30, 90):
        time.sleep(wait)
        try:
            return http(url, timeout=60)
        except Exception as e:
            if "429" not in str(e):
                raise
            print(f"  commons busy (429), waiting {wait or 30}s", file=sys.stderr)
    raise RuntimeError("commons still rate-limited")


def commons(line, start=0, count=None):
    """line: route densified to ~0.5 km. Query every COMMONS_STEP_KM, keep photos close to the road.
    Only `count` samples from sample number `start` (wrapping), so the sweep is spread over several runs."""
    out = []
    step = COMMONS_STEP_KM * 2
    idx = list(range(0, len(line), step))
    count = count or len(idx)
    for i in [idx[(start + k) % len(idx)] for k in range(min(count, len(idx)))]:
        if out_of_time():
            break
        lon, lat = line[i]
        nearby = line[max(0, i - 50):i + 50]  # ~±25 km of road around the sample
        q = urllib.parse.urlencode({
            "action": "query", "generator": "geosearch", "ggscoord": f"{lat}|{lon}", "ggsradius": 10000,
            "ggsnamespace": 6, "ggslimit": 100, "prop": "imageinfo|coordinates",
            "iiprop": "url|extmetadata", "iiurlwidth": 640, "format": "json"})
        try:
            pages = commons_get("https://commons.wikimedia.org/w/api.php?" + q).get("query", {}).get("pages", {})
        except Exception as e:
            print(f"  commons {i}: {e}", file=sys.stderr)
            continue
        kept = 0
        for pg in pages.values():
            if not re.search(r"\.(jpe?g|png|webp)$", pg["title"], re.I) or "coordinates" not in pg or not pg.get("imageinfo"):
                continue
            c = pg["coordinates"][0]
            if min(haversine(p, [c["lon"], c["lat"]]) for p in nearby) > PHOTO_CORRIDOR_KM:
                continue
            ii, m = pg["imageinfo"][0], pg["imageinfo"][0].get("extmetadata", {})
            if not is_ground(pg["title"], m):
                continue
            out.append({
                "id": f"commons:{pg['pageid']}", "src": "commons", "lat": round(c["lat"], 6), "lon": round(c["lon"], 6),
                "thumb": ii.get("thumburl"), "full": ii.get("thumburl"), "page": ii.get("descriptionurl"),
                "title": pg["title"][5:].rsplit(".", 1)[0],
                "credit": f"{strip(m.get('Artist', {}).get('value')) or 'Unknown'} · {strip(m.get('LicenseShortName', {}).get('value'))} · Wikimedia Commons",
                "date": strip(m.get("DateTimeOriginal", {}).get("value"))[:40],
                "year": year_of(strip(m.get("DateTimeOriginal", {}).get("value"))),
            })
            kept += 1
            if kept >= MAX_COMMONS_PER_SAMPLE:
                break
        time.sleep(2)  # stay well under Wikimedia's rate limit
    return out


def bbox(lon, lat, d=0.006):
    return lon - d, lat - d, lon + d, lat + d


def panoramax(samples):
    out = []
    for lon, lat in samples:
        a, b, c, d = bbox(lon, lat, 0.01)
        try:
            feats = http(f"https://api.panoramax.xyz/api/search?bbox={a},{b},{c},{d}&limit=1", timeout=30).get("features", [])
        except Exception as e:
            print(f"  panoramax: {e}", file=sys.stderr)
            return out  # service down -> skip the rest
        for f in feats:
            x, y = f["geometry"]["coordinates"][:2]
            assets = f.get("assets", {})
            thumb = (assets.get("thumb") or assets.get("sd") or {}).get("href")
            if not thumb:
                continue
            out.append({
                "id": f"panoramax:{f['id']}", "src": "panoramax", "lat": round(y, 6), "lon": round(x, 6),
                "thumb": thumb, "full": (assets.get("sd") or assets.get("hd") or {}).get("href", thumb),
                "page": f"https://api.panoramax.xyz/#focus=pic&pic={f['id']}",
                "title": "Street-level photo", "credit": f"{f.get('properties', {}).get('geovisio:producer', 'Panoramax')} · Panoramax",
                "date": (f.get("properties", {}).get("datetime") or "")[:10],
            })
        time.sleep(0.3)
    return out


def kartaview(samples, radius=600, per_point=1):
    out = []
    for lon, lat in samples:
        try:
            res = http(f"https://api.openstreetcam.org/2.0/photo/?lat={lat}&lng={lon}&radius={radius}&itemsPerPage={per_point}", timeout=30)
        except Exception as e:
            print(f"  kartaview: {e}", file=sys.stderr)
            return out
        for p in (res.get("result") or {}).get("data") or []:
            thumb = p.get("fileurlLTh") or p.get("fileurlTh") or p.get("fileurlProc")
            if not thumb:
                continue
            out.append({
                "id": f"kartaview:{p['id']}", "src": "kartaview", "lat": round(float(p["lat"]), 6), "lon": round(float(p["lng"]), 6),
                "thumb": thumb, "full": p.get("fileurlProc") or thumb,
                "page": f"https://kartaview.org/details/{p.get('sequenceId')}/{p.get('sequenceIndex')}",
                "title": "Dashcam photo", "credit": "KartaView contributors (CC BY-SA)",
                "date": (p.get("shotDate") or p.get("dateAdded") or "")[:10],
            })
        time.sleep(0.3)
    return out


TIME_BUDGET_S = 20 * 60   # stop cleanly before the workflow's 25-minute step limit
SWEEP_SAMPLES_PER_RUN = 40   # general Commons sweep: this many samples per run, continuing next run
_T0 = time.time()


def out_of_time():
    return time.time() - _T0 > TIME_BUDGET_S


STOP_CATS = {"fuel", "mosque", "food", "hotel", "rest", "wc", "shop", "check", "border"}
STOPS_PER_RUN = 90          # traveller stops searched individually per run
RECHECK_DAYS = 14


def traveller_stops(wps):
    """Group roadside places into stops (same idea as the site) + curated levels/stops. Returns [(key, lat, lon, priority)]."""
    pois = [p for p in load("osm_pois.json", {"items": []})["items"] if p["cat"] in STOP_CATS]
    pois.sort(key=lambda p: (p["lat"], p["lon"]))
    groups = []
    for p in pois:
        for g in groups:
            if any(haversine([m["lon"], m["lat"]], [p["lon"], p["lat"]]) < 0.6 for m in g):
                g.append(p)
                break
        else:
            groups.append([p])
    stops = []
    for g in groups:
        lat = sum(m["lat"] for m in g) / len(g)
        lon = sum(m["lon"] for m in g) / len(g)
        stops.append((f"{lat:.3f},{lon:.3f}", lat, lon, len({m["cat"] for m in g})))
    for c in load("curated.json", {"items": []})["items"]:
        if c["cat"] in STOP_CATS | {"level", "station"}:
            prio = 100 if c["cat"] == "level" else 3
            stops.append((f"{c['lat']:.3f},{c['lon']:.3f}", c["lat"], c["lon"], prio))
    return stops


def stop_photos(stops, token, today):
    """Search right at each stop (KartaView 300 m, Commons 1 km, Mapillary 300 m) – rotating, so all stops get covered."""
    status = load("photo_status.json", {"stops": {}})
    st = status["stops"]
    def due(k):
        last = st.get(k, {}).get("checked")
        return not last or (dt.date.fromisoformat(today) - dt.date.fromisoformat(last)).days >= RECHECK_DAYS
    todo = sorted((s for s in stops if due(s[0])), key=lambda s: (-s[3], st.get(s[0], {}).get("checked", "")))[:STOPS_PER_RUN]
    print(f"traveller stops: {len(stops)}, searching {len(todo)} this run")
    out = []
    for n, (key, lat, lon, _) in enumerate(todo):
        if out_of_time():
            print(f"  time budget reached after {n} stops – the next run continues")
            break
        found = []
        q = urllib.parse.urlencode({
            "action": "query", "generator": "geosearch", "ggscoord": f"{lat}|{lon}", "ggsradius": 1000,
            "ggsnamespace": 6, "ggslimit": 20, "prop": "imageinfo|coordinates",
            "iiprop": "url|extmetadata", "iiurlwidth": 640, "format": "json"})
        try:
            pages = commons_get("https://commons.wikimedia.org/w/api.php?" + q).get("query", {}).get("pages", {})
            for pg in pages.values():
                if not re.search(r"\.(jpe?g|png|webp)$", pg["title"], re.I) or "coordinates" not in pg or not pg.get("imageinfo"):
                    continue
                ii, m = pg["imageinfo"][0], pg["imageinfo"][0].get("extmetadata", {})
                if not is_ground(pg["title"], m):
                    continue
                c = pg["coordinates"][0]
                found.append({
                    "id": f"commons:{pg['pageid']}", "src": "commons", "lat": round(c["lat"], 6), "lon": round(c["lon"], 6),
                    "thumb": ii.get("thumburl"), "full": ii.get("thumburl"), "page": ii.get("descriptionurl"),
                    "title": pg["title"][5:].rsplit(".", 1)[0],
                    "credit": f"{strip(m.get('Artist', {}).get('value')) or 'Unknown'} · {strip(m.get('LicenseShortName', {}).get('value'))} · Wikimedia Commons",
                    "date": strip(m.get("DateTimeOriginal", {}).get("value"))[:40],
                    "year": year_of(strip(m.get("DateTimeOriginal", {}).get("value"))),
                })
        except Exception as e:
            print(f"  commons @ {key}: {e}", file=sys.stderr)
        time.sleep(2)
        found += kartaview([(lon, lat)], radius=300, per_point=3)
        if token:
            found += mapillary([(lon, lat)], token)
        st[key] = {"checked": today, "found": len(found)}
        out += found
        if n % 10 == 9:
            save("photo_status.json", status)
    save("photo_status.json", status)
    print(f"  stop photos found: {len(out)}; stops still without any: {sum(1 for v in st.values() if not v['found'])}")
    return out


def mapillary(samples, token):
    out = []
    fields = "id,thumb_1024_url,thumb_256_url,computed_geometry,geometry,captured_at,creator"
    for lon, lat in samples:
        a, b, c, d = bbox(lon, lat)
        url = (f"https://graph.mapillary.com/images?access_token={token}&fields={fields}"
               f"&bbox={a},{b},{c},{d}&limit=1")
        try:
            data = http(url, timeout=30).get("data", [])
        except Exception as e:
            print(f"  mapillary: {e}", file=sys.stderr)
            continue
        for p in data:
            g = (p.get("computed_geometry") or p.get("geometry"))["coordinates"]
            when = dt.datetime.utcfromtimestamp(p["captured_at"] / 1000).date().isoformat() if p.get("captured_at") else ""
            out.append({
                "id": f"mapillary:{p['id']}", "src": "mapillary", "lat": round(g[1], 6), "lon": round(g[0], 6),
                "thumb": p.get("thumb_256_url") or p.get("thumb_1024_url"), "full": p.get("thumb_1024_url"),
                "page": f"https://www.mapillary.com/app/?pKey={p['id']}",
                "title": "Street-level photo", "credit": f"{(p.get('creator') or {}).get('username', 'Mapillary user')} · Mapillary (CC BY-SA)",
                "date": when,
            })
        time.sleep(0.2)
    return out


def main():
    today = dt.date.today().isoformat()
    line = route_line()
    dense = densify(line, 1.0)
    wps = load("waypoints.json", {})["waypoints"]
    street_samples = [p for p in dense[::STREET_STEP_KM] if not in_town(p[1], p[0], wps)]
    print(f"route ~{len(dense)} km; {len(street_samples)} street-level samples")
    token = os.environ.get("MAPILLARY_TOKEN", "").strip()

    # 1) priority: photos right at traveller stops (saved immediately)
    save_found(stop_photos(traveller_stops(wps), token, today), today, token)

    # 2) general sweep along the road, a slice per run
    status = load("photo_status.json", {"stops": {}})
    start = status.get("sweep_next", 0)
    found = commons(densify(line, 0.5), start, SWEEP_SAMPLES_PER_RUN)
    status = load("photo_status.json", {"stops": {}})
    status["sweep_next"] = start + SWEEP_SAMPLES_PER_RUN
    save("photo_status.json", status)
    print(f"commons sweep (samples {start}–{start + SWEEP_SAMPLES_PER_RUN}): {len(found)}")
    for name, fn in (("panoramax", panoramax), ("kartaview", kartaview)):
        if out_of_time():
            break
        got = fn(street_samples)
        print(f"{name}: {len(got)}")
        found += got
    if token and not out_of_time():
        got = mapillary(street_samples, token)
        print(f"mapillary: {len(got)}")
        found += got
    elif not token:
        print("mapillary: skipped (no MAPILLARY_TOKEN secret)")
    save_found(found, today, token)


def save_found(found, today, token):
    """Merge newly found photos into data/photos.json (thinned, roadside only) and log them in updates.json."""
    old = {p["id"]: p for p in load("photos.json", {"items": []})["items"]}
    # Mapillary thumbnail links expire: keep only ones refreshed within the last 14 days
    old = {k: v for k, v in old.items() if v["src"] != "mapillary" or
           (dt.date.fromisoformat(today) - dt.date.fromisoformat(v.get("last_seen", today))).days <= 14}
    old = {k: v for k, v in old.items() if not NOT_GROUND.search(f"{v.get('title', '')} | {v.get('credit', '')}")}
    added = []
    for p in found:
        p["first_seen"] = old.get(p["id"], {}).get("first_seen", today)
        p["last_seen"] = today
        if p["id"] not in old:
            added.append(p["id"])
        old[p["id"]] = p
    # dashcam uploads come as long near-identical series: keep one per uploader per 2 km, none within 150 m
    def author(p):
        return p.get("credit", "").split(" · ")[0]
    thinned = []
    for p in sorted(old.values(), key=lambda p: (p.get("first_seen", today), p["id"])):
        if any(haversine([k["lon"], k["lat"]], [p["lon"], p["lat"]]) < 0.15 or
               (author(k) == author(p) and haversine([k["lon"], k["lat"]], [p["lon"], p["lat"]]) < 2) for k in thinned):
            continue
        thinned.append(p)
    old = {p["id"]: p for p in thinned}
    added = [i for i in added if i in old]

    # only the road between towns, not photos inside the cities
    wps = load("waypoints.json", {})["waypoints"]
    levels = [(c["lat"], c["lon"]) for c in load("curated.json", {"items": []})["items"] if c["cat"] == "level"]
    def keep(p):  # roadside only – but always keep photos around a game level
        return not in_town(p["lat"], p["lon"], wps) or any(haversine([lo, la], [p["lon"], p["lat"]]) < 2 for la, lo in levels)
    items = sorted((p for p in old.values() if keep(p)), key=lambda p: p["id"])
    added = [i for i in added if keep(old[i])]
    save("photos.json", {"updated": today, "items": items})

    updates = load("updates.json", {"log": []})
    prev = next((u for u in updates["log"] if u.get("date") == today and u.get("kind") == "photos"), None)
    if prev:  # second save of the same run/day: extend today's entry
        added = list(dict.fromkeys(prev.get("added", []) + added))
    updates["log"] = [u for u in updates["log"] if u is not prev]
    if added:
        updates["log"].insert(0, {"date": today, "kind": "photos", "added": added[:400], "added_count": len(added),
                                  "note": f"{len(added)} new road photos"})
    save("updates.json", updates)
    print(f"photos: {len(items)} total, {len(added)} new")


if __name__ == "__main__":
    main()
