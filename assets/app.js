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
    photo:    { label: "Road photos",    icon: "📷", color: "#455a64" },
  };
  const SRC = { commons: "Wikimedia Commons", mapillary: "Mapillary", kartaview: "KartaView", panoramax: "Panoramax", curated: "Reference", live: "Wikimedia Commons" };
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
  const photoLayer = L.markerClusterGroup({
    maxClusterRadius: 50, showCoverageOnHover: false, disableClusteringAtZoom: 15,
    iconCreateFunction: (cl) => {
      const first = cl.getAllChildMarkers()[0].options.photo;
      return L.divIcon({ className: "pm-wrap", iconSize: [44, 44],
        html: `<div class="pm photo-cluster" style="width:44px;height:44px"><img src="${esc(first.thumb)}" alt=""><span class="cnt">${cl.getChildCount()}</span></div>` });
    },
  }).addTo(map);

  /* ---------- data ---------- */
  const v = "?v=" + today.toISOString().slice(0, 10);
  const getJSON = (p, fb) => fetch(p + v).then((r) => (r.ok ? r.json() : fb)).catch(() => fb);

  Promise.all([
    getJSON("data/waypoints.json", { waypoints: [] }),
    getJSON("data/curated.json", { items: [] }),
    getJSON("data/osm_pois.json", { items: [] }),
    getJSON("data/route.geojson", null),
    getJSON("data/updates.json", { log: [] }),
    getJSON("data/photos.json", { items: [] }),
  ]).then(([wp, cur, osm, route, upd, photos]) => {
    state.waypoints = wp.waypoints;
    state.route = route ? route.features[0].geometry.coordinates.map(([x, y]) => [y, x]) : wp.waypoints.map((w) => [w.lat, w.lon]);
    state.routeKm = route?.features[0].properties.km;
    buildCum();

    cur.items.forEach((p) => { p.curated = true; p.isNew = daysAgo(p.added) <= 7; });
    osm.items.forEach((p) => { p.isNew = daysAgo(p.first_seen) <= 2; });
    state.all = [...cur.items, ...osm.items];
    state.all.forEach((p) => { p.km = kmAlong(p.lat, p.lon); state.byId.set(p.id, p); });
    state.photos = photos.items.filter((ph) => ph.thumb);
    state.photos.forEach((ph) => { ph.km = kmAlong(ph.lat, ph.lon); ph.isNew = daysAgo(ph.first_seen) <= 2; state.byId.set(ph.id, ph); });
    state.photos.sort((a, b) => a.km - b.km);
    state.updates = upd.log;
    state.osmUpdated = osm.updated;

    drawRoute(!!route);
    renderStats();
    renderStops();
    renderLayers();
    renderUpdates();
    renderDrive();
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

    photoLayer.clearLayers();
    if (!state.cats.has("photo")) return;
    const list = state.photos.filter((ph) => !state.onlyNew || ph.isNew);
    photoLayer.addLayers(list.map((ph, i) => L.marker([ph.lat, ph.lon], {
      photo: ph,
      icon: L.divIcon({ className: "pm-wrap", iconSize: [34, 34], iconAnchor: [17, 17],
        html: `<div class="pm ${ph.isNew ? "new-ring" : ""}" style="--c:#455a64;width:34px;height:34px"><img src="${esc(ph.thumb)}" alt="" loading="lazy"></div>` }),
    }).bindTooltip(`${esc(SRC[ph.src] || ph.src)} · km ${ph.km}`, { direction: "top", offset: [0, -17] })
      .on("click", () => lightbox(list, i))));
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
          <a href="${osmLink}" target="_blank" rel="noopener">OSM</a>
          ${t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener">Website</a>` : ""}
          ${p.wiki ? `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(p.wiki.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia</a>` : ""}
        </div>
        <h3>Look around <span class="muted">(street-level / dashcam)</span></h3>
        <div class="links">${lookAround(p.lat, p.lon)}</div>
        <h3>Search pictures elsewhere</h3>
        <div class="links">${searchLinks(p)}</div>
        ${p.refs?.length ? `<h3>References</h3><ol class="refs">${p.refs.map((r) => `<li><a href="${esc(r.u)}" target="_blank" rel="noopener">${esc(r.t)}</a></li>`).join("")}</ol>` : ""}
        <h3>Photos here &amp; on the road nearby</h3>
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

    // own reference images -> road photos within 5 km -> live Commons search
    const own = (p.images || []).map((im) => ({ thumb: im.thumb || im.u, full: im.u, page: im.page || im.u, title: im.t || p.name, credit: im.credit || "", src: "curated" }));
    const road = state.photos.map((ph) => [ph, map.distance([p.lat, p.lon], [ph.lat, ph.lon])])
      .filter(([, d]) => d < 5000).sort((a, b) => a[1] - b[1]).slice(0, 12).map(([ph]) => ph);
    const live = (await commons(p.lat, p.lon, p.cat === "city" ? 8000 : 3000)).map((ph) => ({ ...ph, src: "live" }));
    const seen = new Set();
    const pics = [...own, ...road, ...live].filter((ph) => !seen.has(ph.page) && seen.add(ph.page));
    const g = $("#gallery"); if (!g) return;
    g.innerHTML = pics.length ? "" : `<span class="muted">No photos found yet – try the "Look around" and "Search pictures" links above.</span>`;
    pics.forEach((ph, i) => {
      const img = document.createElement("img");
      img.src = ph.thumb; img.loading = "lazy"; img.alt = ph.title || ""; img.title = `${ph.title || ""} · ${SRC[ph.src] || ""}`;
      img.onclick = () => lightbox(pics, i);
      g.appendChild(img);
    });
    if (!p.wiki && !heroSrc && pics[0]) setHero(pics[0].thumb, pics[0].full, `${pics[0].title} — ${pics[0].credit}`, pics[0].page);
  }
  function lookAround(lat, lon) {
    return [
      ["Mapillary", `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=16`],
      ["KartaView", `https://kartaview.org/map/@${lat},${lon},16z`],
      ["Panoramax", `https://api.panoramax.xyz/#focus=map&map=16/${lat}/${lon}`],
      ["Yandex panoramas", `https://yandex.com/maps/?ll=${lon},${lat}&z=16&l=stv,sta`],
      ["Google Street View", `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`],
      ["Satellite", `https://www.google.com/maps/@${lat},${lon},800m/data=!3m1!1e3`],
    ].map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join("");
  }
  function searchLinks(p) {
    const town = state.waypoints.reduce((b, w) => (map.distance([w.lat, w.lon], [p.lat, p.lon]) < map.distance([b.lat, b.lon], [p.lat, p.lon]) ? w : b), state.waypoints[0]);
    const en = encodeURIComponent(`${p.name || CATS[p.cat]?.label} ${p.cat === "city" ? "" : town.name}`.trim());
    const ar = encodeURIComponent(`${p.name_ar || p.name || ""} ${p.cat === "city" ? "" : town.name_ar}`.trim());
    return [
      ["Google Images", `https://www.google.com/search?tbm=isch&q=${en}`],
      ["صور (Arabic)", `https://www.google.com/search?tbm=isch&q=${ar}`],
      ["Bing Images", `https://www.bing.com/images/search?q=${en}`],
      ["Flickr", `https://www.flickr.com/search/?text=${en}`],
      ["YouTube", `https://www.youtube.com/results?search_query=${encodeURIComponent(decodeURIComponent(ar) + " " + decodeURIComponent(en))}`],
      ["Instagram", `https://www.instagram.com/explore/search/keyword/?q=${en}`],
    ].map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join("");
  }
  function setHero(src, full, cap, page) {
    const box = $("#heroBox"); if (!box) return;
    box.innerHTML = `<img class="hero" src="${esc(src)}" alt="">`;
    box.firstChild.onclick = () => lightbox([{ full: full || src, thumb: src, title: cap, credit: "", page }], 0);
  }
  // lightbox over a list of photos; arrow keys / buttons step through them (road order for the Drive tab)
  const lb = { list: [], i: 0 };
  function lightbox(list, i) {
    lb.list = list; lb.i = i;
    const ph = list[i], box = $("#lightbox");
    box.querySelector("img").src = ph.full || ph.thumb;
    const meta = [ph.title, ph.credit, ph.date, ph.km != null ? `km ${ph.km}` : ""].filter(Boolean).map(esc).join(" · ");
    box.querySelector("figcaption").innerHTML = `${meta}${ph.page ? ` · <a href="${esc(ph.page)}" target="_blank" rel="noopener">source</a>` : ""}`
      + (ph.lat ? ` · <a href="#" data-map="${i}">show on map</a>` : "") + (list.length > 1 ? ` · ${i + 1}/${list.length}` : "");
    box.querySelector(".prev").hidden = box.querySelector(".next").hidden = list.length < 2;
    box.hidden = false;
  }
  const step = (d) => lightbox(lb.list, (lb.i + d + lb.list.length) % lb.list.length);
  $("#lightbox .prev").onclick = (e) => { e.stopPropagation(); step(-1); };
  $("#lightbox .next").onclick = (e) => { e.stopPropagation(); step(1); };
  $("#lightbox").onclick = (e) => {
    if (e.target.dataset.map) {
      e.preventDefault(); const ph = lb.list[+e.target.dataset.map];
      $("#lightbox").hidden = true; map.setView([ph.lat, ph.lon], 16);
      L.popup().setLatLng([ph.lat, ph.lon]).setContent(`<img src="${esc(ph.thumb)}" style="width:200px;border-radius:6px">`).openOn(map);
      return;
    }
    if (e.target.tagName !== "A") $("#lightbox").hidden = true;
  };
  $("#detail .close").onclick = () => { $("#detail").hidden = true; history.replaceState(null, "", location.pathname); };
  document.addEventListener("keydown", (e) => {
    if (!$("#lightbox").hidden && (e.key === "ArrowRight" || e.key === "ArrowLeft")) return step(e.key === "ArrowRight" ? 1 : -1);
    if (e.key === "Escape") { $("#lightbox").hidden ? $("#detail .close").click() : ($("#lightbox").hidden = true); } });

  /* ---------- sidebar ---------- */
  function renderStats() {
    const osmN = state.all.filter((p) => !p.curated).length;
    const curN = state.all.length - osmN;
    $("#stats").innerHTML = `<div><b>${state.totalKm}</b> km</div><div><b>3</b> countries</div><div><b>${curN}</b> curated</div><div><b>${osmN}</b> OSM places</div><div><b>${state.photos.length}</b> road photos</div>`
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
    counts.photo = state.photos.length;
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
      if (u.kind === "photos") {
        const phs = (u.added || []).map((id) => state.byId.get(id)).filter(Boolean);
        return `<div class="day"><h4>${esc(u.date)} · road photos</h4><p>${esc(u.note || "")}</p>
          <div class="gallery mini">${phs.slice(0, 12).map((ph) => `<img src="${esc(ph.thumb)}" data-photo="${esc(ph.id)}" loading="lazy" alt="">`).join("")}</div></div>`;
      }
      const summary = u.kind === "osm"
        ? `${u.added_count} new OpenStreetMap places (scanned route chunks ${u.chunks.join(", ")})`
        : esc(u.note || "");
      return `<div class="day"><h4>${esc(u.date)} · ${u.kind === "osm" ? "auto scan" : "research"}</h4><p>${summary}</p>
        ${shown.length ? `<ul>${shown.map((p) => `<li data-id="${esc(p.id)}">${CATS[p.cat]?.icon || ""} ${esc(p.name)} <span class="muted">km ${p.km}</span></li>`).join("")}</ul>` : ""}</div>`;
    }).join("") || `<p class="muted">No updates yet – the first daily scan will appear here.</p>`;
  }
  function renderDrive() {
    const box = $("#drive");
    if (!state.photos.length) {
      box.innerHTML = `<p class="muted">Road photos appear here after the first daily scan (Actions → Daily road update). They come from Wikimedia Commons, Mapillary, KartaView and Panoramax, ordered from Dammam to Latakia.</p>`;
      return;
    }
    const stops = state.waypoints.map((w) => ({ ...w, km: kmAlong(w.lat, w.lon) })).sort((a, b) => a.km - b.km);
    let html = `<p class="muted">${state.photos.length} photos in road order. Click one, then use ← → to drive.</p>`, cur = -1;
    state.photos.forEach((ph, i) => {
      let s = 0; while (s + 1 < stops.length && stops[s + 1].km <= ph.km) s++;
      if (s !== cur) { html += `${cur >= 0 ? "</div>" : ""}<h4 class="leg">${esc(stops[s].name)} <span class="muted">km ${stops[s].km}+</span></h4><div class="gallery">`; cur = s; }
      html += `<img src="${esc(ph.thumb)}" data-drive="${i}" loading="lazy" alt="" title="km ${ph.km} · ${esc(SRC[ph.src] || ph.src)}">`;
    });
    box.innerHTML = html + "</div>";
  }

  document.addEventListener("click", (e) => {
    if (e.target.dataset.drive) return lightbox(state.photos, +e.target.dataset.drive);
    if (e.target.dataset.photo) { const i = state.photos.findIndex((ph) => ph.id === e.target.dataset.photo); if (i >= 0) return lightbox(state.photos, i); }
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
