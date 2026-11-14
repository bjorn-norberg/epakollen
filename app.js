(() => {
  "use strict";

  // Fordon: EPA/A-traktor 30 km/h, mopedbil 45 km/h. Vägarna är desamma (inte motorväg/motortrafikled),
  // så rutten beräknas alltid med samma inställningar – bara restiden skiljer.
  const ROUTE_SPEED = 30;
  const VEHICLES = { epa: { speed: 30 }, mopedbil: { speed: 45 } };
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
    rCost: $("r-cost"), rFuel: $("r-fuel"), rDist: $("r-dist"), rMil: $("r-mil"),
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
    vehicle: saved.vehicle in VEHICLES ? saved.vehicle : "epa",
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
      localStorage.setItem(STORE, JSON.stringify({ ...cur, fuel: state.fuel, consumption: state.consumption, routeMode: state.routeMode, vehicle: state.vehicle, ...extra }));
    } catch { /* privat läge e.d. */ }
  }

  // ---------- Förbrukning ----------
  for (let i = 10; i <= 200; i += 5) {
    const v = i / 100;
    const opt = new Option(`${fmt2.format(v)} l/mil`, v.toFixed(2));
    els.consumption.add(opt);
  }
  els.consumption.value = Number(state.consumption).toFixed(2);
  els.consumption.addEventListener("change", () => {
    state.consumption = parseFloat(els.consumption.value);
    updateEpaSummary();
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
  function speed() { return VEHICLES[state.vehicle].speed; }

  // Diskret avdelare mellan uppgifter: ett tunt, dämpat streck (ritas i CSS, inte som tecken)
  const SEP = '<i class="sep" aria-hidden="true"></i>';

  // Sammanfattningen på den hopfällda raden under "Ditt fordon"
  function updateEpaSummary() {
    const fuel = state.fuel === "bensin" ? "Bensin" : "Diesel";
    $("epa-summary").innerHTML = `${fuel}${SEP}${fmt2.format(state.consumption)} l/mil${SEP}${fmt2.format(currentPrice())} kr/l`;
  }

  function renderPriceNote() {
    updateEpaSummary();
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
      n.innerHTML = `Rikssnitt för ${name}${SEP}<b>${when}</b>. Tanka billigare? Ändra priset.`;
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
      input.value = p.main;   // bara ortsnamnet får plats i fältet; län och ort syns i förslagslistan
      input.title = p.label;
      close();
      if (key === "from" && !els.to.value) els.to.focus();
      else {
        // Klart val: släpp fokus så att tangentbordet försvinner (annars ligger det kvar över kartan på mobilen)
        input.blur();
        autoCalculate();
      }
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
          els.from.value = `Min position · ${named.main}`;
          els.from.title = p.label;
          p.shareName = named.main; // ortsnamnet används när resan delas eller sparas
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
  async function getRoute(a, b, mode) {
    const body = {
      locations: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }],
      costing: "motor_scooter",
      // Kortast: hög topphastighet i ruttberäkningen gör att riksvägar föredras, vilket ger nästan kortaste väg.
      //   (Ruttjänstens egen "shortest"-inställning ger ibland rutter via andra länder på långa sträckor.)
      // Lugnast: föredrar mindre vägar framför stora huvudvägar.
      // Mopedreglerna gäller i båda – aldrig motorväg eller motortrafikled. Restiden räknas i appen på fordonets hastighet.
      costing_options: {
        motor_scooter: mode === "kortast"
          ? { top_speed: 90, use_primary: 1.0 }
          : { top_speed: ROUTE_SPEED, use_primary: 0.1, use_hills: 0.5 },
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
    if (data.error_code === 154) throw new UserError("Sträckan är för lång för ruttjänsten (max ungefär 20 mil fågelvägen). Dela upp resan i två delar.");
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
    input.value = r[0].main;
    input.title = r[0].label;
    return r[0];
  }

  // ---------- Beräkning ----------
  let calcSeq = 0;
  let countSeq = 0;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobileLayout = () => window.matchMedia("(max-width: 899px)").matches;
  const otherMode = (m = state.routeMode) => (m === "kortast" ? "lugnast" : "kortast");
  const mins = (km) => Math.round((km / speed()) * 60);
  const fmtKm = (km) => `${km < 10 ? fmt1.format(km) : fmt0.format(km)} km`;
  const fmtDur = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);

  // Räkna direkt när en plats valts och båda fälten är ifyllda – det finns ingen räkna-knapp.
  function autoCalculate() {
    if (els.from.value.trim() && els.to.value.trim()) calculate();
  }

  function markStale() {
    if (state.route) {
      els.results.dataset.stale = "Välj en plats i listan";
      els.results.classList.add("stale");
      $("map-wrap").classList.add("stale");
    }
  }

  // Egen mjuk scroll: webbläsarens inbyggda "smooth" går inte att sakta ner och är ryckig/snabb på iPhone.
  // Lugn start och mjuk inbromsning (easeInOutCubic); avbryts om användaren själv rör sidan.
  let scrollFrame = 0;
  function softScrollTo(el, duration = 1100) {
    cancelAnimationFrame(scrollFrame);
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    const target = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - margin));
    const start = window.scrollY;
    const dist = target - start;
    if (Math.abs(dist) < 4 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo(0, target);
      return;
    }
    // Längre avstånd får lite längre tid, men aldrig mer än ca 1,6 s
    const time = Math.min(1600, duration + Math.abs(dist) * 0.25);
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const stop = () => { cancelAnimationFrame(scrollFrame); clearTimeout(fallback); cleanup(); };
    const cleanup = () => ["wheel", "touchstart", "keydown"].forEach((ev) => window.removeEventListener(ev, stop));
    ["wheel", "touchstart", "keydown"].forEach((ev) => window.addEventListener(ev, stop, { passive: true }));
    let done = false;
    const finish = () => { done = true; clearTimeout(fallback); cleanup(); };
    const step = (now) => {
      const p = Math.min(1, (now - t0) / time);
      window.scrollTo(0, start + dist * ease(p));
      if (p < 1) scrollFrame = requestAnimationFrame(step); else finish();
    };
    // Reserv: om webbläsaren pausar animationer (t.ex. bakgrundsflik) hamnar sidan ändå rätt
    const fallback = setTimeout(() => { if (!done) { window.scrollTo(0, target); finish(); } }, time + 250);
    scrollFrame = requestAnimationFrame(step);
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
      const mode = state.routeMode;
      const r = await getRoute(a, b, mode);
      if (seq !== calcSeq) return;
      state.routes = { [mode]: r };
      state.altState = "loading";
      state.route = { ...r, a, b };
      els.results.classList.remove("stale");
      $("map-wrap").classList.remove("stale");
      if (!state.departTouched) setNow();
      els.results.hidden = false;
      renderResult();
      // På mobilen scrollar sidan först ner till kartan – vänta med animationen så att den syns
      const delay = isMobileLayout() ? 650 : 0;
      drawMap(delay);
      countUpCost(delay);
      updateNavLinks();
      addRecents(a, b);
      loadAlternative(seq, a, b, mode);
      if (isMobileLayout()) {
        softScrollTo($("map-wrap"));
      } else {
        // Dator: se till att resultatet syns i vänsterkolumnen
        els.results.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (e) {
      if (seq !== calcSeq) return;
      showError(e instanceof UserError ? e.message : "Något gick fel. Försök igen.");
      if (state.route) {
        els.results.dataset.stale = "Ingen ny rutt – se felet ovan";
        els.results.classList.add("stale");
        $("map-wrap").classList.add("stale");
      }
    } finally {
      if (seq !== calcSeq) return;
      els.status.hidden = true;
      state.calculating = false;
    }
  }

  // Det andra vägvalet hämtas i bakgrunden, så att första svaret kommer lika snabbt som förut
  async function loadAlternative(seq, a, b, mode) {
    const other = otherMode(mode);
    try {
      const r = await getRoute(a, b, other);
      if (seq !== calcSeq) return;
      state.routes[other] = r;
      state.altState = "ok";
    } catch {
      if (seq !== calcSeq) return;
      state.altState = "failed";
    }
    renderRouteChoice();
    drawAlt(true);
  }

  // Rutorna under kartan: valt vägval med sträcka och tid, det andra med skillnaden
  function renderRouteChoice() {
    const cur = state.routes && state.routes[state.routeMode];
    for (const mode of ["kortast", "lugnast"]) {
      const el = $(`rc-${mode}`);
      const btn = el.parentElement;
      const r = state.routes && state.routes[mode];
      btn.disabled = false;
      if (!cur) { el.textContent = ""; continue; }
      if (mode === state.routeMode) {
        el.innerHTML = `${fmtKm(r.km)}${SEP}${fmtDur(mins(r.km))}`;
      } else if (r) {
        const dKm = r.km - cur.km;
        const dMin = mins(r.km) - mins(cur.km);
        if (Math.abs(dKm) < 0.1) el.textContent = "Samma väg";
        else {
          const sign = dKm > 0 ? "+" : "−";
          el.innerHTML = `${sign}${fmtKm(Math.abs(dKm))}${SEP}${sign}${fmtDur(Math.abs(dMin))}`;
        }
      } else if (state.altState === "loading") {
        el.textContent = "Räknar…";
      } else {
        el.textContent = "Gick inte att räkna";
        btn.disabled = true;
      }
    }
  }

  // Kostnaden räknas upp till sitt värde när en ny resa räknats ut
  function countUpCost(delay, dur = 900) {
    if (reducedMotion() || !state.route) return;
    const seq = countSeq;
    const final = els.rCost.textContent;
    const to = parseInt(final.replace(/\D/g, ""), 10) || 0;
    const t0 = performance.now() + delay;
    els.rCost.textContent = "0 kr";
    const step = (now) => {
      if (seq !== countSeq) return;
      const k = Math.max(0, Math.min(1, (now - t0) / dur));
      els.rCost.textContent = `${fmt0.format(Math.round(to * (1 - Math.pow(1 - k, 3))))} kr`;
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    // Reserv om webbläsaren pausar animationer: visa alltid rätt slutvärde
    setTimeout(() => { if (seq === countSeq) els.rCost.textContent = final; }, delay + dur + 300);
  }

  function renderResult() {
    if (!state.route) return;
    countSeq++; // avbryter en pågående uppräkning av kostnaden
    const km = state.route.km;
    const liters = (km / 10) * state.consumption;
    const cost = liters * currentPrice();
    const minutes = Math.round((km / speed()) * 60);

    els.rCost.textContent = `${fmt0.format(Math.round(cost))} kr`;
    els.rFuel.innerHTML = `${fmt1.format(liters)} liter ${state.fuel}${SEP}${fmt2.format(currentPrice())} kr/l`;
    // Enheter i mindre text så att tre nyckeltal ryms bredvid varandra även på mobil
    els.rDist.innerHTML = `${km < 10 ? fmt1.format(km) : fmt0.format(km)}<small>km</small>`;
    els.rTime.innerHTML = minutes < 60
      ? `${minutes}<small>min</small>`
      : `${Math.floor(minutes / 60)}<small>h</small>&nbsp;${String(minutes % 60).padStart(2, "0")}<small>min</small>`;
    const songs = Math.max(1, Math.round(minutes / 3.5));
    els.rSongs.textContent = `≈ ${songs} ${songs === 1 ? "låt" : "låtar"}`;
    els.rMil.textContent = `${fmt1.format(km / 10)} mil`;

    const [hh, mm] = (els.depart.value || "00:00").split(":").map(Number);
    const dep = new Date(); dep.setHours(hh, mm, 0, 0);
    const arr = new Date(dep.getTime() + minutes * 60000);
    els.rArrive.textContent = arr.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((new Date(arr).setHours(0, 0, 0, 0) - new Date(dep).setHours(0, 0, 0, 0)) / 864e5);
    els.rDay.textContent = days === 0 ? `avresa ${els.depart.value}` : days === 1 ? "imorgon" : `om ${days} dagar`;
    renderRouteChoice();
  }

  // ---------- Karta ----------
  // Kartan visas från start med en utzoomad bild av Sverige och ritar sedan upp rutten.
  const SWEDEN_BOUNDS = [[55.2, 10.9], [69.1, 24.2]];
  let map, layer, altLayer, lastBounds = null;

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

  function drawMap(delay = 0, dur = 1300) {
    $("map-wrap").classList.add("shown"); // på mobil är kartan dold tills det finns en rutt
    initMap();
    if (!map) return;
    if (layer) layer.remove();
    if (altLayer) { altLayer.remove(); altLayer = null; }
    const { coords, a, b } = state.route;
    const bounds = L.latLngBounds(coords);
    const alt = state.routes && state.routes[otherMode()];
    if (alt) bounds.extend(L.latLngBounds(alt.coords));
    // Sätt vyn innan lagren läggs till, annars kan Leaflet rita mot en odefinierad zoom.
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [28, 28], animate: false });
    const animate = !reducedMotion();
    const pin = (cls, style = "") => L.divIcon({ className: "", html: `<span class="pin ${cls}" style="${style}"></span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    const glow = L.polyline(coords, { color: "#FF4FA3", weight: 10, opacity: 0.25 });
    const main = L.polyline(coords, { color: "#D4FF3A", weight: 4.5, opacity: 1, lineJoin: "round" });
    layer = L.layerGroup([
      glow, main,
      L.marker([a.lat, a.lon], { icon: pin("pin-from") }),
      L.marker([b.lat, b.lon], { icon: animate ? pin("pin-to pop", `--d:${delay + dur - 150}ms`) : pin("pin-to") }),
    ]).addTo(map);
    lastBounds = bounds;
    $("map-hint").hidden = true;
    $("map-wrap").classList.remove("stale");
    drawAlt(false);
    if (animate) {
      drawLine([glow, main], delay, dur);
      // Reserv om webbläsaren pausar animationer: målnålen ska alltid synas
      const group = layer;
      setTimeout(() => group.eachLayer((l) => {
        const pinEl = l.getElement && l.getElement() && l.getElement().querySelector && l.getElement().querySelector(".pin.pop");
        if (pinEl) pinEl.classList.remove("pop");
      }), delay + dur + 700);
    }
  }

  // Det andra vägvalet: svag prickad linje under den valda rutten. Ett tryck på linjen byter vägval.
  function drawAlt(refit) {
    if (altLayer) { altLayer.remove(); altLayer = null; }
    const other = otherMode();
    const r = state.routes && state.routes[other];
    if (!map || !r || !state.route) return;
    if (Math.abs(r.km - state.route.km) < 0.1) return; // samma väg – inget att visa
    altLayer = L.polyline(r.coords, { color: "#D4FF3A", weight: 4, opacity: 0.55, dashArray: "1 9", lineCap: "round" }).addTo(map);
    altLayer.bringToBack();
    altLayer.on("click", () => setRouteMode(other, true));
    if (refit) {
      const bounds = L.latLngBounds(state.route.coords).extend(altLayer.getBounds());
      lastBounds = bounds;
      if (!map.getBounds().contains(altLayer.getBounds())) map.fitBounds(bounds, { padding: [28, 28] });
    }
  }

  // Ritar upp linjerna längs vägen. pathLength=1 gör att animationen tål att kartan zoomas under tiden.
  function drawLine(lines, delay, dur) {
    lines.forEach((line) => {
      const p = line.getElement && line.getElement();
      if (!p || !p.animate) return;
      p.setAttribute("pathLength", "1");
      p.style.strokeDasharray = "1";
      const an = p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
        { duration: dur, delay, easing: "cubic-bezier(.3, .1, .2, 1)", fill: "backwards" });
      let cleaned = false;
      const clean = () => {
        if (cleaned) return;
        cleaned = true;
        p.removeAttribute("pathLength");
        p.style.strokeDasharray = "";
      };
      an.onfinish = clean;
      // Reserv om webbläsaren pausar animationer: linjen ska alltid bli hel
      setTimeout(() => { try { an.cancel(); } catch { /* ignorera */ } clean(); }, delay + dur + 400);
    });
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
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const installed = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

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
    const web = `https://www.google.com/maps/dir/?${params}`;
    // Från en installerad app öppnas google.com-länkar i en inbyggd webbvy i stället för i Google Maps-appen.
    // Därför lämnas samma adress över direkt till appen, så att "undvik motorvägar" och punkterna följer med:
    // Android: en intent (Chrome öppnar webbversionen om appen saknas).
    // iPhone i installerad app: comgooglemapsurl:// (webbversionen öppnas om appen saknas, se klicklyssnaren nedan).
    // Dator och Safari: vanlig länk i ny flik.
    let href = web;
    if (IS_ANDROID) {
      href = `intent://www.google.com/maps/dir/?${params}#Intent;scheme=https;`
        + `package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(web)};end`;
    } else if (IS_IOS && installed()) {
      href = web.replace("https://", "comgooglemapsurl://");
    }
    els.navGoogle.href = href;
    els.navGoogle.dataset.web = web;
    if (href === web) els.navGoogle.target = "_blank"; else els.navGoogle.removeAttribute("target");

    // Apple Kartor kan inte ta emot "undvik motorvägar" via länk – visas bara på iPhone/iPad.
    // maps:// öppnar appen direkt, även från en installerad app.
    els.navApple.hidden = !IS_IOS;
    if (IS_IOS) {
      els.navApple.href = `maps://?saddr=${ll([a.lat, a.lon])}&daddr=${ll([b.lat, b.lon])}&dirflg=d`;
    }
  }

  // iPhone: saknas Google Maps-appen händer inget när comgooglemapsurl:// öppnas.
  // Ligger sidan fortfarande framme efter en stund öppnas webbversionen i stället.
  els.navGoogle.addEventListener("click", () => {
    if (!els.navGoogle.href.startsWith("comgooglemapsurl:")) return;
    const web = els.navGoogle.dataset.web;
    const t = setTimeout(() => { if (document.visibilityState === "visible") location.href = web; }, 1500);
    const cancel = () => clearTimeout(t);
    document.addEventListener("visibilitychange", cancel, { once: true });
    window.addEventListener("pagehide", cancel, { once: true });
  });

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
  // Båda vägvalen hämtas vid varje sökning, så ett byte går direkt utan nytt anrop.
  function setRouteMode(mode, user) {
    state.routeMode = mode;
    routeButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.route === mode)));
    if (!user) return;
    save();
    if (!state.route) return;
    const r = state.routes && state.routes[mode];
    if (!r) { calculate(); return; }
    state.route = { ...r, a: state.route.a, b: state.route.b };
    renderResult();
    drawMap(0, 700);
    updateNavLinks();
  }
  routeButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.route !== state.routeMode) setRouteMode(b.dataset.route, true);
  }));

  // ---------- Fordon ----------
  const vehicleButtons = [...document.querySelectorAll("[data-vehicle]")];
  function setVehicle(v) {
    state.vehicle = v;
    vehicleButtons.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.vehicle === v)));
    $("fine-speed").textContent = speed();
    save();
    renderResult(); // bara restid och ankomst ändras – rutten är densamma
  }
  vehicleButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.vehicle !== state.vehicle) setVehicle(b.dataset.vehicle);
  }));

  setVehicle(state.vehicle);
  setRouteMode(state.routeMode, false);
  setFuel(state.fuel);
  loadPrices();

  // ---------- Sparade och senaste platser ----------
  // Sparas bara i den här webbläsaren (localStorage). Hem och Skolan väljer man själv, Senaste fylls på automatiskt.
  const SLOTS = [["hem", "Hem"], ["skolan", "Skolan"]];
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const ICON = {
    hem: svg('<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>'),
    skolan: svg('<path d="M3 9l9-5 9 5-9 5-9-5Z"/><path d="M7 12v4c2 2 8 2 10 0v-4"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>'),
  };
  let slots = (saved.slots && typeof saved.slots === "object") ? saved.slots : {};
  let recent = Array.isArray(saved.recent) ? saved.recent : [];
  const placesBox = $("places");
  const placesSheet = $("places-sheet");

  const isMyPos = (p) => p.main === "Min position";
  const placeName = (p) => p.shareName || (isMyPos(p) ? "min plats" : p.main);
  // Bara det som behövs sparas: namn och koordinater
  function slim(p) {
    return {
      lat: p.lat, lon: p.lon, main: placeName(p), sub: p.sub || "",
      label: isMyPos(p) ? String(p.label).replace(/^Min position · /, "") : p.label,
    };
  }
  const samePlace = (p, q) => p && q && distKm([p.lat, p.lon], [q.lat, q.lon]) < 0.2;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function chip(cls, icon, text, label, onClick) {
    const b = el("button", `pchip ${cls}`);
    b.type = "button";
    b.innerHTML = icon;
    if (text) b.append(el("span", "", text));
    if (label) b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    placesBox.append(b);
  }

  function renderPlaces() {
    placesBox.innerHTML = "";
    SLOTS.forEach(([key, name]) => {
      const p = slots[key];
      if (p) chip("", ICON[key], name, `${name}: ${p.label}`, () => usePlace(p));
      else chip("empty", ICON.plus, name, `Spara ${name}`, openPlaces);
    });
    recent.slice(0, 3).forEach((p) => chip("recent", ICON.clock, p.main, `Senaste: ${p.label}`, () => usePlace(p)));
    if (SLOTS.some(([k]) => slots[k]) || recent.length) chip("tool", ICON.edit, "", "Ändra sparade platser", openPlaces);
  }

  // Fyller start om den är tom, annars mål – och räknar direkt när båda finns
  function usePlace(p) {
    const key = els.from.value.trim() ? "to" : "from";
    state.places[key] = { ...p };
    els[key].value = p.main;
    els[key].title = p.label;
    hideError();
    markStale();
    autoCalculate();
  }

  function addRecents(a, b) {
    for (const p of [a, b]) {
      if (!p || isMyPos(p) || SLOTS.some(([k]) => samePlace(slots[k], p))) continue;
      const item = slim(p);
      recent = [item, ...recent.filter((r) => r.label !== item.label && !samePlace(r, item))].slice(0, 5);
    }
    save({ recent });
    renderPlaces();
  }

  function openPlaces() {
    const body = $("places-body");
    body.innerHTML = "";
    const cands = [["start", state.places.from], ["mål", state.places.to]].filter(([, p]) => p);
    SLOTS.forEach(([key, name]) => {
      const box = el("div", "slot");
      box.append(el("b", "", name), el("p", "", slots[key] ? slots[key].label : "Inte sparad"));
      const btns = el("div", "slot-btns");
      cands.forEach(([what, p]) => {
        const b = el("button", "", `Spara ${what}: ${placeName(p)}`);
        b.type = "button";
        b.addEventListener("click", () => { slots = { ...slots, [key]: slim(p) }; persistPlaces(); });
        btns.append(b);
      });
      if (slots[key]) {
        const b = el("button", "danger", "Ta bort");
        b.type = "button";
        b.addEventListener("click", () => { const next = { ...slots }; delete next[key]; slots = next; persistPlaces(); });
        btns.append(b);
      }
      if (btns.children.length) box.append(btns);
      body.append(box);
    });
    if (recent.length) {
      const box = el("div", "slot");
      box.append(el("b", "", "Senaste"), el("p", "", recent.map((p) => p.main).join(", ")));
      const btns = el("div", "slot-btns");
      const b = el("button", "danger", "Rensa senaste");
      b.type = "button";
      b.addEventListener("click", () => { recent = []; persistPlaces(); });
      btns.append(b);
      box.append(btns);
      body.append(box);
    }
    body.append(el("p", "sheet-info", cands.length
      ? "Platserna sparas bara i den här webbläsaren."
      : "Fyll i platsen som start eller mål först. Sedan kan du spara den som Hem eller Skolan här."));
    if (!placesSheet.open) { if (placesSheet.showModal) placesSheet.showModal(); else placesSheet.setAttribute("open", ""); }
  }
  function persistPlaces() {
    recent = recent.filter((r) => !SLOTS.some(([k]) => samePlace(slots[k], r)));
    save({ slots, recent });
    renderPlaces();
    openPlaces(); // rita om rutan med nya värden
  }
  $("places-ok").addEventListener("click", () => (placesSheet.close ? placesSheet.close() : placesSheet.removeAttribute("open")));
  placesSheet.addEventListener("click", (e) => {
    const r = placesSheet.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) placesSheet.close();
  });
  renderPlaces();

  // ---------- Dela resan ----------
  // Länken innehåller ortsnamn och koordinater, så mottagaren får exakt samma resa.
  // Egen position avrundas till ungefär 100 meter i länken.
  function shareData() {
    const { a, b } = state.route;
    const minutes = mins(state.route.km);
    const [hh, mm] = (els.depart.value || "00:00").split(":").map(Number);
    const dep = new Date(); dep.setHours(hh, mm, 0, 0);
    const arr = new Date(dep.getTime() + minutes * 60000).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
    const when = state.departTouched ? `kl. ${els.depart.value}` : "nu";
    const text = `Åker från ${placeName(a)} ${when}, framme i ${placeName(b)} ca ${arr}.`;
    const pos = (p) => (isMyPos(p) ? `${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : ll([p.lat, p.lon]));
    const q = new URLSearchParams({ fran: placeName(a), till: placeName(b), f: pos(a), t: pos(b) });
    if (state.routeMode === "lugnast") q.set("v", "lugnast");
    const base = location.protocol === "file:" ? "https://epa.junestaden.se/" : location.origin + location.pathname;
    return { text, url: `${base}?${q}` };
  }
  $("share").addEventListener("click", async () => {
    if (!state.route) return;
    const data = shareData();
    if (navigator.share) {
      try { await navigator.share({ text: data.text, url: data.url }); } catch { /* användaren avbröt */ }
      return;
    }
    // Dator utan delningsmeny: kopiera text och länk
    const full = `${data.text} ${data.url}`;
    try {
      await navigator.clipboard.writeText(full);
      $("share-label").textContent = "Kopierat";
      setTimeout(() => { $("share-label").textContent = "Dela"; }, 2000);
    } catch {
      window.prompt("Kopiera texten:", full);
    }
  });

  // Öppnad via en delad länk: fyll i resan och räkna direkt
  (function loadSharedTrip() {
    const q = new URLSearchParams(location.search);
    const till = (q.get("till") || "").trim().slice(0, 80);
    const fran = (q.get("fran") || "").trim().slice(0, 80);
    if (!till) return;
    const parse = (v, name) => {
      const m = /^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/.exec(v || "");
      if (!m || !name) return null;
      const lat = Number(m[1]), lon = Number(m[2]);
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      return { lat, lon, main: name, label: name, sub: "" };
    };
    if (fran) { els.from.value = fran; state.places.from = parse(q.get("f"), fran); }
    els.to.value = till;
    state.places.to = parse(q.get("t"), till);
    if (q.get("v") === "lugnast" || q.get("v") === "kortast") setRouteMode(q.get("v"), false);
    try { history.replaceState(null, "", location.pathname); } catch { /* ignorera */ }
    if (fran) calculate();
  })();

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
