#!/usr/bin/env python3
"""Daily updater for the Dammam -> Latakia road map.

1. Builds data/route.geojson from data/waypoints.json using the public OSRM router
   (only if missing, or with --route).
2. Queries OpenStreetMap (Overpass API) for hotels, mosques, fuel stations, rest
   areas, food, shops, markets, border posts and camel-related places within a
   corridor along the road. Each run scans a few route chunks (rotating daily), so
   the whole road is re-scanned every few days. --full scans everything.
3. Merges results into data/osm_pois.json and appends a summary to data/updates.json.

Standard library only.
"""
import argparse
import datetime as dt
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
UA = "dammam-latakia-road-map/1.0 (github.com/mahmoudismail91/dammam---lattakia---road-)"
OSRM = "https://router.project-osrm.org/route/v1/driving/"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

CHUNKS = 16           # route split into this many pieces
CHUNKS_PER_RUN = 4    # pieces scanned per daily run -> full pass every 4 days
CORRIDOR_M = 2000     # distance from the road to search
MAX_PER_CAT_CHUNK = 80


def load(name, default):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def save(name, obj):
    with open(os.path.join(DATA, name), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")


def http(url, data=None, timeout=200):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def haversine(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[1], a[0], b[1], b[0]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def simplify(points, tol):
    """Douglas-Peucker on [lon, lat] points, tol in degrees."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = points[s]
        bx, by = points[e]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, None
        for i in range(s + 1, e):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol:
            keep[idx] = True
            stack += [(s, idx), (idx, e)]
    return [p for p, k in zip(points, keep) if k]


def build_route():
    wps = load("waypoints.json", {})["waypoints"]
    coords = ";".join(f"{w['lon']},{w['lat']}" for w in wps)
    res = http(OSRM + coords + "?overview=full&geometries=geojson", timeout=120)
    line = res["routes"][0]["geometry"]["coordinates"]
    line = simplify(line, 0.002)
    km = res["routes"][0]["distance"] / 1000
    save("route.geojson", {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "properties": {"source": "OSRM / OpenStreetMap", "km": round(km),
                                                         "built": dt.date.today().isoformat()},
                      "geometry": {"type": "LineString", "coordinates": line}}],
    })
    print(f"route: {len(line)} points, {km:.0f} km")


def route_line():
    r = load("route.geojson", None)
    if r:
        return r["features"][0]["geometry"]["coordinates"]
    return [[w["lon"], w["lat"]] for w in load("waypoints.json", {})["waypoints"]]


def densify(line, step_km=4.0):
    out = [line[0]]
    for a, b in zip(line, line[1:]):
        n = max(1, int(haversine(a, b) // step_km))
        for i in range(1, n + 1):
            out.append([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n])
    return out


QUERY = """
[out:json][timeout:180];
(
  nwr["tourism"~"^(hotel|motel|guest_house|hostel|apartment|chalet)$"]{A};
  nwr["amenity"="place_of_worship"]["religion"="muslim"]{A};
  nwr["building"="mosque"]{A};
  nwr["amenity"="fuel"]{A};
  nwr["highway"~"^(rest_area|services)$"]{A};
  nwr["amenity"~"^(restaurant|cafe|fast_food)$"]{A};
  nwr["shop"]["name"]{A};
  nwr["amenity"="marketplace"]{A};
  nwr["barrier"="border_control"]{A};
  nwr["name"~"camel|إبل|الابل|جمال|هجن|حلال",i]{A};
  nwr["historic"]["name"]{A};
  nwr["railway"="station"]{A};
);
out center tags;
"""


def classify(t):
    name = (t.get("name", "") + " " + t.get("name:en", "")).lower()
    if any(k in name for k in ("camel", "إبل", "الابل", "جمال", "هجن")):
        return "camel"
    if t.get("barrier") == "border_control":
        return "border"
    if "tourism" in t:
        return "hotel"
    if t.get("amenity") == "place_of_worship" or t.get("building") == "mosque":
        return "mosque"
    if t.get("amenity") == "fuel":
        return "fuel"
    if t.get("highway") in ("rest_area", "services"):
        return "rest"
    if t.get("amenity") in ("restaurant", "cafe", "fast_food"):
        return "food"
    if t.get("amenity") == "marketplace" or "shop" in t:
        return "shop"
    if t.get("railway") == "station":
        return "station"
    if "historic" in t:
        return "landmark"
    return None


def overpass(points):
    around = "(around:%d,%s)" % (CORRIDOR_M, ",".join(f"{p[1]:.5f},{p[0]:.5f}" for p in points))
    q = QUERY.replace("{A}", around)
    body = urllib.parse.urlencode({"data": q}).encode()
    last = None
    for attempt in range(4):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            return http(url, data=body)["elements"]
        except Exception as e:  # rate limit / timeout -> back off and retry
            last = e
            print(f"  overpass error ({url}): {e}; retrying", file=sys.stderr)
            time.sleep(20 * (attempt + 1))
    raise last


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="scan the whole route")
    ap.add_argument("--route", action="store_true", help="rebuild route.geojson")
    args = ap.parse_args()
    today = dt.date.today().isoformat()

    if args.route or not os.path.exists(os.path.join(DATA, "route.geojson")):
        try:
            build_route()
        except Exception as e:
            print(f"route build failed, using waypoint line: {e}", file=sys.stderr)

    pois = load("osm_pois.json", {"items": []})
    by_id = {p["id"]: p for p in pois["items"]}
    full = args.full or not by_id

    line = densify(route_line())
    size = math.ceil(len(line) / CHUNKS)
    chunks = [line[i:i + size + 1] for i in range(0, len(line), size)]
    if full:
        todo = list(range(len(chunks)))
    else:
        start = (dt.date.today().toordinal() * CHUNKS_PER_RUN) % len(chunks)
        todo = [(start + i) % len(chunks) for i in range(CHUNKS_PER_RUN)]

    added, seen = [], 0
    for ci in todo:
        pts = chunks[ci][::2] + [chunks[ci][-1]]
        print(f"chunk {ci + 1}/{len(chunks)} ({len(pts)} pts)")
        try:
            elements = overpass(pts)
        except Exception as e:
            print(f"  skipped chunk {ci}: {e}", file=sys.stderr)
            continue
        per_cat = {}
        # named places first so the per-category cap keeps the interesting ones
        elements.sort(key=lambda e: 0 if e.get("tags", {}).get("name") else 1)
        for el in elements:
            t = el.get("tags", {})
            cat = classify(t)
            if not cat:
                continue
            per_cat[cat] = per_cat.get(cat, 0) + 1
            if per_cat[cat] > MAX_PER_CAT_CHUNK:
                continue
            lat = el.get("lat", el.get("center", {}).get("lat"))
            lon = el.get("lon", el.get("center", {}).get("lon"))
            if lat is None:
                continue
            pid = f"osm:{el['type']}/{el['id']}"
            seen += 1
            item = {
                "id": pid, "cat": cat,
                "name": t.get("name:en") or t.get("name") or "",
                "name_ar": t.get("name:ar") or (t.get("name") if t.get("name:en") else ""),
                "lat": round(lat, 6), "lon": round(lon, 6),
                "tags": {k: v for k, v in t.items() if k in (
                    "tourism", "amenity", "shop", "highway", "brand", "operator", "opening_hours",
                    "phone", "website", "wikipedia", "wikidata", "image", "stars", "cuisine", "historic", "barrier")},
            }
            if pid in by_id:
                item["first_seen"] = by_id[pid].get("first_seen", today)
            else:
                item["first_seen"] = today
                added.append(pid)
            item["last_seen"] = today
            by_id[pid] = item
        time.sleep(5)

    items = sorted(by_id.values(), key=lambda p: p["id"])
    save("osm_pois.json", {"source": "© OpenStreetMap contributors (ODbL)", "updated": today, "items": items})

    updates = load("updates.json", {"log": []})
    counts = {}
    for p in items:
        counts[p["cat"]] = counts.get(p["cat"], 0) + 1
    updates["log"] = [u for u in updates["log"] if u.get("date") != today or u.get("kind") != "osm"]
    updates["log"].insert(0, {"date": today, "kind": "osm", "chunks": [c + 1 for c in todo],
                              "seen": seen, "added": added[:400], "added_count": len(added),
                              "totals": counts})
    updates["log"] = updates["log"][:120]
    save("updates.json", updates)
    print(f"done: {len(items)} POIs, {len(added)} new")


if __name__ == "__main__":
    main()
