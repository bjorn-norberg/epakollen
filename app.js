(() => {
  "use strict";

  const SPEED_KMH = 30;
  const SWEDEN_BBOX = "10.5,55.0,24.5,69.2";
  const FALLBACK_PRICES = { bensin: 19.3, diesel: 22.5 };
  const STORE = "epakollen:v1";

  const $ = (id) => document.getElementById(id);
  const els = {
    from: $("from"), to: $("to"),
    fromSuggest: $("from-suggest"), toSuggest: $("to-suggest"),
    locate: $("locate"), swap: $("swap"),
    depart: $("depart"), now: $("now"),
    consumption: $("consumption"), price: $("price"), priceNote: $("price-note"),
    status: $("status"), error: $("error"), results: $("results"),
    rCost: $("r-cost"), rFuel: $("r-fuel"), rDist: $("r-dist"),
    rTime: $("r-time"), rSongs: $("r-songs"), rArrive: $("r-arrive"), rDay: $("r-day"),
    navGoogle: $("nav-google"), navApple: $("nav-apple"),
  };
  const fuelButtons = [...document.querySelectorAll("[data-fuel]")];
  const routeButtons = [...document.querySelectorAll("[data-route]")];

  const nf = (d) => new Intl.NumberFormat("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmt0 = nf(0), fmt1 = nf(1), fmt2 = nf(2);

  // ---------- State ----------
  const saved = load();
  const state = {
    fuel: saved.fuel || "bensin",
    routeMode: saved.routeMode === "lugnast" ? "lugnast" : "kortast",
    consumption: saved.consumption || 0.6,
    prices: { ...FALLBACK_PRICES },
    priceSource: "fallback",
    customPrice: null,
    places: { from: null, to: null },
    route: null,
    departTouched: false,
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
  }
  function save(extra) {
    try {
      const cur = load();
      localStorage.setItem(STORE, JSON.stringify({ ...cur, fuel: state.fuel, consumption: state.consumption, routeMode: state.routeMode, ...extra }));
    } catch { /* privat läge e.d. */ }
  }

  // ---------- Förbrukning ----------
  for (let i = 10; i <= 100; i += 5) {
    const v = i / 100;
    const opt = new Option(`${fmt2.format(v)} l/mil`, v.toFixed(2));
    els.consumption.add(opt);
  }
  els.consumption.value = Number(state.consumption).toFixed(2);
  els.consumption.addEventListener("change", () => {
    state.consumption = parseFloat(els.consumption.value);
    save();
    renderResult();
  });

  // ---------- Bränsle ----------
  function setFuel(fuel) {
    state.fuel = fuel;
    state.customPrice = null;
    fuelButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.fuel === fuel)));
    showPrice();
    save();
    renderResult();
  }
  fuelButtons.forEach((b) => b.addEventListener("click", () => setFuel(b.dataset.fuel)));

  // ---------- Pris ----------
  function currentPrice() {
    return state.customPrice ?? state.prices[state.fuel];
  }
  function showPrice() {
    els.price.value = currentPrice().toFixed(2);
    renderPriceNote();
  }
  function renderPriceNote() {
    const n = els.priceNote;
    n.classList.remove("live");
    if (state.customPrice != null) {
      n.innerHTML = `Ditt eget pris. <a href="#" id="reset-price">Använd dagens snitt</a>`;
      $("reset-price").addEventListener("click", (e) => {
        e.preventDefault();
        state.customPrice = null;
        showPrice();
        renderResult();
      });
      return;
    }
    const name = state.fuel === "bensin" ? "95 (E10)" : "diesel";
    if (state.priceSource === "live" || state.priceSource === "cache") {
      const d = state.priceUpdated ? new Date(state.priceUpdated) : null;
      const when = d ? d.toLocaleDateString("sv-SE", { day: "numeric", month: "short" }).replace(/\.$/, "") : "";
      const fresh = d && Date.now() - d.getTime() < 3 * 864e5;
      n.classList.toggle("live", state.priceSource === "live" && fresh);
      n.innerHTML = `Rikssnitt för ${name} · <b>${when}</b>. Tanka billigare? Ändra priset.`;
    } else {
      n.textContent = `Kunde inte hämta dagens pris – ungefärligt pris för ${name}. Skriv in ditt eget.`;
    }
  }
  els.price.addEventListener("input", () => {
    const v = parseFloat(els.price.value.replace(",", "."));
    if (!isNaN(v) && v > 0) {
      state.customPrice = v;
      renderPriceNote();
      renderResult();
    }
  });

  // prices.js sätter window.EPA_PRICES och laddas med en <script>-tagg,
  // så priset fungerar både på webben och när index.html öppnas direkt från disken.
  function loadPrices() {
    const p = window.EPA_PRICES;
    if (p && p.bensin > 0 && p.diesel > 0) {
      applyPrices(p, "live");
      save({ prices: p });
      return;
    }
    const cached = load().prices;
    applyPrices(cached || null, cached ? "cache" : "fallback");
  }
  function applyPrices(p, source) {
    if (p) {
      state.prices = { bensin: p.bensin, diesel: p.diesel };
      state.priceUpdated = p.updated;
    }
    state.priceSource = source;
    if (state.customPrice == null) showPrice(); else renderPriceNote();
    renderResult();
  }

  // ---------- Avresetid ----------
  function setNow() {
    const d = new Date();
    els.depart.value = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    state.departTouched = false;
  }
  setNow();
  els.now.addEventListener("click", () => { setNow(); renderResult(); });
  els.depart.addEventListener("input", () => { state.departTouched = true; renderResult(); });

  // ---------- Platssök (Photon) ----------
  function placeLabel(f) {
    const p = f.properties;
    const main = p.name || [p.street, p.housenumber].filter(Boolean).join(" ") || p.city || "Okänd plats";
    const secondaryParts = [];
    if (p.name && p.street) secondaryParts.push([p.street, p.housenumber].filter(Boolean).join(" "));
    const town = p.city || p.town || p.village || p.district || p.county;
    if (town && town !== main) secondaryParts.push(town);
    return { main, sub: secondaryParts.join(", ") };
  }
  function toPlace(f) {
    const { main, sub } = placeLabel(f);
    return { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: sub ? `${main}, ${sub}` : main, main, sub };
  }

  async function geocode(q, limit = 6) {
    const params = new URLSearchParams({ q, limit, lang: "default", bbox: SWEDEN_BBOX });
    const bias = state.places.from || state.myPos;
    if (bias) { params.set("lat", bias.lat); params.set("lon", bias.lon); }
    const res = await fetch(`https://photon.komoot.io/api/?${params}`);
    if (!res.ok) throw new Error("geocode");
    const data = await res.json();
    const seen = new Set();
    return data.features.map(toPlace).filter((p) => {
      const k = p.label.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function setupAutocomplete(key, input, list) {
    let timer, ctrlSeq = 0, items = [], active = -1;

    const close = () => { list.hidden = true; active = -1; input.setAttribute("aria-expanded", "false"); };
    const pick = (p) => {
      state.places[key] = p;
      input.value = p.label;
      close();
      if (key === "from" && !els.to.value) els.to.focus();
      else autoCalculate();
    };
    const render = () => {
      list.innerHTML = "";
      items.forEach((p, i) => {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(i === active));
        li.textContent = p.main;
        if (p.sub) { const s = document.createElement("small"); s.textContent = p.sub; li.append(s); }
        li.addEventListener("pointerdown", (e) => { e.preventDefault(); pick(p); });
        list.append(li);
      });
      list.hidden = items.length === 0;
      input.setAttribute("aria-expanded", String(!list.hidden));
    };

    input.setAttribute("role", "combobox");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-autocomplete", "list");

    // Markera hela texten när man trycker i fältet – första bokstaven ersätter då hela det gamla ortnamnet.
    // (setTimeout behövs för iPhone/Safari, som annars placerar markören efter markeringen.)
    input.addEventListener("focus", () => {
      setTimeout(() => { if (document.activeElement === input) input.select(); }, 0);
    });
    // Utan detta avmarkerar mus-/fingerklicket direkt texten igen på datorn
    input.addEventListener("mouseup", (e) => {
      if (input.selectionStart === 0 && input.selectionEnd === input.value.length) e.preventDefault();
    });

    input.addEventListener("input", () => {
      state.places[key] = null;
      markStale();
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 2) { items = []; render(); return; }
      timer = setTimeout(async () => {
        const seq = ++ctrlSeq;
        try {
          const r = await geocode(q);
          if (seq !== ctrlSeq) return;
          items = r; active = -1; render();
        } catch { /* tyst – användaren kan fortsätta skriva */ }
      }, 250);
    });
    input.addEventListener("keydown", (e) => {
      if (list.hidden) return;
      if (e.key === "ArrowDown") { active = (active + 1) % items.length; render(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = (active - 1 + items.length) % items.length; render(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0) { pick(items[active]); e.preventDefault(); }
      else if (e.key === "Escape") close();
    });
    input.addEventListener("blur", () => setTimeout(() => {
      close();
      if (!state.places[key] && !state.calculating && input.value.trim().length >= 2) autoCalculate();
    }, 120));
    return () => { clearTimeout(timer); ctrlSeq++; items = []; close(); };
  }
  // ×-knappen: töm fältet och ställ markören där, redo för en ny ort
  document.querySelectorAll("[data-clear]").forEach((btn) => {
    const input = els[btn.dataset.clear];
    btn.addEventListener("pointerdown", (e) => e.preventDefault()); // behåll fokus/tangentbord
    btn.addEventListener("click", () => {
      input.value = "";
      input.dispatchEvent(new Event("input")); // nollställer vald plats och tonar ner gammalt resultat
      input.focus();
    });
  });

  const cancelSuggest = [
    setupAutocomplete("from", els.from, els.fromSuggest),
    setupAutocomplete("to", els.to, els.toSuggest),
  ];

  els.to.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && els.toSuggest.hidden) { els.to.blur(); calculate(); }
  });

  els.swap.addEventListener("click", () => {
    [els.from.value, els.to.value] = [els.to.value, els.from.value];
    [state.places.from, state.places.to] = [state.places.to, state.places.from];
    els.swap.classList.toggle("spun");
    autoCalculate();
  });

  // ---------- Min position ----------
  els.locate.addEventListener("click", () => {
    if (!navigator.geolocation) return showError("Din webbläsare kan inte dela position.");
    els.locate.classList.add("busy");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Min position", main: "Min position" };
      state.myPos = p;
      state.places.from = p;
      els.from.value = "Min position";
      try {
        const res = await fetch(`https://photon.komoot.io/reverse?lat=${p.lat}&lon=${p.lon}&limit=1`);
        const data = await res.json();
        if (data.features?.length) {
          const named = toPlace(data.features[0]);
          p.label = `Min position · ${named.label}`;
          els.from.value = p.label;
        }
      } catch { /* behåll "Min position" */ }
      els.locate.classList.remove("busy");
      hideError();
      if (!els.to.value) els.to.focus();
      else autoCalculate();
    }, (err) => {
      els.locate.classList.remove("busy");
      showError(err.code === 1
        ? "Du nekade platsåtkomst. Tillåt plats i inställningarna eller skriv in startplatsen."
        : "Hittade inte din position. Skriv in startplatsen istället.");
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });

  // ---------- Rutt (Valhalla) ----------
  function decodePolyline6(str) {
    let index = 0, lat = 0, lng = 0;
    const coords = [];
    while (index < str.length) {
      for (const which of [0, 1]) {
        let shift = 0, result = 0, b;
        do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = result & 1 ? ~(result >> 1) : result >> 1;
        if (which === 0) lat += d; else lng += d;
      }
      coords.push([lat / 1e6, lng / 1e6]);
    }
    return coords;
  }

  // motor_scooter följer mopedregler: aldrig motorväg eller motortrafikled.
  // Ingen reserv med bilprofil – hellre inget svar än en rutt på motorväg.
  async function getRoute(a, b) {
    const body = {
      locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
      costing: "motor_scooter",
      // Kortast: kortaste väg = snabbaste för en EPA som alltid kör 30 km/h.
      // Lugnast: föredrar mindre vägar framför stora huvudvägar. Mopedreglerna gäller i båda.
      costing_options: {
        motor_scooter: state.routeMode === "kortast"
          ? { top_speed: SPEED_KMH, shortest: true }
          : { top_speed: SPEED_KMH, use_primary: 0.1, use_hills: 0.5 },
      },
      directions_type: "none",
      units: "kilometers",
    };
    let res;
    try {
      res = await fetch("https://valhalla1.openstreetmap.de/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new UserError("Får ingen kontakt med ruttjänsten. Kolla din uppkoppling och försök igen.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 429) throw new UserError("Ruttjänsten är överbelastad just nu. Vänta en stund och försök igen.");
    if (!res.ok || !data.trip) throw new UserError("Hittade ingen väg utan motorväg dit. Prova en annan eller närmare plats.");
    const leg = data.trip.legs[0];
    return { km: data.trip.summary.length, coords: decodePolyline6(leg.shape) };
  }

  async function resolvePlace(key, input) {
    if (state.places[key]) return state.places[key];
    const q = input.value.trim();
    if (!q) return null;
    let r;
    try { r = await geocode(q, 1); }
    catch { throw new UserError("Får ingen kontakt med platssöket. Kolla din uppkoppling och försök igen."); }
    if (!r.length) throw new UserError(`Hittade inte "${q}". Prova att skriva ort också.`);
    state.places[key] = r[0];
    input.value = r[0].label;
    return r[0];
  }

  // ---------- Beräkning ----------
  let calcSeq = 0;

  // Räkna direkt när en plats valts och båda fälten är ifyllda – det finns ingen räkna-knapp.
  function autoCalculate() {
    if (els.from.value.trim() && els.to.value.trim()) calculate();
  }

  function markStale() {
    if (state.route) {
      els.results.classList.add("stale");
      $("map-wrap").classList.add("stale");
    }
  }

  async function calculate() {
    const seq = ++calcSeq;
    hideError();
    cancelSuggest.forEach((cancel) => cancel());
    if (!els.from.value.trim()) { els.from.focus(); return showError("Skriv var du startar – eller tryck på Min plats."); }
    if (!els.to.value.trim()) { els.to.focus(); return showError("Skriv vart du ska."); }

    els.status.hidden = false;
    state.calculating = true;
    try {
      const [a, b] = await Promise.all([resolvePlace("from", els.from), resolvePlace("to", els.to)]);
      const r = await getRoute(a, b);
      if (seq !== calcSeq) return;
      state.route = { ...r, a, b };
      els.results.classList.remove("stale");
      $("map-wrap").classList.remove("stale");
      if (!state.departTouched) setNow();
      els.results.hidden = false;
      renderResult();
      drawMap();
      updateNavLinks();
      if (window.matchMedia("(max-width: 899px)").matches) {
        $("map-wrap").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      if (seq !== calcSeq) return;
      showError(e instanceof UserError ? e.message : "Något gick fel. Försök igen.");
    } finally {
      if (seq !== calcSeq) return;
      els.status.hidden = true;
      state.calculating = false;
    }
  }

  function renderResult() {
    if (!state.route) return;
    const km = state.route.km;
    const liters = (km / 10) * state.consumption;
    const cost = liters * currentPrice();
    const minutes = Math.round((km / SPEED_KMH) * 60);

    els.rCost.textContent = `${fmt0.format(Math.round(cost))} kr`;
    els.rFuel.textContent = `${fmt1.format(liters)} liter ${state.fuel} · ${fmt2.format(currentPrice())} kr/l`;
    els.rDist.textContent = km < 10 ? `${fmt1.format(km)} km` : `${fmt0.format(km)} km`;
    els.rTime.textContent = minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
    const songs = Math.max(1, Math.round(minutes / 3.5));
    els.rSongs.textContent = `≈ ${songs} ${songs === 1 ? "låt" : "låtar"} i stereon`;

    const [hh, mm] = (els.depart.value || "00:00").split(":").map(Number);
    const dep = new Date(); dep.setHours(hh, mm, 0, 0);
    const arr = new Date(dep.getTime() + minutes * 60000);
    els.rArrive.textContent = arr.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((new Date(arr).setHours(0, 0, 0, 0) - new Date(dep).setHours(0, 0, 0, 0)) / 864e5);
    els.rDay.textContent = days === 0 ? `om du drar ${els.depart.value}` : days === 1 ? "imorgon" : `om ${days} dagar`;
  }

  // ---------- Karta ----------
  // Kartan visas från start med en utzoomad bild av Sverige och ritar sedan upp rutten.
  const SWEDEN_BOUNDS = [[55.2, 10.9], [69.1, 24.2]];
  let map, layer, lastBounds = null;

  function initMap() {
    if (map || !window.L) return;
    map = L.map("map", {
      zoomControl: false, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.5,
      // På mobil ska ett svep scrolla sidan, inte flytta kartan (nyp med två fingrar för att zooma)
      dragging: !L.Browser.mobile,
    });
    // Esri Dark Gray kräver ingen nyckel och fungerar även från file:// (OSM:s egna kartservrar blockerar det).
    const esri = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
    L.tileLayer(`${esri}World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
      maxZoom: 16, className: "tiles-base",
      attribution: '&copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    L.tileLayer(`${esri}World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 16 }).addTo(map);
    L.control.zoom({ position: "topright" }).addTo(map);
    lastBounds = L.latLngBounds(SWEDEN_BOUNDS);
    map.fitBounds(lastBounds, { padding: [8, 8], animate: false });
  }

  function drawMap() {
    $("map-wrap").classList.add("shown"); // på mobil är kartan dold tills det finns en rutt
    initMap();
    if (!map) return;
    if (layer) layer.remove();
    const { coords, a, b } = state.route;
    const bounds = L.latLngBounds(coords);
    // Sätt vyn innan lagren läggs till, annars kan Leaflet rita mot en odefinierad zoom.
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [28, 28], animate: false });
    const pin = (cls) => L.divIcon({ className: "", html: `<span class="pin ${cls}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    layer = L.layerGroup([
      L.polyline(coords, { color: "#FF4FA3", weight: 10, opacity: 0.25 }),
      L.polyline(coords, { color: "#D4FF3A", weight: 4.5, opacity: 1, lineJoin: "round" }),
      L.marker([a.lat, a.lon], { icon: pin("pin-from") }),
      L.marker([b.lat, b.lon], { icon: pin("pin-to") }),
    ]).addTo(map);
    lastBounds = bounds;
    $("map-hint").hidden = true;
    $("map-wrap").classList.remove("stale");
  }

  // Passa in rutten (eller Sverige) igen när kartans storlek ändras (layouten sätter sig, telefonen vrids).
  if ("ResizeObserver" in window) {
    new ResizeObserver(() => {
      if (!map || !lastBounds) return;
      map.invalidateSize();
      map.fitBounds(lastBounds, { padding: layer ? [28, 28] : [8, 8], animate: false });
    }).observe($("map"));
  }

  // ---------- Navigering i kartappen ----------
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function distKm([lat1, lon1], [lat2, lon2]) {
    const r = Math.PI / 180;
    const x = (lon2 - lon1) * r * Math.cos(((lat1 + lat2) / 2) * r);
    const y = (lat2 - lat1) * r;
    return Math.hypot(x, y) * 6371;
  }

  // Punkter jämnt fördelade längs rutten (t.ex. vid 25 %, 50 %, 75 %).
  function pointsAlong(coords, n) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distKm(coords[i - 1], coords[i]));
    const total = cum[cum.length - 1];
    const out = [];
    let i = 0;
    for (let k = 1; k <= n; k++) {
      const target = (total * k) / (n + 1);
      while (i < cum.length - 1 && cum[i] < target) i++;
      out.push(coords[i]);
    }
    return out;
  }

  const ll = ([lat, lon]) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

  function updateNavLinks() {
    const { coords, a, b } = state.route;
    // Google Maps: "undvik motorvägar" + 3 punkter längs vår rutt så att appen följer samma väg.
    // Fler än 3 punkter ignoreras i mobilwebbläsare, och för korta resor behövs inga.
    const params = new URLSearchParams({
      api: "1",
      destination: ll([b.lat, b.lon]),
      travelmode: "driving",
      avoid: "highways",
      dir_action: "navigate",
    });
    // Utan origin startar Google Maps från telefonens position.
    if (a !== state.myPos) params.set("origin", ll([a.lat, a.lon]));
    if (state.route.km > 3) params.set("waypoints", pointsAlong(coords, 3).map(ll).join("|"));
    els.navGoogle.href = `https://www.google.com/maps/dir/?${params}`;

    // Apple Kartor kan inte ta emot "undvik motorvägar" via länk – visas bara på iPhone/iPad.
    els.navApple.hidden = !IS_IOS;
    if (IS_IOS) {
      els.navApple.href = `https://maps.apple.com/?saddr=${ll([a.lat, a.lon])}&daddr=${ll([b.lat, b.lon])}&dirflg=d`;
    }
  }

  els.navApple.addEventListener("click", (e) => {
    if (!confirm("Apple Kartor kan välja motorväg. Slå på \"Undvik motorvägar\" under Vägbeskrivning i Apple Kartor innan du kör. Fortsätta?")) {
      e.preventDefault();
    }
  });

  // ---------- Fel ----------
  class UserError extends Error {}
  function showError(msg) { els.error.textContent = msg; els.error.hidden = false; }
  function hideError() { els.error.hidden = true; }

  // ---------- Start ----------
  // Datorn: visa kartan (Sverige) från start. Mobilen: först när en rutt finns (se drawMap).
  const desktopQuery = window.matchMedia("(min-width: 900px)");
  if (desktopQuery.matches) initMap();
  desktopQuery.addEventListener?.("change", (e) => { if (e.matches) initMap(); });

  // ---------- Vägval ----------
  const ROUTE_HINTS = {
    kortast: "Snabbast – kan gå på större vägar där EPA är tillåten.",
    lugnast: "Mindre vägar med lugnare trafik – oftast lite längre.",
  };
  function setRouteMode(mode, recalc) {
    state.routeMode = mode;
    routeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.route === mode)));
    $("route-hint").textContent = ROUTE_HINTS[mode];
    save();
    if (recalc && state.route) calculate();
  }
  routeButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.route !== state.routeMode) setRouteMode(b.dataset.route, true);
  }));

  setRouteMode(state.routeMode, false);
  setFuel(state.fuel);
  loadPrices();

  // ---------- Installera som app ----------
  // Android/Chrome: knappen öppnar telefonens egen installationsruta direkt (beforeinstallprompt).
  // iPhone: Apple tillåter inte det – där visas en kort guide till Dela → Lägg till på hemskärmen.
  (() => {
    const DISMISS_KEY = "epakollen:install-dismissed";
    const DISMISS_DAYS = 30;
    const banner = $("install");
    const sheet = $("install-sheet");
    const ua = navigator.userAgent;
    const isIOS = IS_IOS;
    const isAndroid = /Android/i.test(ua);
    const isInApp = /FBAN|FBAV|Instagram|Snapchat|TikTok|musical_ly|Line\//i.test(ua);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    let deferredPrompt = null;
    const isMobile = isIOS || isAndroid || /Mobile/i.test(ua);
    if (!isMobile) $("install-sub").textContent = "Eget fönster och snabbare start";

    function dismissedRecently() {
      try {
        const t = Number(localStorage.getItem(DISMISS_KEY));
        return t && Date.now() - t < DISMISS_DAYS * 864e5;
      } catch { return false; }
    }
    function show() {
      if (standalone || dismissedRecently() || location.protocol === "file:") return;
      banner.hidden = false;
      document.body.classList.add("has-install");
    }
    function hide() {
      banner.hidden = true;
      document.body.classList.remove("has-install");
    }

    $("install-close").addEventListener("click", () => {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignorera */ }
      hide();
    });

    $("install-btn").addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        deferredPrompt = null;
        if (outcome === "accepted") hide();
        return;
      }
      $("steps-ios").hidden = !isIOS;
      $("steps-android").hidden = isIOS;
      $("sheet-inapp").hidden = !isInApp;
      if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
    });
    $("sheet-ok").addEventListener("click", () => sheet.close ? sheet.close() : sheet.removeAttribute("open"));
    // Klick på den mörka bakgrunden utanför rutan stänger den
    sheet.addEventListener("click", (e) => {
      const r = sheet.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
    });

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      show();
    });
    window.addEventListener("appinstalled", hide);

    // Chrome/Edge (mobil och dator) visar rutan när beforeinstallprompt kommer ovan.
    // iPhone har ingen installationshändelse – visa rutan direkt.
    // Android-webbläsare utan beforeinstallprompt (t.ex. Firefox) får guiden efter en kort stund.
    if (isIOS) show();
    else if (isAndroid) setTimeout(() => { if (!deferredPrompt) show(); }, 2500);
  })();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
