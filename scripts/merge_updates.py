#!/usr/bin/env python3
"""Merge this run's entries of data/updates.json into the latest version from the branch.

Usage: merge_updates.py <ours.json> <theirs.json> > merged.json
Entries are keyed by (date, kind); for osm/photos entries ours wins (the scan owns them),
everything else (e.g. daily research "curated" entries) is kept from theirs.
"""
import json
import sys

ours = json.load(open(sys.argv[1], encoding="utf-8"))["log"]
theirs = json.load(open(sys.argv[2], encoding="utf-8"))["log"]
scan_kinds = {"osm", "photos"}
mine = {(u.get("date"), u.get("kind")): u for u in ours if u.get("kind") in scan_kinds}
merged = [mine.pop((u.get("date"), u.get("kind")), u) if u.get("kind") in scan_kinds else u for u in theirs]
merged = list(mine.values()) + merged  # brand-new scan entries go on top
merged.sort(key=lambda u: u.get("date", ""), reverse=True)  # stable: keeps order within a day
json.dump({"log": merged[:120]}, sys.stdout, ensure_ascii=False, indent=1)
print()
