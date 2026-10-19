/* Level research: pick any spot on the road and collect what is needed to rebuild it as a game level.
   Uses the map/helpers exported by app.js on window.RoadMap. */
(() => {
  const R = window.RoadMap;
  if (!R) return;
  const { map, esc, $, state } = R;
  const commons = (...a) => R.commons(...a), thin = (l) => R.thin(l), lightbox = (l, i) => R.lightbox(l, i), lookAround = (a, b) => R.lookAround(a, b);
  const layer = L.featureGroup().addTo(map);
  const RADIUS = 500; // metres around the spot
  let current = null;

  // --- geometry helpers (local metres around the level centre) ---
  const toLocal = (lat, lon, c) => [(lon - c.lon) * 111320 * Math.cos((c.lat * Math.PI) / 180), (lat - c.lat) * 110540];
  function hull(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  // smallest rotated rectangle around a footprint -> length, width, heading
  function footprint(pts) {
    const h = hull(pts);
    let best = null;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const c = Math.cos(-ang), s = Math.sin(-ang);
      const xs = h.map((q) => q[0] * c - q[1] * s), ys = h.map((q) => q[0] * s + q[1] * c);
      const w = Math.max(...xs) - Math.min(...xs), d = Math.max(...ys) - Math.min(...ys);
      if (!best || w * d < best.area) best = { area: w * d, len: Math.max(w, d), wid: Math.min(w, d), deg: ((ang * 180) / Math.PI + 360) % 180 };
    }
    return best;
  }
  const polyArea = (pts) => Math.abs(pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const lineLen = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

  function kind(t) {
    if (t.building) return "building";
    if (t.highway) return "road";
    if (t.barrier) return "fence";
    if (t.landuse || t.leisure || t.natural) return "area";
    if (t.amenity || t.shop || t.tourism || t.man_made) return "poi";
    return "other";
  }
  const STYLE = {
    building: { color: "#ffcc80", weight: 2, fillOpacity: 0.35 },
    road: { color: "#ffffff", weight: 3, opacity: 0.9 },
    fence: { color: "#ff7043", weight: 2, dashArray: "4 4" },
    area: { color: "#aed581", weight: 1, fillOpacity: 0.15 },
    poi: { color: "#4fc3f7", weight: 2 },
    other: { color: "#bdbdbd", weight: 1 },
  };

  async function overpass(c) {
    const q = `[out:json][timeout:25];(
      way["building"](around:${RADIUS},${c.lat},${c.lon});
      way["highway"](around:${RADIUS},${c.lat},${c.lon});
      way["barrier"](around:${RADIUS},${c.lat},${c.lon});
      way["landuse"](around:${RADIUS},${c.lat},${c.lon});
      way["amenity"](around:${RADIUS},${c.lat},${c.lon});
      way["man_made"](around:${RADIUS},${c.lat},${c.lon});
      node["amenity"](around:${RADIUS},${c.lat},${c.lon});
      node["shop"](around:${RADIUS},${c.lat},${c.lon});
      node["tourism"](around:${RADIUS},${c.lat},${c.lon});
      node["man_made"](around:${RADIUS},${c.lat},${c.lon});
      node["name"](around:${RADIUS},${c.lat},${c.lon});
    );out geom tags;`;
    for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
      try {
        const r = await fetch(url, { method: "POST", body: new URLSearchParams({ data: q }) });
        if (r.ok) return (await r.json()).elements;
      } catch (e) { /* try next server */ }
    }
    throw new Error("OpenStreetMap server busy – try again in a minute");
  }

  function describe(el, c) {
    const t = el.tags || {};
    const k = kind(t);
    const geo = el.geometry ? el.geometry.map((g) => [g.lat, g.lon]) : [[el.lat, el.lon]];
    const local = geo.map(([la, lo]) => toLocal(la, lo, c).map((v) => Math.round(v * 10) / 10));
    const closed = geo.length > 3 && geo[0][0] === geo[geo.length - 1][0] && geo[0][1] === geo[geo.length - 1][1];
    const f = { id: `${el.type}/${el.id}`, kind: k, name: t["name:en"] || t.name || "", name_ar: t["name:ar"] || (t["name:en"] ? t.name : "") || "",
      type: t.building ? `building=${t.building}` : t.highway ? `highway=${t.highway}` : t.amenity ? `amenity=${t.amenity}` : t.shop ? `shop=${t.shop}` :
        t.landuse ? `landuse=${t.landuse}` : t.barrier ? `barrier=${t.barrier}` : t.man_made ? `man_made=${t.man_made}` : t.tourism ? `tourism=${t.tourism}` : "",
      tags: t, geo, local, closed };
    if (closed) {
      const pts = local.slice(0, -1);
      f.area_m2 = Math.round(polyArea(pts));
      const fp = footprint(pts);
      f.size = `${Math.round(fp.len)} × ${Math.round(fp.wid)} m`;
      f.heading = Math.round(fp.deg);
    } else if (geo.length > 1) {
      f.length_m = Math.round(lineLen(local));
    }
    // height guess for buildings (game blockout)
    if (k === "building") f.height_m = t.height ? parseFloat(t.height) : t["building:levels"] ? +t["building:levels"] * 3.5 : 4;
    return f;
  }

  function draw(features) {
    layer.clearLayers();
    features.forEach((f) => {
      const st = STYLE[f.kind] || STYLE.other;
      const label = `${esc(f.name || f.name_ar || f.type)}${f.size ? ` · ${f.size}` : f.length_m ? ` · ${f.length_m} m` : ""}`;
      let shape;
      if (f.geo.length === 1) shape = L.circleMarker(f.geo[0], { radius: 6, ...st, fillOpacity: 0.8 });
      else if (f.closed) shape = L.polygon(f.geo, st);
      else shape = L.polyline(f.geo, st);
      shape.bindTooltip(label, { sticky: true }).addTo(layer);
    });
  }

  function download(name, obj) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function nearestTown(c) {
    return state.waypoints.map((w) => ({ w, d: map.distance([w.lat, w.lon], [c.lat, c.lon]) })).sort((a, b) => a.d - b.d)[0];
  }

  async function openLevel(lat, lon, title) {
    const c = { lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6) };
    current = { c, features: [] };
    history.replaceState(null, "", `#level:${c.lat},${c.lon}`);
    if (!map.hasLayer(R.base.Satellite)) { Object.values(R.base).forEach((b) => map.removeLayer(b)); R.base.Satellite.addTo(map); }
    map.setView([c.lat, c.lon], 17, { animate: false });
    if (window.innerWidth > 760) map.panBy([210, 0], { animate: false }); // keep the spot visible beside the panel
    L.circle([c.lat, c.lon], { radius: RADIUS, color: "#f08a2c", weight: 1, fill: false, dashArray: "6 6" }).addTo(layer);
    const town = nearestTown(c);
    const km = R.kmAlong(c.lat, c.lon);
    const g = (u, t) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
    $("#detailBody").innerHTML = `
      <div class="hero-ph" style="background:#263238">🎮</div>
      <div class="dbody">
        <h2>${esc(title || "Level spot")}</h2>
        <div class="chips"><span class="chip">km ${km} on the road</span><span class="chip">${(town.d / 1000).toFixed(0)} km from ${esc(town.w.name)}</span>
          <span class="chip">${c.lat}, ${c.lon}</span></div>
        <p class="muted">Everything within ${RADIUS} m. Hover the outlines on the map for names and sizes.</p>

        <h3>Layout from OpenStreetMap</h3>
        <div id="lvlFeatures"><span class="muted">Loading buildings, roads, fences…</span></div>
        <div class="links" style="margin-top:8px">
          <a href="#" id="lvlUnity">⬇ Unity blockout JSON (metres)</a>
          <a href="#" id="lvlGeo">⬇ GeoJSON</a>
          <a href="https://www.openstreetmap.org/edit#map=18/${c.lat}/${c.lon}" target="_blank" rel="noopener">Trace missing buildings (OSM editor)</a>
        </div>

        <h3>Satellite & aerial imagery</h3>
        <div class="links">
          ${g(`https://www.google.com/maps/@${c.lat},${c.lon},300m/data=!3m1!1e3`, "Google satellite")}
          ${g(`https://earth.google.com/web/@${c.lat},${c.lon},700a,600d,35y,0h,45t,0r`, "Google Earth 3D")}
          ${g(`https://www.bing.com/maps?cp=${c.lat}~${c.lon}&lvl=18&style=a`, "Bing aerial")}
          ${g(`https://livingatlas.arcgis.com/wayback/#active=1&mapCenter=${c.lon}%2C${c.lat}%2C18`, "Esri Wayback (imagery history 2014+)")}
          ${g(`https://yandex.com/maps/?ll=${c.lon},${c.lat}&z=18&l=sat`, "Yandex satellite")}
          ${g(`https://apps.sentinel-hub.com/eo-browser/?lat=${c.lat}&lng=${c.lon}&zoom=16`, "Sentinel/Landsat (colours, seasons)")}
        </div>
        <div class="game"><b>See it in the 2000s:</b> install <b>Google Earth Pro</b> (free, desktop) → search <code>${c.lat}, ${c.lon}</code> →
          click the <b>clock icon (Historical Imagery)</b> in the toolbar → slide back to 2003–2010. Northern Saudi Arabia usually has several dated images from that decade –
          compare buildings, parking, fences and what was not built yet. Take screenshots straight down and at an angle as level reference.</div>

        <h3>Street level / dashcam</h3>
        <div class="links">${lookAround(c.lat, c.lon)}</div>
        <p class="muted">No Street View here? Try Mapillary/KartaView (dashcams of trucks and drivers), and YouTube road-trip videos of the Tapline Road (search below), then pause at this km.</p>
        <div class="links">
          ${g(`https://www.youtube.com/results?search_query=${encodeURIComponent("طريق الشمال " + town.w.name_ar + " استراحة محطة")}`, "YouTube: road videos near " + esc(town.w.name))}
          ${g(`https://www.youtube.com/results?search_query=${encodeURIComponent("Tapline road drive " + town.w.name)}`, "YouTube: Tapline road drive")}
        </div>

        <h3>Photos here and on the road nearby</h3>
        <div id="lvlPhotos" class="gallery"><span class="muted">Loading…</span></div>

        <h3>Build checklist – 2000s highway stop</h3>
        <ul class="members">
          <li>☐ Ground: gravel/sand lot, oil stains, tyre tracks; asphalt only on the highway and service road</li>
          <li>☐ Fuel canopy + 2–4 pump islands, painted kerbs, price board (Arabic numerals)</li>
          <li>☐ Small mosque / musalla with loudspeaker, ablution taps, shoe rack, carpet</li>
          <li>☐ Restaurant + bakala: plastic chairs, fluorescent tubes, fridges, posters, tea counter</li>
          <li>☐ Restrooms block behind the building, water tank on the roof</li>
          <li>☐ Tyre repair shop (بنشر) with tyre stacks; truck parking with cabs and sleeping drivers</li>
          <li>☐ Night: sodium/fluorescent lights, generator noise, wind, distant highway trucks</li>
          <li>☐ NPCs: attendant, tea maker, trucker, family car stopping to pray, herder with pickup</li>
        </ul>
        <p class="muted">More people/clothing/vehicle references: <a href="#" data-tabjump="refs">People tab</a>.</p>
      </div>`;
    $("#detail").hidden = false;

    // photos: our road photos within 3 km + live Commons around the spot
    (async () => {
      const road = state.photos.map((ph) => [ph, map.distance([c.lat, c.lon], [ph.lat, ph.lon])]).filter(([, d]) => d < 3000).sort((a, b) => a[1] - b[1]).map(([ph]) => ph);
      const live = await commons(c.lat, c.lon, 5000);
      const seen = new Set();
      const pics = thin([...road, ...live].filter((ph) => !seen.has(ph.page) && seen.add(ph.page))).slice(0, 18);
      const box = $("#lvlPhotos"); if (!box) return;
      box.innerHTML = pics.length ? "" : `<span class="muted">No geotagged photos yet – use the satellite, Google Earth history and dashcam links above.</span>`;
      pics.forEach((ph, i) => { const im = document.createElement("img"); im.src = ph.thumb; im.loading = "lazy"; im.onclick = () => lightbox(pics, i); box.appendChild(im); });
    })();

    // layout from OSM
    try {
      const els = await overpass(c);
      const feats = els.filter((e) => e.geometry || e.lat).map((e) => describe(e, c));
      current.features = feats;
      draw(feats);
      const order = ["building", "poi", "fence", "road", "area", "other"];
      const rows = feats.filter((f) => f.kind !== "other").sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
      $("#lvlFeatures").innerHTML = rows.length ? `<ul class="members">${rows.map((f) =>
        `<li><b>${esc(f.name || f.name_ar || f.type || f.kind)}</b> <span class="muted">${esc(f.kind)}${f.size ? ` · ${f.size}, ${f.area_m2} m², facing ${f.heading}°` : ""}${f.length_m ? ` · ${f.length_m} m` : ""}${f.height_m ? ` · ~${f.height_m} m high` : ""}</span></li>`).join("")}</ul>`
        : `<p class="muted">OpenStreetMap has no buildings mapped here yet. Use the satellite links and Google Earth history, or trace them yourself in the OSM editor – they'll appear here next time.</p>`;
    } catch (e) {
      $("#lvlFeatures").innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }

    $("#lvlUnity").onclick = (ev) => {
      ev.preventDefault();
      download(`level_${c.lat}_${c.lon}.json`, {
        note: "Local coordinates in metres: x = east, z = north, origin = level centre. Unity: position = new Vector3(x, 0, z). Buildings: footprint polygon + height guess.",
        origin: c, radius_m: RADIUS, source: "© OpenStreetMap contributors (ODbL)",
        features: current.features.map(({ geo, tags, ...f }) => ({ ...f, points: f.local, tags })).map(({ local, ...f }) => f),
      });
    };
    $("#lvlGeo").onclick = (ev) => {
      ev.preventDefault();
      download(`level_${c.lat}_${c.lon}.geojson`, { type: "FeatureCollection", features: current.features.map((f) => ({
        type: "Feature", properties: { id: f.id, kind: f.kind, name: f.name, ...f.tags },
        geometry: f.geo.length === 1 ? { type: "Point", coordinates: [f.geo[0][1], f.geo[0][0]] }
          : f.closed ? { type: "Polygon", coordinates: [f.geo.map(([a, b]) => [b, a])] } : { type: "LineString", coordinates: f.geo.map(([a, b]) => [b, a]) } })) });
    };
  }

  // right-click / long-press anywhere -> research as level
  map.on("contextmenu", (e) => {
    const btn = document.createElement("button");
    btn.className = "lvl-btn"; btn.textContent = "🎮 Research this spot as a game level";
    btn.onclick = () => { map.closePopup(); openLevel(e.latlng.lat, e.latlng.lng); };
    L.popup().setLatLng(e.latlng).setContent(btn).openOn(map);
  });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-level]");
    if (t) { e.preventDefault(); const [la, lo] = t.dataset.level.split(","); openLevel(la, lo, t.dataset.title); }
    const j = e.target.closest("[data-tabjump]");
    if (j) { e.preventDefault(); document.querySelector(`.tabs button[data-tab="${j.dataset.tabjump}"]`)?.click(); }
  });
  $("#detail .close").addEventListener("click", () => layer.clearLayers());

  R.openLevel = openLevel;
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("level:")) { const [la, lo] = h.slice(6).split(","); R.ready.then(() => openLevel(la, lo)); }
})();
