/* Dammam -> Latakia road map */
(() => {
  const CATS = {
    city:     { label: "Cities & towns", icon: "🏙️", color: "#c97b2b" },
    border:   { label: "Borders",        icon: "🛂", color: "#c0392b" },
    station:  { label: "Stations",       icon: "🏭", color: "#6d4c41" },
    fuel:     { label: "Fuel stations",  icon: "⛽", color: "#e67e22" },
    rest:     { label: "Rest stops",     icon: "🅿️", color: "#7f8c8d" },
    hotel:    { label: "Hotels",         icon: "🏨", color: "#2980b9" },
    mosque:   { label: "Mosques",        icon: "🕌", color: "#16a085" },
    shop:     { label: "Shops & souqs",  icon: "🛒", color: "#8e44ad" },
    food:     { label: "Food & tea",     icon: "🍽️", color: "#d35400" },
    camel:    { label: "Camel areas",    icon: "🐪", color: "#b8860b" },
    landmark: { label: "Landmarks",      icon: "🏛️", color: "#34495e" },
    people:   { label: "People / NPCs",  icon: "🧍", color: "#e84393" },
  };
  const FLAGS = { SA: "🇸🇦", JO: "🇯🇴", SY: "🇸🇾", "SA/JO": "🇸🇦🇯🇴", "JO/SY": "🇯🇴🇸🇾" };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const today = new Date();
  const daysAgo = (d) => d ? (today - new Date(d)) / 864e5 : Infinity;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

  const state = {
    cats: new Set(JSON.parse(ls.get("cats") || "null") || Object.keys(CATS)),
    showOsm: true, onlyNew: false,
    all: [], byId: new Map(), route: [], cum: [],
  };

  /* ---------- map ---------- */
  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([31, 42], 6);
  const base = {
    "Map": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }),
    "Satellite": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery © Esri" }),
    "Terrain": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "© Esri" }),
  };
  base[ls.get("base") || "Map"]?.addTo(map) || base.Map.addTo(map);
  L.control.layers(base, null, { position: "topright" }).addTo(map);
  map.on("baselayerchange", (e) => ls.set("base", e.name));
  L.control.scale({ imperial: false }).addTo(map);

  const curatedLayer = L.layerGroup().addTo(map);
  const osmLayer = L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, disableClusteringAtZoom: 16 }).addTo(map);

  /* ---------- data ---------- */
  const v = "?v=" + today.toISOString().slice(0, 10);
  const getJSON = (p, fb) => fetch(p + v).then((r) => (r.ok ? r.json() : fb)).catch(() => fb);

  Promise.all([
    getJSON("data/waypoints.json", { waypoints: [] }),
    getJSON("data/curated.json", { items: [] }),
    getJSON("data/osm_pois.json", { items: [] }),
    getJSON("data/route.geojson", null),
    getJSON("data/updates.json", { log: [] }),
  ]).then(([wp, cur, osm, route, upd]) => {
    state.waypoints = wp.waypoints;
    state.route = route ? route.features[0].geometry.coordinates.map(([x, y]) => [y, x]) : wp.waypoints.map((w) => [w.lat, w.lon]);
    state.routeKm = route?.features[0].properties.km;
    buildCum();

    cur.items.forEach((p) => { p.curated = true; p.isNew = daysAgo(p.added) <= 7; });
    osm.items.forEach((p) => { p.isNew = daysAgo(p.first_seen) <= 2; });
    state.all = [...cur.items, ...osm.items];
    state.all.forEach((p) => { p.km = kmAlong(p.lat, p.lon); state.byId.set(p.id, p); });
    state.updates = upd.log;
    state.osmUpdated = osm.updated;

    drawRoute(!!route);
    renderStats();
    renderStops();
    renderLayers();
    renderUpdates();
    redraw();
    loadWikiThumbs(cur.items);

    const h = decodeURIComponent(location.hash.slice(1));
    if (h && state.byId.has(h)) open(state.byId.get(h));
    else map.fitBounds(L.latLngBounds(state.route).pad(0.05));
  });

  function buildCum() {
    const r = state.route; state.cum = [0];
    for (let i = 1; i < r.length; i++) state.cum.push(state.cum[i - 1] + map.distance(r[i - 1], r[i]) / 1000);
    state.totalKm = state.routeKm || Math.round(state.cum[state.cum.length - 1]);
  }
  function kmAlong(lat, lon) {
    let best = Infinity, bi = 0;
    const r = state.route, c = Math.cos((lat * Math.PI) / 180);
    for (let i = 0; i < r.length; i++) {
      const d = (r[i][0] - lat) ** 2 + ((r[i][1] - lon) * c) ** 2;
      if (d < best) { best = d; bi = i; }
    }
    return Math.round(state.cum[bi]);
  }

  function drawRoute(real) {
    L.polyline(state.route, { color: "#000", weight: 9, opacity: 0.18 }).addTo(map);
    L.polyline(state.route, { color: getComputedStyle(document.documentElement).getPropertyValue("--road").trim() || "#c2620f", weight: 5, opacity: 0.95, dashArray: real ? null : "8 8" })
      .addTo(map).bindTooltip(real ? `Driving route · ${state.totalKm} km` : "Approximate line – real road route is built on the first daily update", { sticky: true });
  }

  /* ---------- markers ---------- */
  function iconFor(p, size) {
    const c = CATS[p.cat] || CATS.landmark;
    const inner = p.thumb ? `<img src="${esc(p.thumb)}" alt="" loading="lazy">` : c.icon;
    const badge = p.thumb ? `<span class="badge">${c.icon}</span>` : "";
    return L.divIcon({
      className: "pm-wrap",
      html: `<div class="pm ${size > 40 ? "big" : ""} ${p.isNew ? "new-ring" : ""}" style="--c:${c.color};width:${size}px;height:${size}px;position:relative">${inner}${badge}</div>`,
      iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    });
  }
  const visible = (p) => state.cats.has(p.cat) && (!state.onlyNew || p.isNew) && (p.curated || state.showOsm);

  function redraw() {
    curatedLayer.clearLayers(); osmLayer.clearLayers();
    const osmMarkers = [];
    for (const p of state.all) {
      if (!visible(p)) continue;
      if (p.curated) {
        const size = p.cat === "city" ? 46 : p.thumb ? 40 : 30;
        p.marker = L.marker([p.lat, p.lon], { icon: iconFor(p, size), zIndexOffset: p.cat === "city" ? 500 : 300 })
          .bindTooltip(`${esc(p.name)}`, { direction: "top", offset: [0, -size / 2] })
          .on("click", () => open(p)).addTo(curatedLayer);
      } else {
        p.marker = L.marker([p.lat, p.lon], { icon: iconFor(p, 22) })
          .bindTooltip(esc(p.name || CATS[p.cat]?.label), { direction: "top", offset: [0, -11] })
          .on("click", () => open(p));
        osmMarkers.push(p.marker);
      }
    }
    osmLayer.addLayers(osmMarkers);
  }

  /* ---------- photos (Wikipedia + Commons, loaded live) ---------- */
  const wikiCache = new Map();
  function wiki(title) {
    if (!wikiCache.has(title)) {
      wikiCache.set(title, fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`)
        .then((r) => (r.ok ? r.json() : null)).catch(() => null));
    }
    return wikiCache.get(title);
  }
  async function loadWikiThumbs(items) {
    await Promise.all(items.filter((p) => p.wiki).map(async (p) => {
      const s = await wiki(p.wiki);
      if (s?.thumbnail?.source) { p.thumb = s.thumbnail.source; p.photo = s.originalimage?.source || p.thumb; }
    }));
    redraw();
  }
  function commons(lat, lon, radius = 3000) {
    const u = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
      action: "query", generator: "geosearch", ggscoord: `${lat}|${lon}`, ggsradius: radius, ggsnamespace: 6, ggslimit: 12,
      prop: "imageinfo", iiprop: "url|extmetadata", iiurlwidth: 400, format: "json", origin: "*",
    });
    return fetch(u).then((r) => r.json()).then((j) => Object.values(j.query?.pages || {})
      .filter((pg) => /\.(jpe?g|png|webp)$/i.test(pg.title))
      .map((pg) => {
        const ii = pg.imageinfo[0], m = ii.extmetadata || {};
        const strip = (h) => (h || "").replace(/<[^>]+>/g, "").trim();
        return { thumb: ii.thumburl, full: ii.url, page: ii.descriptionurl, title: pg.title.replace(/^File:/, ""),
          credit: `${strip(m.Artist?.value) || "Unknown"} · ${strip(m.LicenseShortName?.value)}` };
      })).catch(() => []);
  }

  /* ---------- detail panel ---------- */
  async function open(p) {
    const c = CATS[p.cat] || CATS.landmark;
    history.replaceState(null, "", "#" + encodeURIComponent(p.id));
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), p.cat === "city" ? 11 : 14), { animate: true });
    const osmLink = p.id.startsWith("osm:") ? `https://www.openstreetmap.org/${p.id.slice(4)}` : `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=15/${p.lat}/${p.lon}`;
    const t = p.tags || {};
    const tagLine = Object.entries(t).filter(([k]) => !["wikipedia", "wikidata", "image", "website"].includes(k)).map(([k, val]) => `${esc(k)}: ${esc(val)}`).join(" · ");
    $("#detailBody").innerHTML = `
      <div id="heroBox"><div class="hero-ph" style="background:${c.color}">${c.icon}</div></div>
      <div class="dbody">
        <h2>${esc(p.name || c.label)}</h2>
        ${p.name_ar ? `<div class="ar">${esc(p.name_ar)}</div>` : ""}
        <div class="chips">
          <span class="chip" style="border-color:${c.color}">${c.icon} ${c.label}</span>
          ${p.country ? `<span class="chip">${FLAGS[p.country] || ""} ${esc(p.country)}</span>` : ""}
          <span class="chip">km ${p.km} / ${state.totalKm}</span>
          ${p.curated ? `<span class="chip">curated</span>` : `<span class="chip">OpenStreetMap</span>`}
          ${p.approx ? `<span class="chip warn">approx. location</span>` : ""}
          ${p.isNew ? `<span class="chip warn">new</span>` : ""}
        </div>
        ${p.desc ? `<p>${esc(p.desc)}</p>` : ""}
        <div id="wikiExtract"></div>
        ${p.game ? `<div class="game"><b>Game idea:</b> ${esc(p.game)}</div>` : ""}
        ${tagLine ? `<p class="tags">${tagLine}</p>` : ""}
        <div class="links">
          <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">Google Maps</a>
          <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lon}" target="_blank" rel="noopener">Street View</a>
          <a href="${osmLink}" target="_blank" rel="noopener">OSM</a>
          ${t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener">Website</a>` : ""}
          ${p.wiki ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(p.wiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia</a>` : ""}
        </div>
        ${p.refs?.length ? `<h3>References</h3><ol class="refs">${p.refs.map((r) => `<li><a href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a></li>`).join("")}</ol>` : ""}
        <h3>Photos nearby <span class="muted">(Wikimedia Commons)</span></h3>
        <div id="gallery" class="gallery"><span class="muted">Loading…</span></div>
        <p class="muted">${esc(p.lat)}, ${esc(p.lon)}${p.first_seen ? ` · first seen ${esc(p.first_seen)}` : ""}${p.added ? ` · added ${esc(p.added)}` : ""}</p>
      </div>`;
    $("#detail").hidden = false;

    const heroSrc = p.photo || p.thumb;
    if (p.wiki) {
      const s = await wiki(p.wiki);
      if (s?.extract && !p.desc) $("#wikiExtract").innerHTML = `<p>${esc(s.extract)}</p>`;
      if (s?.thumbnail) setHero(s.thumbnail.source, s.originalimage?.source, `Wikipedia – ${s.title}`, s.content_urls?.desktop?.page);
    } else if (heroSrc) setHero(heroSrc, heroSrc, "", "");

    const pics = await commons(p.lat, p.lon, p.cat === "city" ? 8000 : 3000);
    const g = $("#gallery"); if (!g) return;
    g.innerHTML = pics.length ? "" : `<span class="muted">No geotagged photos found nearby yet.</span>`;
    pics.forEach((ph, i) => {
      const img = document.createElement("img");
      img.src = ph.thumb; img.loading = "lazy"; img.alt = ph.title; img.title = ph.title;
      img.onclick = () => lightbox(ph.full, `${ph.title} — ${ph.credit}`, ph.page);
      g.appendChild(img);
      if (i === 0 && !p.wiki && !heroSrc) setHero(ph.thumb, ph.full, `${ph.title} — ${ph.credit}`, ph.page);
    });
  }
  function setHero(src, full, cap, page) {
    const box = $("#heroBox"); if (!box) return;
    box.innerHTML = `<img class="hero" src="${esc(src)}" alt="">`;
    box.firstChild.onclick = () => lightbox(full || src, cap, page);
  }
  function lightbox(src, cap, page) {
    const lb = $("#lightbox");
    lb.querySelector("img").src = src;
    lb.querySelector("figcaption").innerHTML = `${esc(cap)}${page ? ` · <a href="${esc(page)}" target="_blank" rel="noopener">source</a>` : ""}`;
    lb.hidden = false;
  }
  $("#lightbox").onclick = (e) => { if (e.target.tagName !== "A") $("#lightbox").hidden = true; };
  $("#detail .close").onclick = () => { $("#detail").hidden = true; history.replaceState(null, "", location.pathname); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("#lightbox").hidden ? $("#detail .close").click() : ($("#lightbox").hidden = true); } });

  /* ---------- sidebar ---------- */
  function renderStats() {
    const osmN = state.all.filter((p) => !p.curated).length;
    const curN = state.all.length - osmN;
    $("#stats").innerHTML = `<div><b>${state.totalKm}</b> km</div><div><b>3</b> countries</div><div><b>${curN}</b> curated</div><div><b>${osmN}</b> OSM places</div>`
      + (state.osmUpdated ? `<div>updated <b>${esc(state.osmUpdated)}</b></div>` : "");
  }
  function renderStops() {
    const stops = state.all.filter((p) => p.curated && (p.cat === "city" || p.cat === "border")).sort((a, b) => a.km - b.km);
    $("#stops").innerHTML = stops.map((p) => {
      const c = CATS[p.cat];
      return `<li data-id="${esc(p.id)}" class="${p.cat === "border" ? "border-row" : ""}"><span class="dot" style="background:${c.color}">${c.icon}</span>
        <span><b>${esc(p.name)}</b><br><span class="flag">${FLAGS[p.country] || ""} <span class="ar">${esc(p.name_ar)}</span></span></span><span class="km">${p.km} km</span></li>`;
    }).join("");
  }
  function renderLayers() {
    const counts = {};
    state.all.forEach((p) => (counts[p.cat] = (counts[p.cat] || 0) + 1));
    $("#layers").innerHTML = Object.entries(CATS).map(([k, c]) =>
      `<label class="${state.cats.has(k) ? "" : "off"}"><input type="checkbox" value="${k}" ${state.cats.has(k) ? "checked" : ""}>
       <span class="dot" style="background:${c.color};width:22px;height:22px;font-size:12px">${c.icon}</span>${c.label}<span class="n">${counts[k] || 0}</span></label>`).join("");
    $("#layers").querySelectorAll("input").forEach((i) => (i.onchange = () => {
      i.checked ? state.cats.add(i.value) : state.cats.delete(i.value);
      i.parentElement.classList.toggle("off", !i.checked);
      ls.set("cats", JSON.stringify([...state.cats]));
      redraw();
    }));
  }
  function renderUpdates() {
    const recent = state.all.filter((p) => p.isNew);
    $("#newCount").textContent = recent.length || "";
    $("#updates").innerHTML = state.updates.slice(0, 30).map((u) => {
      const items = (u.added || []).map((id) => state.byId.get(id)).filter(Boolean);
      const shown = items.filter((p) => p.name).slice(0, 25);
      const summary = u.kind === "osm"
        ? `${u.added_count} new OpenStreetMap places (scanned route chunks ${u.chunks.join(", ")})`
        : esc(u.note || "");
      return `<div class="day"><h4>${esc(u.date)} · ${u.kind === "osm" ? "auto scan" : "research"}</h4><p>${summary}</p>
        ${shown.length ? `<ul>${shown.map((p) => `<li data-id="${esc(p.id)}">${CATS[p.cat]?.icon || ""} ${esc(p.name)} <span class="muted">km ${p.km}</span></li>`).join("")}</ul>` : ""}</div>`;
    }).join("") || `<p class="muted">No updates yet – the first daily scan will appear here.</p>`;
  }
  document.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (li && state.byId.has(li.dataset.id)) open(state.byId.get(li.dataset.id));
  });

  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".tabs button, .tab").forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); $("#tab-" + b.dataset.tab).classList.add("on");
    $("#q").value = ""; $("#results").hidden = true;
  }));
  $("#showOsm").onchange = (e) => { state.showOsm = e.target.checked; redraw(); };
  $("#onlyNew").onchange = (e) => { state.onlyNew = e.target.checked; redraw(); };
  $("#sideToggle").onclick = () => $("#side").classList.toggle("hidden");

  $("#q").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    const res = $("#results");
    document.querySelector(".tab.on").style.display = q ? "none" : "";
    if (!q) { res.hidden = true; return; }
    const hits = state.all.filter((p) => {
      const c = CATS[p.cat];
      return [p.name, p.name_ar, p.desc, c?.label, p.cat, p.tags?.brand].some((s) => s && String(s).toLowerCase().includes(q));
    }).sort((a, b) => (b.curated - a.curated) || a.km - b.km).slice(0, 150);
    res.hidden = false;
    res.innerHTML = hits.map((p) => `<li data-id="${esc(p.id)}"><span class="dot" style="background:${CATS[p.cat]?.color}">${CATS[p.cat]?.icon}</span>
      <span>${esc(p.name || CATS[p.cat]?.label)}<br><span class="muted">km ${p.km}${p.name_ar ? " · " + esc(p.name_ar) : ""}</span></span></li>`).join("") || `<li class="muted">No matches</li>`;
  };
})();
