/* Dashboard logic: state, editable tables, SVG charts, persistence.
 * No dependencies. Everything rendered from window.LabModel (engine.js).
 */
(function () {
  "use strict";

  var M = window.LabModel;
  var STORE = "labsudan.state.v1";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ utils */
  function nf(x, d) {
    if (x === null || x === undefined || isNaN(x)) return "—";
    d = d == null ? 0 : d;
    return Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function usd(x, d) {
    if (x === null || x === undefined || isNaN(x)) return "—";
    return nf(x, d) + "$";
  }
  function sdg(x) { return nf(x) + " SDG"; }   // SDG, not EGP
  function pct(x, d) {
    if (x === null || x === undefined || isNaN(x)) return "—";
    return nf(x, d == null ? 0 : d) + "%";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* One list of every bound input in the Assumptions tab, so the sync and the
   * event wiring can never drift apart. */
  var ASSUM_MAP = {
    "fx-sdg": "A.fx_sdg", "fx-egp": "A.fx_egp", "price-index": "A.price_index",
    "tpp": "A.tests_per_patient", "days": "A.days", "fx-drift": "A.fx_drift",
    "pass": "A.pass_through", "lag": "A.pass_lag_months", "erosion": "A.price_erosion",
    "leak": "A.revenue_leakage", "referral": "A.referral_pct",
    "shift": "A.shift_min", "eff": "A.tech_eff", "hire": "A.hire_at_util",
    "overhead": "A.overhead_min_per_order", "collect": "A.collection_consumables_usd",
    "importprem": "A.import_premium", "discount": "A.discount", "tax": "A.tax",
    "p2m": "A.phase2_month", "p3m": "A.phase3_month", "stock": "A.stock_months",
    "recv": "A.wc_months_recv", "freight": "freight", "install": "install",
    "cont": "contingency", "openstock": "stock_opening", "svc": "A.service_contract_pct",
    "vcmult": "A.vc_mult", "lab-tech": "lab.tech", "lab-senior": "lab.senior_tech",
    "lab-phleb": "lab.phleb", "reagent-fx": "A.reagent_fx_beta"
  };
  /* Monte Carlo settings live in state.dist so they persist with everything else. */
  var DIST_MAP = {
    "vol_sigma": "d-vol", "fx_drift_mean": "d-fx", "fx_drift_sigma": "d-fx-sigma",
    "price_sigma": "d-price", "vc_sigma": "d-vc", "opex_sigma": "d-opex",
    "tpp_sigma": "d-tpp", "pass_sigma": "d-pass", "draws": "d-draws", "seed": "d-seed"
  };

  /* ------------------------------------------------------------------ state */
  var state = load();
  var results = null;
  var mc = null;            // last Monte Carlo result set
  var mcDirty = true;       // inputs moved since the last run
  var mcBusy = false;
  var LAST_SAVE = null;
  var SUPPRESS_AUTOSAVE = false;   // set while the app rewrites state on purpose

  function EMPTY_PLAN() {
    return { name: "", location: "", owner: "", date: "", area: "", notes: "",
             strengths: "", weaknesses: "", recommendations: "" };
  }

  /* A blank but STRUCTURALLY valid starting point: one of each row type so the
     tables are visible, with zeros you replace. Nothing is pre-filled. */
  function blankState() {
    var s = M.makeState();
    return {
      preset: "custom",
      A: Object.assign({}, s.A),
      menu: [
        { key: "t1", label: "Test 1", price_usd: 0, vc: 0, tech_min: 5, share: 1, phase: 1, note: "" },
        { key: "t2", label: "Test 2", price_usd: 0, vc: 0, tech_min: 5, share: 0, phase: 1, note: "" }
      ],
      capex_p1: [
        { item: "Machine 1", qty: 1, unit: 0, src: "custom", note: "" },
        { item: "Item 2", qty: 1, unit: 0, src: "custom", note: "" }
      ],
      capex_p2: [{ item: "Item", qty: 1, unit: 0, src: "custom", note: "" }],
      capex_p3: [{ item: "Item", qty: 1, unit: 0, src: "custom", note: "" }],
      fixed_opex: [
        { label: "Rent", usd: 0 },
        { label: "Salary", usd: 0 }
      ],
      lab: Object.assign({}, s.lab),
      ramp: s.ramp.slice(),
      plan: Object.assign({}, EMPTY_PLAN()),
      dist: Object.assign({}, M.DIST),
      stock_opening: 0,
      contingency: 0,
      freight: 0,
      install: 0
    };
  }

  /* The worked example from the study: the SAMPLE numbers you can edit or wipe. */
  function defaultsState() {
    var s = M.makeState();
    return {
      preset: "example",
      A: Object.assign({}, s.A),
      menu: s.menu.map(function (m) { return Object.assign({}, m); }),
      capex_p1: s.capex_p1.map(function (c) { return Object.assign({}, c); }),
      capex_p2: s.capex_p2.map(function (c) { return Object.assign({}, c); }),
      capex_p3: s.capex_p3.map(function (c) { return Object.assign({}, c); }),
      fixed_opex: s.fixed_opex.map(function (c) { return Object.assign({}, c); }),
      lab: Object.assign({}, s.lab),
      ramp: s.ramp.slice(),
      // editable business-plan text (shown on the report page)
      plan: Object.assign({}, EMPTY_PLAN()),
      dist: Object.assign({}, M.DIST),
      stock_opening: s.stock_opening,
      contingency: s.contingency,
      freight: s.freight,
      install: s.install
    };
  }
  var DEFAULTS = defaultsState();

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return defaultsState();
      var got = JSON.parse(raw);
      var base = defaultsState();
      var merged = mergeDeep(base, got);
      if (!merged.dist || typeof merged.dist !== "object") merged.dist = Object.assign({}, M.DIST);
      if (merged.A.reagent_fx_beta === undefined) merged.A.reagent_fx_beta = M.A.reagent_fx_beta;
      return merged;
    } catch (e) { return defaultsState(); }
  }

  function mergeDeep(base, over) {
    Object.keys(over || {}).forEach(function (k) {
      var v = over[k];
      if (Array.isArray(v)) base[k] = v;
      else if (v && typeof v === "object" && base[k] && typeof base[k] === "object") {
        mergeDeep(base[k], v);
      } else if (v !== undefined) base[k] = v;
    });
    return base;
  }

  var saveTimer = null;
  function save() {
    if (SUPPRESS_AUTOSAVE) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE, JSON.stringify(state));
        var el = $("#save-state");
        if (!el) return;
        LAST_SAVE = new Date();
        el.textContent = "Saved " + LAST_SAVE.toLocaleTimeString("en-GB",
          { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        el.className = "pill g";
        el.title = "Stored in this browser (localStorage). Nothing is uploaded.";
      } catch (e) {
        var el2 = $("#save-state");
        if (el2) {
          el2.textContent = "Save failed - storage full or blocked";
          el2.className = "pill r";
        }
      }
    }, 250);
  }

  /* ramp: the UI exposes only the month-12 target; the rest scales proportionally */
  function setRamp12(v) {
    var base = M.RAMP, last = base[11];
    var f = v / last;
    state.ramp = base.map(function (x) { return Math.round(x * f * 10) / 10; });
  }

  function getByPath(o, path) {
    return path.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o);
  }
  function setByPath(o, path, v) {
    var ks = path.split("."), last = ks.pop();
    var t = ks.reduce(function (a, k) { return a[k]; }, o);
    t[last] = v;
  }

  /* ---------------------------------------------------------------- compute */
  /* Two-stage compute. The base case is what every keystroke needs (KPIs and
   the live tables); the three scenarios are only needed by the overview charts,
   which are already debounced. Splitting them took typing work from ~17 ms to
   ~3 ms on a 4x-throttled CPU. */
  function compute(needScen) {
    var st = M.makeState(state);
    var base = M.run(st, {});
    var m = M.metrics(base);
    var nm = M.minutesPerOrder(st);
    results = { st: st, base: base, m: m, minutes: nm,
                scen: needScen ? M.scenarios(st) : (results ? results.scen : null) };
    return results;
  }

  /* ------------------------------------------------------------------- KPIs */
  function renderKpis() {
    var m = results.m;
    var isBlank = results.st.capex_p1.every(function (c) { return !c.unit; })
               && results.st.menu.every(function (t) { return !t.price_usd; });
    // nudge the user to the input tabs when nothing is priced yet
    var hint = $("#empty-hint");
    if (hint) hint.hidden = !isBlank;
    var pb = m.payback_months === null
      ? { v: "Never", s: "within 36 months", c: "bad" }
      : { v: nf(m.payback_months, 1) + " mo", s: "excludes terminal value",
          c: m.payback_months <= 18 ? "good" : "warn" };

    var npvC = m.npv22 > 0 ? "good" : "bad";
    var beC = m.be_orders_day === null ? "bad"
      : (m.be_orders_day <= m.m12_orders_day ? "good" : "warn");

    var cards = [
      { k: "Total investment (3 phases)", v: usd(m.capex_total),
        s: usd(m.p1) + " in phase 1", c: "" },
      { k: "Cash needed to open", v: usd(m.funding_need),
        s: "lowest point: month " + m.trough_month, c: "warn" },
      { k: "Payback", v: pb.v, s: pb.s, c: pb.c },
      { k: "EBITDA margin (month 12)", v: isFinite(m.m12_margin) ? pct(m.m12_margin) : "—",
        s: usd(m.m12_rev) + " revenue / month",
        c: !isFinite(m.m12_margin) ? "" : m.m12_margin >= 30 ? "good" : "warn" },
      { k: "Break-even",
        v: (m.be_orders_day === null || !isFinite(m.be_orders_day)) ? "—" : nf(m.be_orders_day, 1) + " orders/day",
        s: (m.be_patients_day === null || !isFinite(m.be_patients_day))
            ? "enter prices and costs" : "about " + nf(m.be_patients_day, 0) + " patients/day", c: beC },
      { k: "Net present value (22%)", v: usd(m.npv22),
        s: "36 months" + (m.irr_annual === null ? "" : " · IRR " + nf(m.irr_annual) + "%"), c: npvC }
    ];

    $("#kpis").innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + c.c + '"><span class="k">' + esc(c.k) + '</span>' +
        '<span class="v">' + esc(c.v) + '</span><span class="d">' + esc(c.s) + "</span></div>";
    }).join("");
  }

  /* ----------------------------------------------------------------- tables */
  function bindNum(el, path, opts) {
    opts = opts || {};
    var v = getByPath(state, path);
    el.value = v;
    el.setAttribute("data-path", path);
    el.className = isChanged(path) ? "changed" : "";
    el.addEventListener("input", function () {
      var raw = el.value.trim();
      if (raw === "") return;
      var num = Number(raw);
      if (isNaN(num)) return;
      if (opts.min != null) num = Math.max(opts.min, num);
      if (opts.max != null) num = Math.min(opts.max, num);
      setByPath(state, path, num);
      el.className = "changed";
      onChange();
    });
  }

  function isChanged(path) {
    if (path === "ramp12") return Math.abs(state.ramp[11] - DEFAULTS.ramp[11]) > 0.01;
    var a = getByPath(state, path), b = getByPath(DEFAULTS, path);
    if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) > 1e-9;
    return false;
  }

  var MENU_TBODY = null;
  function renderMenu() {
    var tb = $("#menu-table tbody");
    var m = results.base, r12 = m.months[11];
    var tot = state.menu.reduce(function (s, x) { return s + x.share; }, 0);

    tb.innerHTML = state.menu.map(function (item, i) {
      var per = r12.per[item.key] || { n: 0, contribution: 0, price_usd: 0 };
      var priceUsd = item.price_usd * state.A.price_index;
      var cm = priceUsd - item.vc * state.A.vc_mult * (1 + state.A.import_premium);
      var margin = priceUsd > 0 ? cm / priceUsd * 100 : 0;
      var cls = margin >= 70 ? "g" : margin >= 45 ? "a" : "r";
      return "<tr>" +
        '<td class="name"><input class="nameinput" type="text" ' +
          'data-menu="' + i + '" data-field="label" value="' + esc(item.label) + '" ' +
          'title="Rename this test"></td>' +
        '<td class="num"><input type="number" step="0.25" min="0" ' +
          'data-menu="' + i + '" data-field="price_usd" value="' + item.price_usd + '"></td>' +
        '<td class="num"><input type="number" step="0.05" min="0" ' +
          'data-menu="' + i + '" data-field="vc" value="' + item.vc + '"></td>' +
        '<td class="num"><input type="number" step="0.005" min="0" max="1" ' +
          'data-menu="' + i + '" data-field="share" value="' + item.share + '"></td>' +
        '<td class="num" data-derived="cm:' + i + '">' + nf(cm, 2) + "</td>" +
        '<td class="num" data-derived="mg:' + i + '"><span class="pill ' + cls + '">' + nf(margin) + "%</span></td>" +
        '<td class="num"><input type="number" step="0.5" min="0.5" ' +
          'data-menu="' + i + '" data-field="tech_min" value="' + item.tech_min + '"></td>' +
        '<td class="num" data-derived="n:' + i + '">' + nf(per.n, 0) + "</td>" +
        '<td class="num"><button class="btn sm ghost" data-del="menu" data-i="' + i +
          '" title="Delete test">✕</button></td>' +
        "</tr>";
    }).join("");

    var cards = $("#menu-cards");
    if (cards) {
      cards.innerHTML = state.menu.map(function (item, i) {
        var per = r12.per[item.key] || { n: 0, contribution: 0 };
        var priceUsd = item.price_usd * state.A.price_index;
        var cm = priceUsd - item.vc * state.A.vc_mult * (1 + state.A.import_premium);
        var margin = priceUsd > 0 ? cm / priceUsd * 100 : 0;
        var cls = margin >= 70 ? "g" : margin >= 45 ? "a" : "r";
        return '<div class="tcard">' +
          '<div class="tcard-h"><input class="nameinput" type="text" ' +
            'data-menu="' + i + '" data-field="label" value="' + esc(item.label) + '">' +
          '<span style="display:flex;gap:6px;align-items:center;flex:none">' +
            '<span class="pill ' + cls + '" data-derived="mgc:' + i + '">' + nf(margin) + "%</span>" +
            '<button class="btn sm ghost" data-del="menu" data-i="' + i + '" title="Delete">✕</button>' +
          "</span></div>" +
          '<div class="tcard-g">' +
            '<div class="field"><label>Price ($)</label><input type="number" step="0.25" min="0" ' +
              'data-menu="' + i + '" data-field="price_usd" value="' + item.price_usd + '"></div>' +
            '<div class="field"><label>Reagent cost ($)</label><input type="number" step="0.05" min="0" ' +
              'data-menu="' + i + '" data-field="vc" value="' + item.vc + '"></div>' +
            '<div class="field"><label>Order share</label><input type="number" step="0.005" min="0" max="1" ' +
              'data-menu="' + i + '" data-field="share" value="' + item.share + '"></div>' +
            '<div class="field"><label>Tech minutes</label><input type="number" step="0.5" min="0.5" ' +
              'data-menu="' + i + '" data-field="tech_min" value="' + item.tech_min + '"></div>' +
          "</div>" +
          '<div class="tcard-f"><span data-derived="cmc:' + i + '">' + usd(cm, 2) + ' / order</span>' +
            '<span data-derived="nc:' + i + '">' + nf(per.n, 0) + " orders/mo</span></div>" +
          "</div>";
      }).join("");
    }

    var tfoot = $("#menu-table tfoot");
    var shareSum = state.menu.reduce(function (s, x) { return s + x.share; }, 0);
    var revSum = 0, cmSum = 0;
    Object.keys(r12.per).forEach(function (k) {
      revSum += r12.per[k].revenue;
      cmSum += r12.per[k].contribution;
    });
    tfoot.innerHTML = "<tr class='total'><td>Total / average</td>" +
      "<td class='num'>—</td><td class='num'>—</td>" +
      "<td class='num' id='mt-share'>" + nf(shareSum * 100) + "%</td>" +
      "<td class='num' id='mt-cm'>" + nf(cmSum / (r12.orders || 1), 2) + "</td>" +
      "<td class='num' id='mt-mg'>" + nf(results.m.cm_pct) + "%</td>" +
      "<td class='num' id='mt-min'>" + nf(results.minutes, 1) + "</td>" +
      "<td class='num' id='mt-n'>" + nf(r12.orders) + "</td><td></td></tr>";

    var warn = Math.abs(shareSum - 1) > 0.02
      ? '<div class="note" style="margin:10px 0 0">Shares add up to ' + nf(shareSum * 100) +
        "% — shares are normalised to 100% when computing. Edit them for a different mix.</div>"
      : "";
    $("#menu-note").innerHTML = warn +
      "Contribution = USD price minus reagent cost. Margin is the same as a % of price. " +
      "Orders/month is month-12 volume at the current size.";
    $("#menu-count").textContent = state.menu.length + " tests";
  }

  /* Update only the computed cells of the test table. Rebuilding the whole
   table on every keystroke destroyed the focused input (caret jumped, focus
   was lost) and re-created 64 nodes per character. */
  function refreshMenuDerived() {
    var r12 = results.base.months[11];
    var fx = r12.fx, p = results.st.A;
    state.menu.forEach(function (item, i) {
      var priceUsd = item.price_usd * p.price_index;
      var cm = priceUsd - item.vc * p.vc_mult * (1 + p.import_premium);
      var margin = priceUsd > 0 ? cm / priceUsd * 100 : 0;
      var cls = margin >= 70 ? "g" : margin >= 45 ? "a" : "r";
      var per = r12.per[item.key] || { n: 0 };
      setTxt('[data-derived="cm:' + i + '"]', nf(cm, 2));
      setTxt('[data-derived="n:' + i + '"]', nf(per.n));
      setTxt('[data-derived="cmc:' + i + '"]', usd(cm, 2) + " / order");
      setTxt('[data-derived="nc:' + i + '"]', nf(per.n) + " orders/mo");
      setPill('[data-derived="mg:' + i + '"]', nf(margin) + "%", cls);
      setPill('[data-derived="mgc:' + i + '"]', nf(margin) + "%", cls);
    });
    var shareSum = state.menu.reduce(function (a, x) { return a + x.share; }, 0);
    var cmSum = 0;
    Object.keys(r12.per).forEach(function (k) { cmSum += r12.per[k].contribution; });
    setTxt("#mt-share", nf(shareSum * 100) + "%");
    setTxt("#mt-cm", nf(cmSum / (r12.orders || 1), 2));
    setTxt("#mt-mg", nf(results.m.cm_pct) + "%");
    setTxt("#mt-min", nf(results.minutes, 1));
    setTxt("#mt-n", nf(r12.orders));
  }

  function setTxt(sel, txt) {
    var el = document.querySelector(sel);
    if (el && el.textContent !== txt) el.textContent = txt;
  }
  function setPill(sel, txt, cls) {
    var el = document.querySelector(sel);
    if (!el) return;
    var inner = el.querySelector(".pill") || el;   // <td> wraps a span.pill
    if (inner.textContent !== txt) inner.textContent = txt;
    var want = "pill " + cls;
    if (inner.className !== want) inner.className = want;
  }

  function renderCapex() {
    // phase 1
    var tb = $("#capex1-table tbody");
    tb.innerHTML = state.capex_p1.map(function (c, i) {
      return "<tr>" +
        '<td><input class="wide" type="text" data-cx="1" data-i="' + i + '" data-f="item" value="' + esc(c.item_en || c.item) + '"></td>' +
        '<td class="num"><input type="number" min="0" step="1" data-cx="1" data-i="' + i + '" data-f="qty" value="' + c.qty + '"></td>' +
        '<td class="num"><input type="number" min="0" step="25" data-cx="1" data-i="' + i + '" data-f="unit" value="' + c.unit + '"></td>' +
        '<td class="num">' + usd(c.total != null ? c.total : c.qty * c.unit) + "</td>" +
        '<td><span class="pill ' + (c.kind === "quote" ? "a" : c.kind === "sourced" ? "g" : "") + '">' +
          (c.kind === "quote" ? "owner quote" : c.kind === "sourced" ? "vendor price" : "estimate") + "</span></td>" +
        '<td class="num"><button class="btn sm ghost" data-del="capex_p1" data-i="' + i + '" title="Delete">✕</button></td>' +
        "</tr>";
    }).join("");

    var cx = results.base.capex;
    $("#capex1-table tfoot").innerHTML =
      "<tr class='total'><td>Equipment</td><td></td><td></td><td class='num'>" + usd(cx.hardware) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>Freight and clearance " + nf(state.freight * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.freight) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>Install and training " + nf(state.install * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.install) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>Opening stock</td><td></td><td></td><td class='num'>" + usd(cx.stock) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>Contingency " + nf(state.contingency * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.contingency) + "</td><td colspan='2'></td></tr>" +
      "<tr class='total'><td>Phase 1 total</td><td></td><td></td><td class='num'>" + usd(cx.p1) + "</td><td colspan='2'></td></tr>";

    [2, 3].forEach(function (ph) {
      var key = "capex_p" + ph;
      var t = $("#capex" + ph + "-table tbody");
      t.innerHTML = state[key].map(function (c, i) {
        return "<tr>" +
          '<td><input class="wide" type="text" data-cx="' + ph + '" data-i="' + i + '" data-f="item" value="' + esc(c.item) + '"></td>' +
          '<td class="num"><input type="number" min="0" step="25" data-cx="' + ph + '" data-i="' + i + '" data-f="unit" value="' + c.unit + '"></td>' +
          '<td class="num"><button class="btn sm ghost" data-del="' + key + '" data-i="' + i + '" title="Delete">✕</button></td>' +
          "</tr>";
      }).join("");
      var tot = state[key].reduce(function (s, c) { return s + c.qty * c.unit; }, 0);
      $("#capex" + ph + "-table tfoot").innerHTML =
        "<tr class='total'><td>Total</td><td class='num'>" + usd(tot) + "</td><td></td></tr>";
    });

    // phone cards mirror the same rows
    var c1 = $("#capex1-cards");
    if (c1) {
      c1.innerHTML = state.capex_p1.map(function (c, i) {
        return '<div class="tcard"><div class="tcard-h">' +
          '<input class="nameinput" type="text" data-cx="1" data-i="' + i +
            '" data-f="item" value="' + esc(c.item_en || c.item) + '">' +
          '<button class="btn sm ghost" data-del="capex_p1" data-i="' + i + '" title="Delete">✕</button></div>' +
          '<div class="tcard-g">' +
            '<div class="field"><label>Qty</label><input type="number" min="0" step="1" ' +
              'data-cx="1" data-i="' + i + '" data-f="qty" value="' + c.qty + '"></div>' +
            '<div class="field"><label>Unit price ($)</label><input type="number" min="0" step="25" ' +
              'data-cx="1" data-i="' + i + '" data-f="unit" value="' + c.unit + '"></div>' +
          "</div>" +
          '<div class="tcard-f"><span>Total ' + usd(c.qty * c.unit) + "</span>" +
          "<span>" + (c.src === "own" ? "your quote" : "estimate") + "</span></div></div>";
      }).join("");
    }
    [2, 3].forEach(function (ph) {
      var el = $("#capex" + ph + "-cards");
      if (!el) return;
      el.innerHTML = state["capex_p" + ph].map(function (c, i) {
        return '<div class="tcard"><div class="tcard-h">' +
          '<input class="nameinput" type="text" data-cx="' + ph + '" data-i="' + i +
            '" data-f="item" value="' + esc(c.item) + '">' +
          '<button class="btn sm ghost" data-del="capex_p' + ph + '" data-i="' + i + '" title="Delete">✕</button></div>' +
          '<div class="tcard-g"><div class="field"><label>Price ($)</label>' +
            '<input type="number" min="0" step="25" data-cx="' + ph + '" data-i="' + i +
            '" data-f="unit" value="' + c.unit + '"></div></div></div>';
      }).join("");
    });

  }

  function refreshCapexTotals() {
    var cx = results.base.capex;
    var t1 = document.querySelector("#capex1-table tfoot");
    if (t1) {
      t1.innerHTML =
        "<tr class='total'><td>Equipment</td><td></td><td></td><td class='num'>" + usd(cx.hardware) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>Freight and clearance " + nf(state.freight * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.freight) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>Install and training " + nf(state.install * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.install) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>Opening stock</td><td></td><td></td><td class='num'>" + usd(cx.stock) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>Contingency " + nf(state.contingency * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.contingency) + "</td><td colspan='2'></td></tr>" +
        "<tr class='total'><td>Phase 1 total</td><td></td><td></td><td class='num'>" + usd(cx.p1) + "</td><td colspan='2'></td></tr>";
    }
    state.capex_p1.forEach(function (c, i) {
      var cell = document.querySelector('[data-cx="1"][data-i="' + i + '"][data-f="unit"]');
      if (!cell) return;
      var tr = cell.closest("tr");
      if (tr) setTxt2(tr.children[3], usd(c.qty * c.unit));
    });
    [2, 3].forEach(function (ph) {
      var tot = state["capex_p" + ph].reduce(function (a, c) { return a + c.qty * c.unit; }, 0);
      var tf = document.querySelector("#capex" + ph + "-table tfoot");
      if (tf) tf.innerHTML = "<tr class='total'><td>Total</td><td class='num'>" + usd(tot) + "</td><td></td></tr>";
    });
  }

  function refreshOpexTotals() {
    var sum = state.fixed_opex.reduce(function (a, o) { return a + o.usd; }, 0);
    var lab = results.base.months[11].labour;
    var tf = document.querySelector("#opex-table tfoot");
    if (tf) {
      tf.innerHTML =
        "<tr class='total'><td>Fixed cost total</td><td class='num'>" + usd(sum) +
        "</td><td class='num'>" + usd(sum * 12) + "</td><td></td></tr>" +
        "<tr><td>Staff wages (auto)</td><td class='num'>" + usd(lab) +
        "</td><td class='num'>" + usd(lab * 12) + "</td><td></td></tr>" +
        "<tr class='total'><td>Monthly total</td><td class='num'>" + usd(sum + lab) +
        "</td><td class='num'>" + usd((sum + lab) * 12) + "</td><td></td></tr>";
    }
    state.fixed_opex.forEach(function (o, i) {
      var cell = document.querySelector('[data-op="1"][data-i="' + i + '"][data-f="usd"]');
      if (!cell) return;
      var tr = cell.closest("tr");
      if (tr) setTxt2(tr.children[2], usd(o.usd * 12));
    });
  }

  function setTxt2(el, txt) {
    if (el && el.textContent !== txt) el.textContent = txt;
  }

  function renderOpex() {
    var tb = $("#opex-table tbody");
    tb.innerHTML = state.fixed_opex.map(function (o, i) {
      return "<tr>" +
        '<td><input class="wide" type="text" data-op="1" data-i="' + i + '" data-f="label" value="' + esc(o.label) + '"></td>' +
        '<td class="num"><input type="number" min="0" step="10" data-op="1" data-i="' + i + '" data-f="usd" value="' + o.usd + '"></td>' +
        '<td class="num">' + usd(o.usd * 12) + "</td>" +
        '<td class="num"><button class="btn sm ghost" data-del="fixed_opex" data-i="' + i + '" title="Delete">✕</button></td>' +
        "</tr>";
    }).join("");

    var sum = state.fixed_opex.reduce(function (s, o) { return s + o.usd; }, 0);
    var lab = results.base.months[11].labour;
    $("#opex-table tfoot").innerHTML =
      "<tr class='total'><td>Fixed cost total</td><td class='num'>" + usd(sum) +
      "</td><td class='num'>" + usd(sum * 12) + "</td><td></td></tr>" +
      "<tr><td>Staff wages (auto)</td><td class='num'>" + usd(lab) +
      "</td><td class='num'>" + usd(lab * 12) + "</td><td></td></tr>" +
      "<tr class='total'><td>Monthly total</td><td class='num'>" + usd(sum + lab) +
      "</td><td class='num'>" + usd((sum + lab) * 12) + "</td><td></td></tr>";

    var oc = $("#opex-cards");
    if (oc) {
      oc.innerHTML = state.fixed_opex.map(function (o, i) {
        return '<div class="tcard"><div class="tcard-h">' +
          '<input class="nameinput" type="text" data-op="1" data-i="' + i +
            '" data-f="label" value="' + esc(o.label) + '">' +
          '<button class="btn sm ghost" data-del="fixed_opex" data-i="' + i + '" title="Delete">✕</button></div>' +
          '<div class="tcard-g"><div class="field"><label>Monthly ($)</label>' +
            '<input type="number" min="0" step="10" data-op="1" data-i="' + i +
            '" data-f="usd" value="' + o.usd + '"></div>' +
            '<div class="field"><label>Yearly</label><input type="text" value="' +
            usd(o.usd * 12) + '" disabled></div></div></div>';
      }).join("");
    }

  }

  function renderMonthly() {
    var ms = results.base.months;
    $("#monthly-table tbody").innerHTML = ms.map(function (r) {
      var mg = r.rev > 0 ? r.ebitda / r.rev * 100 : 0;
      var cls = mg >= 25 ? "g" : mg >= 0 ? "a" : "r";
      return "<tr>" +
        '<td class="num">' + r.month + "</td>" +
        '<td class="num">' + nf(r.patients, 0) + "</td>" +
        '<td class="num">' + nf(r.orders_day, 0) + "</td>" +
        '<td class="num">' + r.techs + "</td>" +
        '<td class="num">' + nf(r.rev) + "</td>" +
        '<td class="num">' + nf(r["var"]) + "</td>" +
        '<td class="num">' + nf(r.labour) + "</td>" +
        '<td class="num">' + nf(r.fixed) + "</td>" +
        '<td class="num">' + nf(r.ebitda) + "</td>" +
        '<td class="num"><span class="pill ' + cls + '">' + nf(mg) + "%</span></td>" +
        '<td class="num">' + nf(r.fcf) + "</td>" +
        '<td class="num">' + nf(r.cum) + "</td>" +
        "</tr>";
    }).join("");

    var mc = $("#monthly-cards");
    if (mc) {
      mc.innerHTML = ms.map(function (r) {
        var mg = r.rev > 0 ? r.ebitda / r.rev * 100 : 0;
        var cls = mg >= 25 ? "g" : mg >= 0 ? "a" : "r";
        return '<div class="tcard mrow">' +
          '<div class="tcard-h"><span>Month ' + r.month + " · " + r.y + "-" + (r.m < 10 ? "0" : "") + r.m +
            '</span><span class="pill ' + cls + '">EBITDA ' + nf(mg) + "%</span></div>" +
          '<div class="mrow-g">' +
            "<span>Patients/day<b>" + nf(r.patients) + "</b></span>" +
            "<span>Orders/day<b>" + nf(r.orders_day) + "</b></span>" +
            "<span>Techs<b>" + r.techs + "</b></span>" +
            "<span>Net revenue<b>" + usd(r.rev) + "</b></span>" +
            "<span>Reagents<b>" + usd(r["var"]) + "</b></span>" +
            "<span>Wages<b>" + usd(r.labour) + "</b></span>" +
            "<span>Fixed<b>" + usd(r.fixed) + "</b></span>" +
            "<span>EBITDA<b>" + usd(r.ebitda) + "</b></span>" +
            "<span>Free cash flow<b>" + usd(r.fcf) + "</b></span>" +
            "<span>Cumulative<b>" + usd(r.cum) + "</b></span>" +
          "</div></div>";
      }).join("");
    }

    $("#scenario-table tbody").innerHTML = results.scen.map(function (s) {
      var m = s.m;
      return "<tr>" +
        "<td>" + esc(s.name) + "</td>" +
        '<td class="num">' + (s.key === "cons" ? "70%" : s.key === "opt" ? "125%" : "100%") + "</td>" +
        '<td class="num">' + nf(m.yr1_rev) + "</td>" +
        '<td class="num">' + nf(m.yr1_ebitda) + "</td>" +
        '<td class="num">' + nf(m.yr2_ebitda) + "</td>" +
        '<td class="num">' + (m.payback_months === null ? "—" : nf(m.payback_months, 1)) + "</td>" +
        '<td class="num">' + nf(m.funding_need) + "</td>" +
        '<td class="num">' + nf(m.npv22) + "</td>" +
        "</tr>";
    }).join("");
  }

  /* ----------------------------------------------------------------- charts */
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  /* SVG text needs an explicit direction: the page is RTL, so "start"/"end"
   anchors flip meaning. Numbers are isolated LTR, Arabic labels are RTL. */
  function svgText(svg, txt, x, y, opts) {
    opts = opts || {};
    var t = svgEl("text", {
      x: x, y: y,
      "text-anchor": opts.anchor || "start",
      "font-size": opts.size || 10,
      fill: opts.fill || "#7b8794",
      direction: opts.rtl ? "rtl" : "ltr",
      "font-weight": opts.weight || 400
    });
    if (opts.rtl) t.setAttribute("style", "unicode-bidi:isolate");
    t.textContent = txt;
    svg.appendChild(t);
    return t;
  }

  function chartFrame(host, h) {
    host.innerHTML = "";
    var w = host.clientWidth || 520;
    var svg = svgEl("svg", { viewBox: "0 0 " + w + " " + h, width: "100%", height: h,
                             role: "img", preserveAspectRatio: "none" });
    host.appendChild(svg);
    return { svg: svg, w: w, h: h };
  }
  function niceStep(span, target) {
    var raw = span / (target || 4);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm > 5 ? 10 : norm > 2 ? 5 : norm > 1 ? 2 : 1;
    return step * mag;
  }

  function kFmt(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "M";
    if (a >= 1000) return (v / 1000).toFixed(0) + "k";
    return String(Math.round(v));
  }

  function drawCashflow() {
    var host = $("#ch-cashflow");
    if (!host) return;
    var f = chartFrame(host, host.clientHeight || 300);
    var svg = f.svg, W = f.w, H = f.h;
    var pad = { l: 44, r: 10, t: 12, b: 24 };
    var series = results.scen.map(function (s) {
      return { name: s.name, key: s.key, data: s.res.months.map(function (r) { return r.cum; }) };
    });
    var all = series.reduce(function (a, s) { return a.concat(s.data); }, [0]);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var step = niceStep(hi - lo || 1, 4);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    var X = function (i) { return pad.l + (W - pad.l - pad.r) * i / 35; };
    var Y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo)); };

    for (var v = lo; v <= hi + 1e-6; v += step) {
      svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v),
        stroke: "#e6ecf2", "stroke-width": 1 }));
      svgText(svg, kFmt(v), pad.l - 6, Y(v) + 4, { anchor: "end" });
    }
    if (lo < 0 && hi > 0) {
      svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0),
        stroke: "#9aa6b2", "stroke-width": 1 }));
    }

    var colors = { cons: "#a3261f", base: "#12507a", opt: "#1d7a4d" };
    series.forEach(function (s) {
      var d = s.data.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
      svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: colors[s.key],
        "stroke-width": s.key === "base" ? 2.6 : 1.8, "stroke-linejoin": "round" }));
    });

    [1, 6, 12, 18, 24, 30, 36].forEach(function (m) {
      svgText(svg, String(m), X(m - 1), H - 6, { anchor: "middle" });
    });

    var m = results.m;
    $("#cashflow-note").textContent = m.payback_months === null
      ? "The base case does not pay back within 36 months with the current inputs."
      : "Base-case payback: " + nf(m.payback_months, 1) + " months. " +
        "Cumulative cash after 36 months: " + usd(m.m36_cum) + ".";
  }

  function drawBreakeven() {
    var host = $("#ch-breakeven");
    if (!host) return;
    var f = chartFrame(host, host.clientHeight || 300);
    var svg = f.svg, W = f.w, H = f.h;
    var m = results.m;
    if (m.be_orders_day === null) {
      host.innerHTML = '<p class="empty">Contribution margin is negative - check prices and costs.</p>';
      return;
    }
    var maxX = Math.max(120, Math.ceil(m.be_orders_day * 1.6), Math.ceil(m.m12_orders_day * 1.3));
    var pad = { l: 46, r: 12, t: 14, b: 26 };
    var cmDay = m.cm_usd * results.st.A.days;
    var fixed = m.fixed_all_m12;
    var hiYRaw = Math.max(fixed * 1.7, cmDay * maxX);
    var stepY = niceStep(hiYRaw, 4);
    var hiY = Math.ceil(hiYRaw / stepY) * stepY;
    var X = function (o) { return pad.l + (W - pad.l - pad.r) * o / maxX; };
    var Y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - v / hiY); };

    for (var v = 0; v <= hiY + 1e-6; v += stepY) {
      svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v),
        stroke: "#e6ecf2", "stroke-width": 1 }));
      svgText(svg, kFmt(v), pad.l - 6, Y(v) + 4, { anchor: "end" });
    }
    svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(fixed), y2: Y(fixed),
      stroke: "#a3261f", "stroke-width": 2 }));
    svg.appendChild(svgEl("line", { x1: X(0), y1: Y(0), x2: X(maxX), y2: Y(cmDay * maxX),
      stroke: "#1d7a4d", "stroke-width": 2.4 }));
    svg.appendChild(svgEl("line", { x1: X(m.be_orders_day), x2: X(m.be_orders_day),
      y1: Y(0), y2: Y(hiY), stroke: "#9aa6b2", "stroke-width": 1, "stroke-dasharray": "4 4" }));
    svg.appendChild(svgEl("circle", { cx: X(m.m12_orders_day), cy: Y(m.m12_orders_day * cmDay),
      r: 4.5, fill: "#12507a" }));

    svgText(svg, "Break-even " + nf(m.be_orders_day, 0) + " orders/day",
            X(m.be_orders_day) - 6, Y(hiY * 0.88), { anchor: "start", rtl: true, fill: "#4a5866" });
    svgText(svg, "Orders per day", (X(0) + X(maxX)) / 2, H - 6,
            { anchor: "middle", rtl: true });

    $("#breakeven-note").textContent =
      "Fixed cost " + usd(fixed) + "/mo - contribution " + usd(m.cm_usd, 2) +
      " per order - month-12 safety margin " + pct(m.mos_pct) + ".";
  }

  function drawMonthly() {
    var host = $("#ch-monthly");
    if (!host) return;
    var f = chartFrame(host, host.clientHeight || 260);
    var svg = f.svg, W = f.w, H = f.h;
    var ms = results.base.months;
    var pad = { l: 42, r: 8, t: 12, b: 22 };
    var hiRaw = Math.max.apply(null, ms.map(function (r) { return r.rev; }));
    var st0 = niceStep(hiRaw || 1, 4);
    var hi = Math.ceil(hiRaw * 1.05 / st0) * st0;
    var X = function (i) { return pad.l + (W - pad.l - pad.r) * i / 35; };
    var Y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - v / hi); };
    var bw = Math.max(2, (W - pad.l - pad.r) / 36 * 0.55);

    for (var v = 0; v <= hi + 1e-6; v += st0) {
      svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v),
        stroke: "#e6ecf2", "stroke-width": 1 }));
      svgText(svg, kFmt(v), pad.l - 5, Y(v) + 4, { anchor: "end", size: 9.5 });
    }
    ms.forEach(function (r, i) {
      var cost = r["var"] + r.collect + r.service + r.fixed + r.labour;
      svg.appendChild(svgEl("rect", { x: X(i) - bw / 2, y: Y(r.rev), width: bw,
        height: Math.max(0, Y(0) - Y(r.rev)), fill: "#12507a", opacity: .9 }));
      svg.appendChild(svgEl("rect", { x: X(i) + bw / 2, y: Y(cost), width: bw,
        height: Math.max(0, Y(0) - Y(cost)), fill: "#c8860d", opacity: .85 }));
    });
    var d = ms.map(function (r, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(Math.max(0, r.ebitda)).toFixed(1); }).join(" ");
    svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: "#a3261f", "stroke-width": 2 }));

    [1, 6, 12, 18, 24, 30, 36].forEach(function (m) {
      svgText(svg, String(m), X(m - 1), H - 6, { anchor: "middle", size: 9.5 });
    });
  }

  function drawCostMix() {
    var host = $("#ch-costmix");
    if (!host) return;
    var r = results.base.months[11];
    var items = [
      ["Reagents & consumables", r["var"], "#12507a"],
      ["Wages", r.labour, "#c8860d"],
      ["Fixed costs", r.fixed, "#7d8b99"],
      ["Collection consumables", r.collect, "#4b7f9e"],
      ["Referral commission", r.referral, "#b06a2c"],
      ["Revenue leakage", r.rev_gross - r.rev - r.referral, "#c0a08a"]
    ].filter(function (x) { return x[1] > 0.5; });
    var total = items.reduce(function (s, x) { return s + x[1]; }, 0);
    var rows = items.map(function (x) {
      return '<div style="display:flex;align-items:center;gap:8px;margin:7px 0">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + x[2] + ';flex:none"></span>' +
        '<span style="flex:1;font-size:13.5px">' + esc(x[0]) + "</span>" +
        '<span style="font-variant-numeric:tabular-nums;font-size:13px;color:#4a5866">' +
          usd(x[1]) + "</span>" +
        '<span style="width:44px;text-align:left;font-size:12.5px;color:#7b8794">' +
          nf(x[1] / total * 100) + "%</span>" +
        "</div>";
    }).join("");
    // stacked bar
    var acc = 0;
    var segs = items.map(function (x) {
      var w = x[1] / total * 100;
      var s = '<span style="display:block;height:12px;width:' + w + "%;background:" + x[2] + '"></span>';
      acc += w;
      return s;
    }).join("");
    host.innerHTML = '<div style="display:flex;border-radius:6px;overflow:hidden;margin:4px 0 12px">' +
      segs + "</div>" + rows +
      '<p class="chart-note" style="margin-top:10px">Total cash cost ' + usd(total) +
      " on gross revenue " + usd(r.rev_gross) + " - EBITDA margin " + pct(results.m.m12_margin) + ".</p>";
  }

  function drawTornado() {
    var host = $("#ch-tornado");
    if (!host) return;
    var st = results.st;
    var tests = [
      ["Daily order volume", function (v) { return M.metrics(M.run(st, { vol: v })).npv22; }, 0.6, 1.4, "%"],
      ["Real selling price", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { price_index: st.A.price_index * v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.85, 1.15, "%"],
      ["Reagent cost", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { vc_mult: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.65, 1.45, "%"],
      ["Tests per patient", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { tests_per_patient: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 1.2, 1.85, "x"],
      ["FX pass-through", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { pass_through: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.5, 1.0, "%"],
      ["SDG depreciation", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { fx_drift: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.10, 0.60, "%"],
      ["Fixed costs", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { opex_mult: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.85, 1.20, "%"],
      ["Equipment price", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { capex_mult: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.8, 1.3, "%"]
    ];
    var base = results.m.npv22;
    var rows = tests.map(function (t) {
      return { name: t[0], lo: t[1](t[2]), hi: t[1](t[3]), loV: t[2], hiV: t[3], unit: t[4] };
    });
    rows.forEach(function (r) { r.swing = Math.abs(r.lo - r.hi); });
    rows.sort(function (a, b) { return b.swing - a.swing; });

    var all = rows.reduce(function (a, r) { return a.concat([r.lo, r.hi, base]); }, []);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var span = hi - lo || 1;
    lo -= span * 0.05; hi += span * 0.05;
    var pos = function (v) { return (v - lo) / (hi - lo) * 100; };

    // The bars are plain <div>s: RTL text and phones then behave like every
    // other block in the page, and no SVG text anchor can send a label off-screen.
    host.innerHTML = '<div class="legend" style="margin:0 0 10px">' +
        '<span><i style="background:#a3261f"></i>Low end</span>' +
        '<span><i style="background:#1d7a4d"></i>High end</span>' +
        '<span><i style="background:#16212b"></i>Base case (' + usd(base) + ")</span>" +
      "</div>" + rows.map(function (r) {
      var a = pos(r.lo), b = pos(r.hi), m = pos(base);
      var x1 = Math.min(a, m), w1 = Math.abs(m - a);
      var x2 = Math.min(b, m), w2 = Math.abs(b - m);
      var rng = r.unit === "x" ? (r.loV + "x – " + r.hiV + "x")
        : ((r.loV * 100).toFixed(0) + "% – " + (r.hiV * 100).toFixed(0) + "%");
      return '<div style="margin:0 0 10px">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;' +
          'color:#22303c;margin-bottom:3px">' +
          '<span style="font-weight:600">' + esc(r.name) + "</span>" +
          '<span style="color:#7b8794;direction:ltr;unicode-bidi:isolate">' + esc(rng) + "</span>" +
        "</div>" +
        '<div style="position:relative;height:16px;background:#f2f5f8;border-radius:5px;overflow:hidden">' +
          '<span title="' + usd(r.lo) + '" style="position:absolute;top:0;bottom:0;' +
            "left:" + x1.toFixed(2) + "%;width:" + Math.max(0.6, w1).toFixed(2) +
            '%;background:#a3261f;opacity:.88"></span>' +
          '<span title="' + usd(r.hi) + '" style="position:absolute;top:0;bottom:0;' +
            "left:" + x2.toFixed(2) + "%;width:" + Math.max(0.6, w2).toFixed(2) +
            '%;background:#1d7a4d;opacity:.88"></span>' +
          '<span style="position:absolute;top:-2px;bottom:-2px;left:' + m.toFixed(2) +
            '%;width:2px;background:#16212b"></span>' +
        "</div>" +
        "</div>";
    }).join("");
  }

  /* capital split: where the phase-1 money actually goes */
  function drawCapexSplit() {
    var host = $("#ch-capexplit");
    if (!host) return;
    var cx = results.base.capex;
    var ANALYZERS = /CBC|chemistr|centrifuge|microscope|ESR|Vortex|Rotator|pipette|balance|stand/i;
    var BASICS = /fridge|generator|UPS|AVR|AC |still|bath|PC |LIS/i;
    var hw = results.st.capex_p1.map(function (c) { return { item: c.item, total: c.qty * c.unit }; });
    var sum = function (re) {
      return hw.filter(function (x) { return re.test(x.item); })
               .reduce(function (a, x) { return a + x.total; }, 0);
    };
    var analyzers = sum(ANALYZERS), basics = sum(BASICS);
    var rest = Math.max(0, cx.hardware - analyzers - basics);
    var groups = [
      ["Analyzers and pipettes", analyzers, "#12507a"],
      ["Fit-out, furniture, licensing", rest, "#3f7fa6"],
      ["Essentials (fridge/generator/UPS/AC)", basics, "#7ba7c4"],
      ["Freight and clearance", cx.freight, "#c8860d"],
      ["Install and training", cx.install, "#d9a54a"],
      ["Opening stock", cx.stock, "#1d7a4d"],
      ["Contingency", cx.contingency, "#9aa6b2"]
    ].filter(function (g) { return g[1] > 1; });
    var total = groups.reduce(function (a, g) { return a + g[1]; }, 0);
    var bar = groups.map(function (g) {
      return '<span title="' + esc(g[0]) + " — " + usd(g[1]) + '" style="display:block;height:14px;width:' +
        (g[1] / total * 100).toFixed(2) + "%;background:" + g[2] + '"></span>';
    }).join("");
    var rows = groups.map(function (g) {
      return '<div style="display:flex;align-items:center;gap:8px;margin:6px 0;font-size:13px">' +
        '<span style="width:10px;height:10px;border-radius:3px;background:' + g[2] + ';flex:none"></span>' +
        '<span style="flex:1">' + esc(g[0]) + "</span>" +
        '<span style="font-variant-numeric:tabular-nums;color:#4a5866">' + usd(g[1]) + "</span>" +
        '<span style="width:42px;text-align:left;color:#7b8794;font-size:12px">' +
          nf(g[1] / total * 100) + "%</span></div>";
    }).join("");
    host.innerHTML = '<div style="display:flex;border-radius:7px;overflow:hidden;margin:2px 0 12px">' +
      bar + "</div>" + rows +
      '<p class="chart-note" style="margin-top:8px">Total investment ' + usd(total) +
      " - equipment " + usd(cx.hardware) + "</p>";
  }

  /* contribution per technologist-minute — the real ranking of the menu */
  function drawPerMinute() {
    var host = $("#ch-perminute");
    if (!host) return;
    var r12 = results.base.months[11];
    var fx = r12.fx, p = results.st.A;
    var rows = Object.keys(r12.per).map(function (k) {
      var mw = null;
      results.st.menu.forEach(function (x) { if (x.key === k) mw = x; });
      if (!mw) return null;
      var usdPrice = mw.price_usd * p.price_index;
      var vc = mw.vc * p.vc_mult * (1 + p.import_premium);
      var mins = mw.tech_min + p.overhead_min_per_order;
      return { label: mw.label, perMin: (usdPrice - vc) / mins, mins: mins,
               contrib: usdPrice - vc, n: r12.per[k].n };
    }).filter(Boolean);
    rows.sort(function (a, b) { return b.perMin - a.perMin; });
    var top = rows.slice(0, 8);
    var max = top[0].perMin || 1;
    host.innerHTML = top.map(function (r) {
      return '<div style="margin:0 0 9px">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px;margin-bottom:2px">' +
          '<span style="font-weight:600">' + esc(r.label) + "</span>" +
          '<span style="color:#7b8794;direction:ltr;unicode-bidi:isolate">$' +
            r.perMin.toFixed(2) + " / min</span></div>" +
        '<div style="height:12px;background:#f2f5f8;border-radius:4px;overflow:hidden">' +
          '<span style="display:block;height:100%;width:' + (r.perMin / max * 100).toFixed(1) +
          '%;background:#12507a"></span></div>' +
        "</div>";
    }).join("") +
      '<p class="chart-note">' + nf(rows.length) + " active tests - best value per tech-minute: " +
      esc(top[0].label) + "</p>";
  }

  function drawAll() {
    try {
      drawCashflow();
      drawCapexSplit();
      drawPerMinute();
      drawBreakeven();
      drawMonthly();
      drawCostMix();
      drawTornado();
    } catch (e) { console.error(e); }
  }

  /* --------------------------------------------------------------- onChange */
  var raf = null;
  var chartTimer = null;
  var saveTimer2 = null;
  function onChange(opts) {
    opts = opts || {};
    mcDirty = true;
    // localStorage write is ~1 KB of JSON; do it off the typing path
    clearTimeout(saveTimer2);
    saveTimer2 = setTimeout(save, 180);
    if (raf) cancelAnimationFrame(raf);
    var PERF = window.__perf;
    var t0 = PERF ? performance.now() : 0;
    raf = requestAnimationFrame(function () {
      compute(currentTab() === "overview");
      var t1 = PERF ? performance.now() : 0;
      renderKpis();
      var t2 = PERF ? performance.now() : 0;
      var panel = currentTab();
      // Live tables only refresh their computed columns, so the input you are
      // typing in keeps focus and caret position.
      if (panel === "tests") refreshMenuDerived();
      if (panel === "capex") refreshCapexTotals();
      if (panel === "opex") refreshOpexTotals();
      if (panel === "monthly") renderMonthly();
      if (opts.full) {
        if (panel === "capex") renderCapex();
        if (panel === "opex") renderOpex();
      }
      var t3 = PERF ? performance.now() : 0;
      if (PERF) {
        PERF.push({ compute: +(t1 - t0).toFixed(2), kpis: +(t2 - t1).toFixed(2),
                    tables: +(t3 - t2).toFixed(2) });
      }
      clearTimeout(chartTimer);
      chartTimer = setTimeout(function () {
        if (currentTab() !== "overview") return;
        if (!results.scen) compute(true);
        drawAll();
      }, 140);
    });
  }


  /* ================================================================== QUANT
   * The Monte Carlo tab. Draws are generated by engine.js from state.dist, run
   * in small chunks through the same run()/metrics() the rest of the app uses,
   * and summarised by mcSummaryFrom(). Nothing here re-implements the model.
   * ==================================================================== */
  function distCfg() {
    var d = Object.assign({}, M.DIST, state.dist || {});
    return d;
  }

  function updateMcStatus(txt, cls) {
    var el = $("#mc-status");
    if (!el) return;
    el.textContent = txt;
    el.className = "sub" + (cls ? " " + cls : "");
  }

  function renderQuantKpis(sm) {
    var host = $("#qkpis");
    if (!host || !sm) return;
    var pbMed = sm.pb_p50 === null ? "Never" : nf(sm.pb_p50, 1) + " mo";
    var cards = [
      { k: "Median NPV (22%)", v: usd(sm.npv_p50), s: "10th - 90th: " + usd(sm.npv_p10) + " to " + usd(sm.npv_p90), c: sm.npv_p50 > 0 ? "good" : "bad" },
      { k: "Chance of a loss", v: pct(sm.p_npv_neg * 100, 1), s: "NPV below zero, " + nf(sm.n) + " simulations", c: sm.p_npv_neg < 0.15 ? "good" : sm.p_npv_neg < 0.35 ? "warn" : "bad" },
      { k: "Chance of NPV over 50k", v: pct(sm.p_npv_50k * 100, 1), s: "upside case", c: sm.p_npv_50k > 0.5 ? "good" : "warn" },
      { k: "Median payback", v: pbMed, s: "90th percentile " + (sm.pb_p90 === null ? "-" : nf(sm.pb_p90, 1) + " mo"), c: "warn" },
      { k: "Never pays back", v: pct(sm.p_never_payback * 100, 1), s: "not inside 36 months", c: sm.p_never_payback < 0.1 ? "good" : "warn" },
      { k: "Cash needed (90th pct)", v: usd(sm.fund_p90), s: "plan for this, not the median", c: "warn" }
    ];
    host.innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + c.c + '"><span class="k">' + esc(c.k) + '</span>' +
        '<span class="v">' + esc(c.v) + '</span><span class="d">' + esc(c.s) + "</span></div>";
    }).join("");
  }

  function renderQuantTables() {
    var sm = mc && mc.sm;
    if (!sm) return;
    var rows = [
      ["Net present value", usd(sm.npv_p10), usd(sm.npv_p50), usd(sm.npv_p90),
       "36 months at 22%; one quarter of outcomes fall below the first column"],
      ["Payback (months)", sm.pb_p10 === null ? "-" : nf(sm.pb_p10, 1), sm.pb_p50 === null ? "-" : nf(sm.pb_p50, 1),
       sm.pb_p90 === null ? "-" : nf(sm.pb_p90, 1), "How long until the cash invested is back"],
      ["Break-even (orders/day)", nf(sm.be_p10), nf(sm.be_p50), nf(sm.be_p90),
       "Volume needed to cover fixed costs and wages"],
      ["Month-12 EBITDA margin", "-", pct(sm.margin_p50), "-", "Median operating margin in month 12"],
      ["Cash needed before opening", "-", usd(sm.fund_p90), "-",
       "Use the 90th percentile as the funding target"]
    ];
    var tb = $("#mc-table tbody");
    if (tb) {
      tb.innerHTML = rows.map(function (r) {
        return "<tr><td>" + esc(r[0]) + '</td><td class="num">' + esc(r[1]) +
          '</td><td class="num">' + esc(r[2]) + '</td><td class="num">' + esc(r[3]) +
          "</td><td>" + esc(r[4]) + "</td></tr>";
      }).join("");
    }
    var cards = $("#mc-cards");
    if (cards) {
      cards.innerHTML = rows.map(function (r) {
        return '<div class="tcard"><div class="tcard-h"><span>' + esc(r[0]) + "</span></div>" +
          '<div class="mrow-g"><span>10th pct<b>' + esc(r[1]) + "</b></span>" +
          "<span>Median<b>" + esc(r[2]) + "</b></span>" +
          "<span>90th pct<b>" + esc(r[3]) + "</b></span></div>" +
          '<div class="tcard-f"><span>' + esc(r[4]) + "</span></div></div>";
      }).join("");
    }

    var sc = $("#quant-scenario-table tbody");
    if (sc && results.scen) {
      sc.innerHTML = results.scen.map(function (s) {
        var m = s.m;
        return "<tr><td>" + esc(s.name) + "</td>" +
          '<td class="num">' + nf(m.yr1_rev) + "</td>" +
          '<td class="num">' + nf(m.yr1_ebitda) + "</td>" +
          '<td class="num">' + nf(m.yr2_ebitda) + "</td>" +
          '<td class="num">' + (m.payback_months === null ? "-" : nf(m.payback_months, 1)) + "</td>" +
          '<td class="num">' + nf(m.funding_need) + "</td>" +
          '<td class="num">' + nf(m.npv22) + "</td>" +
          '<td class="num">' + (m.be_orders_day === null ? "-" : nf(m.be_orders_day, 1)) + "</td></tr>";
      }).join("");
    }
  }

  /* a small histogram drawn as plain divs: no SVG text anchoring problems,
   * and it reflows on a phone like every other block */
  function drawMcHistogram(hostSel, noteSel) {
    var host = $(hostSel || "#ch-mc");
    if (!host || !mc || !mc.rows) return;
    var vals = mc.rows.map(function (r) { return r.npv; });
    // clip to the 1st-99th percentile: a handful of extreme draws would
    // otherwise squash the whole shape into two bars
    var lo = M.quantile(vals, 0.01), hi = M.quantile(vals, 0.99);
    var pad = (hi - lo) * 0.05 || 1;
    lo -= pad; hi += pad;
    var bins = 26, counts = new Array(bins).fill(0), clipped = 0;
    vals.forEach(function (v) {
      if (v < lo || v > hi) { clipped++; return; }
      var i = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / (hi - lo) * bins)));
      counts[i]++;
    });
    var maxC = Math.max.apply(null, counts) || 1;
    var base = results.m.npv22;
    var baseX = (base - lo) / (hi - lo) * 100;
    var bars = counts.map(function (c, i) {
      var x0 = i / bins * 100, w = 100 / bins;
      var centre = lo + (hi - lo) * (i + 0.5) / bins;
      var col = centre < 0 ? "#a3261f" : centre < base ? "#c8860d" : "#1d7a4d";
      return '<span title="' + usd(centre) + " - " + c + ' runs" style="position:absolute;bottom:0;' +
        "left:" + x0.toFixed(2) + "%;width:" + w.toFixed(2) + "%;height:" +
        (c / maxC * 100).toFixed(1) + "%;background:" + col + ';opacity:.88"></span>';
    }).join("");
    host.innerHTML =
      '<div style="position:relative;height:210px;border-bottom:1px solid #dfe5ec;' +
        'background:linear-gradient(to top,#f7f9fb,#fff)">' + bars +
        '<span style="position:absolute;top:0;bottom:0;left:' + baseX.toFixed(2) +
          '%;width:2px;background:#16212b" title="Your point estimate: ' + usd(base) + '"></span>' +
      "</div>" +
      '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:#7b8794;margin-top:6px">' +
        "<span>" + usd(lo) + "</span><span>" + usd(base) + " (point estimate)</span><span>" + usd(hi) + "</span></div>";
    var note = $(noteSel || "#mc-note");
    if (note) note.textContent = nf(mc.sm.n) + " simulations, axis clipped to the 1st-99th percentile (" +
      clipped + " extreme runs left out). Green = better than your point estimate, amber = positive but " +
      "below it, red = a loss.";
  }

  function drawMcRho(hostSel) {
    var host = $(hostSel || "#ch-mcrho");
    if (!host || !mc || !mc.rho) return;
    var LABELS = {
      vol: "Daily order volume", price_index: "Realized price",
      vc_mult: "Reagent cost", fx_drift: "SDG depreciation",
      tests_per_patient: "Tests per patient", opex_mult: "Fixed costs",
      pass_through: "FX pass-through"
    };
    var max = Math.max.apply(null, mc.rho.map(function (r) { return Math.abs(r.rho); })) || 1;
    host.innerHTML = mc.rho.map(function (r) {
      var w = Math.abs(r.rho) / max * 100;
      var pos = r.rho >= 0;
      return '<div style="margin:0 0 9px">' +
        '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:3px">' +
          "<span style=\"font-weight:600\">" + esc(LABELS[r.key] || r.key) + "</span>" +
          '<span style="color:#7b8794;font-variant-numeric:tabular-nums">' + (r.rho * 100).toFixed(0) + "%</span></div>" +
        '<div style="height:12px;background:#f2f5f8;border-radius:4px;overflow:hidden">' +
          '<span style="display:block;height:100%;width:' + w.toFixed(1) + "%;background:" +
          (pos ? "#1d7a4d" : "#a3261f") + '"></span></div></div>';
    }).join("");
  }

  function drawFxChart(hostSel, noteSel) {
    var host = $(hostSel || "#ch-fx");
    if (!host) return;
    var rows = M.fxLadder(results.st);
    host.innerHTML = "";
    var W = host.clientWidth || 520, H = host.clientHeight || 300;
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", height: H,
                             preserveAspectRatio: "none", role: "img" });
    host.appendChild(svg);
    var pad = { l: 46, r: 12, t: 14, b: 26 };
    var all = [];
    rows.forEach(function (r) { all.push(r.npv, r.sticky_npv); });
    all.push(0);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var step = niceStep((hi - lo) || 1, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var X = function (i) { return pad.l + (W - pad.l - pad.r) * i / (rows.length - 1); };
    var Y = function (v) { return pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo)); };
    for (var v = lo; v <= hi + 1e-6; v += step) {
      svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v),
        stroke: "#e6ecf2", "stroke-width": 1 }));
      svgText(svg, kFmt(v), pad.l - 6, Y(v) + 4, { anchor: "end" });
    }
    if (lo < 0 && hi > 0) {
      svg.appendChild(svgEl("line", { x1: pad.l, x2: W - pad.r, y1: Y(0), y2: Y(0),
        stroke: "#9aa6b2", "stroke-width": 1 }));
    }
    [["npv", "#12507a", 2.6], ["sticky_npv", "#a3261f", 1.8]].forEach(function (s) {
      var d = rows.map(function (r, i) {
        return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(r[s[0]]).toFixed(1);
      }).join(" ");
      svg.appendChild(svgEl("path", { d: d, fill: "none", stroke: s[1], "stroke-width": s[2] }));
    });
    rows.forEach(function (r, i) {
      if (i % 2 === 0) svgText(svg, (r.drift * 100).toFixed(0) + "%", X(i), H - 6, { anchor: "middle" });
    });
    var note = $(noteSel || "#fx-note");
    if (note && rows.length) {
      var last = rows[rows.length - 1];
      note.textContent = "At " + (last.drift * 100).toFixed(0) +
        "% annual depreciation the disciplined case keeps NPV at " + usd(last.npv) +
        " while a slow list falls to " + usd(last.sticky_npv) + ".";
    }
  }

  function renderPriceGrid() {
    var rows = M.pricingGrid(results.st);
    var avg = results.m.avg_price_usd;
    var tb = $("#price-grid tbody");
    var html = rows.map(function (r) {
      var head = r.price_needed > 0 ? avg / r.price_needed - 1 : 0;
      var cls = head >= 0.15 ? "g" : head >= 0 ? "a" : "r";
      return "<tr><td class='num'>" + r.orders_day + "</td>" +
        "<td class='num'>" + usd(r.price_needed, 2) + "</td>" +
        "<td class='num'>" + usd(avg, 2) + "</td>" +
        "<td class='num'><span class='pill " + cls + "'>" + pct(head * 100, 0) + "</span></td></tr>";
    }).join("");
    if (tb) tb.innerHTML = html;
    var cards = $("#price-grid-cards");
    if (cards) {
      cards.innerHTML = rows.map(function (r) {
        var head = r.price_needed > 0 ? avg / r.price_needed - 1 : 0;
        return '<div class="tcard"><div class="tcard-h"><span>' + r.orders_day + " orders/day</span>" +
          "<span class='pill " + (head >= 0.15 ? "g" : head >= 0 ? "a" : "r") + "'>" + pct(head * 100, 0) + "</span></div>" +
          '<div class="mrow-g"><span>Price needed<b>' + usd(r.price_needed, 2) + "</b></span>" +
          "<span>Your average<b>" + usd(avg, 2) + "</b></span></div></div>";
      }).join("");
    }
  }

  function renderRepricing() {
    var rows = M.repricing(results.st);
    var tb = $("#repricing-table tbody");
    var html = rows.map(function (r) {
      return "<tr><td class='num'>" + r.lag + "</td><td class='num'>" + nf(r.npv22) +
        "</td><td class='num'>" + nf(r.m12_ebitda) + "</td><td class='num'>" +
        (r.pb === null ? "-" : nf(r.pb, 1)) + "</td></tr>";
    }).join("");
    if (tb) tb.innerHTML = html;
    var cards = $("#repricing-cards");
    if (cards) {
      cards.innerHTML = rows.map(function (r) {
        return '<div class="tcard"><div class="tcard-h"><span>' + r.lag + " month old list</span></div>" +
          '<div class="mrow-g"><span>NPV<b>' + nf(r.npv22) + "</b></span>" +
          "<span>M12 EBITDA<b>" + nf(r.m12_ebitda) + "</b></span>" +
          "<span>Payback<b>" + (r.pb === null ? "-" : nf(r.pb, 1)) + "</b></span></div></div>";
      }).join("");
    }
    var note = $("#repricing-note");
    if (note && rows.length) {
      var cost = rows[0].npv22 - rows[rows.length - 1].npv22;
      note.textContent = "Letting the list run " + rows[rows.length - 1].lag +
        " months stale instead of repricing every month costs about " + usd(cost) + " of NPV.";
    }
  }

  /* Runs the simulation in chunks so the tab paints and the page stays usable. */
  function runMonteCarlo(force) {
    if (mcBusy) return;
    if (!force && mc && !mcDirty) { drawQuant(); return; }
    mcBusy = true;
    var cfg = distCfg();
    var st = results.st;
    var draws = M.mcDraws(cfg.draws, cfg, st.A);
    var rows = [];
    var i = 0;
    var CHUNK = 150;
    updateMcStatus("Running " + nf(draws.length) + " simulations...");

    function step() {
      var end = Math.min(draws.length, i + CHUNK);
      for (; i < end; i++) {
        var dr = draws[i];
        var st2 = Object.assign({}, st, { A: Object.assign({}, st.A, {
          fx_drift: dr.fx_drift, price_index: dr.price_index, vc_mult: dr.vc_mult,
          opex_mult: dr.opex_mult, tests_per_patient: dr.tests_per_patient,
          pass_through: dr.pass_through }) });
        var m = M.metrics(M.run(st2, { vol: dr.vol }));
        rows.push({ dr: dr, npv: m.npv22, pb: m.payback_months, be: m.be_orders_day,
                    fund: m.funding_need, m12eb: m.m12_ebitda, m36cum: m.m36_cum,
                    margin: m.m12_margin });
      }
      if (i < draws.length) {
        updateMcStatus("Running simulations: " + Math.round(i / draws.length * 100) + "%");
        setTimeout(step, 0);
        return;
      }
      mc = { rows: rows, sm: M.mcSummaryFrom(rows), rho: M.rankCorr(rows), cfg: cfg };
      mcDirty = false;
      mcBusy = false;
      updateMcStatus(nf(rows.length) + " simulations finished. Change an assumption to run again.");
      drawQuant();
      // the study quotes the distribution: refresh it as soon as the numbers exist
      if (currentTab() === "plan") renderReport();
    }
    setTimeout(step, 0);
  }

  function drawQuant() {
    if (!mc) { runMonteCarlo(true); return; }
    renderQuantKpis(mc.sm);
    renderQuantTables();
    drawMcHistogram();
    drawMcRho();
    drawFxChart();
    renderPriceGrid();
    renderRepricing();
  }

  /* -------------------------------------------------------------------- tabs */
  function currentTab() {
    var b = $("#tabs button[aria-selected='true']");
    return b ? b.getAttribute("data-tab") : "overview";
  }
  function selectTab(name) {
    $$("#tabs button").forEach(function (x) {
      x.setAttribute("aria-selected", String(x.getAttribute("data-tab") === name));
    });
    $$(".topnav a[data-goto]").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("data-goto") === name);
    });
    var planLink = $("#nav-plan");
    if (planLink) planLink.classList.toggle("on", name === "plan");
    renderTab(name);
  }

  function renderTab(name) {
    $$("[data-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
    if (name === "tests") renderMenu();
    if (name === "capex") { renderDevices(); renderCapex(); }
    if (name === "opex") renderOpex();
    if (name === "monthly") renderMonthly();
    if (name === "assumptions") syncAssumptionInputs();
    if (name === "quant") {
      setTimeout(function () {
        if (!results.scen) compute(true);
        // an edited input invalidates the distribution: re-run rather than show
        // numbers that describe the previous state of the model
        if (!mc || mcDirty) runMonteCarlo(true);
        else drawQuant();
      }, 20);
    }
    if (name === "plan") {
      syncPlanInputs();
      renderReport();
      if (!mc && !mcBusy) runMonteCarlo(true);
    }
    if (name === "overview") {
      setTimeout(function () {
        if (!results.scen) compute(true);
        drawAll();
      }, 20);
    }
  }

  function syncAssumptionInputs() {
    var map = ASSUM_MAP;
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var v = getByPath(state, map[id]);
      el.value = v;
      el.className = isChanged(map[id]) ? "changed" : "";
    });
    var r12 = document.getElementById("ramp12");
    if (r12) { r12.value = state.ramp[11]; r12.className = isChanged("ramp12") ? "changed" : ""; }
    if (!state.dist) state.dist = Object.assign({}, M.DIST);
    Object.keys(DIST_MAP).forEach(function (k) {
      var el = document.getElementById(DIST_MAP[k]);
      if (el) el.value = state.dist[k];
    });
  }

  function wireAssumptions() {
    var map = ASSUM_MAP;
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        var v = Number(el.value);
        if (isNaN(v)) return;
        setByPath(state, map[id], v);
        el.className = "changed";
        onChange();
      });
    });
    var r12 = document.getElementById("ramp12");
    r12.addEventListener("input", function () {
      var v = Number(r12.value);
      if (isNaN(v) || v < 1) return;
      setRamp12(v);
      r12.className = "changed";
      onChange();
    });
    /* Monte Carlo settings: stored on state, used next time the tab runs. */
    document.querySelectorAll("[data-dist]").forEach(function (el) {
      el.addEventListener("change", function () {
        var k = el.getAttribute("data-dist");
        var v = Number(el.value);
        if (isNaN(v)) return;
        state.dist[k] = v;
        el.className = "changed";
        mcDirty = true;
        updateMcStatus("Assumptions changed - press Run simulation to refresh the results.");
        save();
      });
    });
  }

  /* inputs inside phone cards share the same data-* contract as the tables */
  function wireCardInputs() {
    document.addEventListener("input", function (ev) {
      var inp = ev.target;
      if (!inp || !inp.getAttribute) return;
      if (inp.getAttribute("data-cx")) {
        var ph = inp.getAttribute("data-cx"), i = +inp.getAttribute("data-i");
        var f = inp.getAttribute("data-f");
        var v = f === "item" ? inp.value : Number(inp.value);
        if (f !== "item" && isNaN(v)) return;
        state["capex_p" + ph][i][f] = v;
        if (f !== "item") inp.className = "changed";
        // keep the money total on a card in sync while typing (no re-render)
        if (f !== "item") {
          var card = inp.closest(".tcard");
          if (card) {
            var tot = card.querySelector(".tcard-f span");
            if (tot) tot.textContent = "Total " + usd(state["capex_p" + ph][i].qty * state["capex_p" + ph][i].unit);
          }
        }
        onChange();
        return;
      }
      if (inp.getAttribute("data-op")) {
        var j = +inp.getAttribute("data-i"), ff = inp.getAttribute("data-f");
        var vv = ff === "label" ? inp.value : Number(inp.value);
        if (ff !== "label" && isNaN(vv)) return;
        state.fixed_opex[j][ff] = vv;
        if (ff !== "label") inp.className = "changed";
        onChange();
        return;
      }
      if (inp.getAttribute("data-menu")) {
        var k = +inp.getAttribute("data-menu");
        var fld = inp.getAttribute("data-field");
        if (fld === "label") {
          state.menu[k].label = inp.value;
          onChange();
          return;
        }
        var val = Number(inp.value);
        if (isNaN(val)) return;
        state.menu[k][fld] = val;
        inp.className = "changed";
        onChange();
      }
    }, true);
  }

  /* ---------------------------------------------------- editable plan text */
  var SEASON_MIN = Math.min.apply(null, Object.keys(M.SEASON).map(function (k) { return M.SEASON[k]; }));
  var SEASON_MAX = Math.max.apply(null, Object.keys(M.SEASON).map(function (k) { return M.SEASON[k]; }));

  var PLAN_FIELDS = {
    "plan-name": "name", "plan-location": "location", "plan-owner": "owner",
    "plan-date": "date", "plan-area": "area", "plan-notes": "notes",
    "plan-strengths": "strengths", "plan-weaknesses": "weaknesses",
    "plan-recommendations": "recommendations"
  };

  function syncPlanInputs() {
    if (!state.plan) state.plan = EMPTY_PLAN();
    Object.keys(PLAN_FIELDS).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = state.plan[PLAN_FIELDS[id]] || "";
    });
  }

  function wirePlanInputs() {
    Object.keys(PLAN_FIELDS).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () {
        state.plan[PLAN_FIELDS[id]] = el.value;
        el.className = "changed";
        // rewrite only the paragraphs that quote the plan text, so the field the
        // owner is typing in never loses focus or caret position
        updatePlanText();
        save();
      });
    });
  }


  /* ============================================================== DEVICES
   * The equipment tab. Every device comes from window.LabDevices, which is
   * generated from device_catalogue.py — the same table the Python report and
   * the Excel export read. Choosing a different model swaps the state row, and
   * the whole model reprices.
   * ==================================================================== */
  var DEV = window.LabDevices || { devices: [], price_list: [], test_labels: {} };

  function devPrice(d, exw) {
    // same arithmetic as device_catalogue.landed_receipt
    if (d.incoterm === "delivered") return { total: exw, chain: null };
    var scale = Math.sqrt(exw / 2765);
    var fr = 200 * scale, cl = 100 * scale;
    var mi = d.key === "cbc" ? 414 : 0;
    var services = Math.round(exw * 0.07), customs = Math.round(exw * 0.10);
    return { total: exw + fr + cl + mi + services + customs,
             chain: { freight: fr, clearance: cl, ministry: mi,
                      services: services, customs: customs } };
  }

  function stateHasDevice(key) {
    return (state.capex_p1 || []).some(function (r) { return r.key === key; });
  }

  function deviceInSlot(slot) {
    return (state.capex_p1 || []).filter(function (r) { return r.slot === slot; });
  }

  function renderDevices() {
    var grid = $("#device-grid");
    if (!grid) return;
    var openOnly = $("#dev-openonly") && $("#dev-openonly").checked;
    var sourceOnly = $("#dev-sourceonly") && $("#dev-sourceonly").checked;

    // one tile per slot: the alternative models are behind the tile
    var slots = {};
    (DEV.devices || []).forEach(function (d) {
      var slot = d.slot || d.key;
      (slots[slot] = slots[slot] || []).push(d);
    });
    var chosenKeys = {};
    (state.capex_p1 || []).forEach(function (r) {
      if (r.slot && r.key) chosenKeys[r.slot] = r.key;
    });

    var html = "";
    Object.keys(slots).forEach(function (slot) {
      var cands = slots[slot];
      var chosen = cands.filter(function (c) { return c.key === chosenKeys[slot]; })[0] || cands[0];
      var inKit = !!chosenKeys[slot];
      var alts = cands.filter(function (c) { return c.key !== chosen.key; })
        .filter(function (c) { return !openOnly || c.open_system; })
        .filter(function (c) { return !sourceOnly || c.kind === "quote" || c.kind === "sourced"; });
      if (openOnly && !chosen.open_system) return;
      if (sourceOnly && chosen.kind === "estimate") return;

      var exw = chosen.price_usd * (chosen.qty || 1);
      var p = devPrice(chosen, exw);
      var kindCls = chosen.kind === "quote" ? "a" : chosen.kind === "sourced" ? "g" : "";
      html += '<article class="devcard' + (inKit ? " in" : "") + '" data-slot="' + esc(slot) + '">' +
        '<div class="devpic">' +
          (chosen.img
            ? '<img src="assets/' + esc(chosen.img) + '" alt="' + esc(chosen.name) + '" loading="lazy">'
            : '<span class="devpic-ph" aria-hidden="true">' + glyphFor(chosen.cls) + "</span>") +
        "</div>" +
        "<div class='devbody'>" +
          "<h3>" + esc(chosen.name) + "</h3>" +
          '<p class="devmodel">' + esc(chosen.brand || "") + " " + esc(chosen.model) + "</p>" +
          '<p class="devspecs">' + esc(chosen.specs || "") + "</p>" +
          '<div class="devmoney"><b>' + usd(p.total) + "</b><span>landed</span>" +
            '<span class="dev-exw">' + usd(exw) + " EXW</span></div>" +
          '<div class="devtags">' +
            '<span class="pill ' + kindCls + '">' + esc(kindLabel(chosen.kind)) + "</span>" +
            '<span class="pill ' + (chosen.open_system ? "g" : "r") + '">' +
              (chosen.open_system ? "open reagents" : "closed reagents") + "</span>" +
            (chosen.tier === "owner" ? '<span class="pill a">owner quote</span>' : "") +
          "</div>" +
          (chosen.tests && chosen.tests.length
            ? '<p class="devtests">Runs: ' + chosen.tests.map(function (t) {
                return esc((DEV.test_labels || {})[t] || t);
              }).join(" · ") + "</p>"
            : "") +
          (alts.length
            ? '<details class="dev-alt"><summary>' + alts.length + " alternative" +
              (alts.length > 1 ? "s" : "") + "</summary>" + alts.map(function (a) {
                var ae = a.price_usd * (a.qty || 1), ap = devPrice(a, ae);
                return '<button class="dev-altbtn' + (a.open_system ? " open" : "") +
                  '" data-pick="' + esc(a.key) + '" data-slot="' + esc(slot) + '">' +
                  "<span>" + esc(a.brand || "") + " " + esc(a.model) + "</span>" +
                  "<span>" + usd(ap.total) + " landed</span>" +
                  (a.kind === "estimate" ? '<span class="pill">estimate</span>' : "") +
                  "</button>";
              }).join("") + "</details>"
            : "") +
          '<button class="btn sm ' + (inKit ? "" : "primary") + ' dev-toggle" data-toggle="' +
            esc(chosen.key) + '" data-slot="' + esc(slot) + '">' +
            (inKit ? "Remove from kit" : "Add to kit") + "</button>" +
        "</div></article>";
    });
    grid.innerHTML = html || '<p class="empty">No device matches those filters.</p>';

    var cnt = $("#dev-count");
    if (cnt) cnt.textContent = (state.capex_p1 || []).length + " lines in the kit";
    renderDeviceKpis();
    renderChain();
  }

  function glyphFor(cls) {
    return { analyzer: "◆", essential: "●", power: "⚡", it: "▣",
             safety: "✚", fitout: "▤", stock: "▦", contingency: "◈" }[cls] || "●";
  }
  function kindLabel(k) {
    return { quote: "owner quote", sourced: "vendor price", estimate: "estimate",
             rule: "rule" }[k] || k;
  }

  function renderDeviceKpis() {
    var host = $("#devkpis");
    if (!host) return;
    var rows = (state.capex_p1 || []).filter(function (r) { return r.cls !== "stock"; });
    var exw = 0, landed = 0, closed = 0, opensys = 0, analyses = 0;
    rows.forEach(function (r) {
      var e = r.exw != null ? r.exw : (r.qty || 0) * (r.unit || 0);
      exw += e; landed += (r.total != null ? r.total : e);
      if (r.open_system === false) closed++; else if (r.open_system) opensys++;
      if (r.cls === "analyzer") analyses++;
    });
    var est = (state.capex_p1 || []).filter(function (r) { return r.kind === "estimate"; }).length;
    var cards = [
      { k: "Kit, EXW", v: usd(exw), s: analyses + " analyzers", c: "" },
      { k: "Kit, landed", v: usd(landed), s: (exw ? nf(landed / exw, 2) : "—") + "× purchase price", c: "" },
      { k: "Import overhead", v: usd(Math.max(0, landed - exw)),
        s: "freight, clearance, ministry, 7%, 10%", c: "warn" },
      { k: "Open vs closed", v: opensys + " / " + closed,
        s: "open-system devices / reagent-locked", c: closed > opensys ? "warn" : "good" },
      { k: "Estimates left", v: String(est),
        s: est ? "replace with a written quote" : "all lines sourced", c: est ? "warn" : "good" },
      { k: "Full phase 1", v: usd(results.m.p1), s: "incl. stock + contingency", c: "" }
    ];
    host.innerHTML = cards.map(function (c) {
      return '<div class="kpi ' + c.c + '"><span class="k">' + esc(c.k) + "</span>" +
        '<span class="v">' + esc(c.v) + "</span><span class='d'>" + esc(c.s) + "</span></div>";
    }).join("");
  }

  function renderChain() {
    var tb = $("#chain-table tbody");
    if (!tb) return;
    var chain = results.base.capex.chain || {};
    var owner = (DEV.chain_example || {});
    var labels = [
      ["freight", "Freight to Port Sudan", "One carton per device; scales with the square root of value"],
      ["clearance", "Clearance and handling", "Fixed per shipment, not per device"],
      ["ministry", "Ministry of Trade + Pharmacy & Poisons", "Per registration of the shipment"],
      ["services", "Services charge (7% of purchase)", "The owner's supplier line"],
      ["customs", "Customs duty (10% of purchase)", "10% of the invoice, per the owner's sheet"]
    ];
    tb.innerHTML = labels.map(function (l) {
      var a = owner[l[0]] || 0, b = chain[l[0]] || 0;
      return "<tr><td>" + esc(l[1]) + '</td><td class="num">' + usd(a) +
        '</td><td class="num">' + usd(b) + "</td><td>" + esc(l[2]) + "</td></tr>";
    }).join("") +
      "<tr class='total'><td>Landed total</td><td class='num'>" + usd(owner.total) +
      "</td><td class='num'>" + usd(results.base.capex.landed_capital) + "</td><td></td></tr>";
    var note = $("#chain-note");
    if (note) {
      note.textContent = "The owner's four-machine quote of $2,765 lands at $" +
        nf(owner.total) + " (" + nf(owner.multiplier, 2) + "×). " +
        "That multiplier, not a guessed freight percentage, is what prices this kit.";
    }
  }

  function pickDevice(key, slot) {
    var d = (DEV.devices || []).filter(function (x) { return x.key === key; })[0];
    if (!d) return;
    // remove any other model in the same slot, then replace or add this one
    var idx = -1;
    for (var i = 0; i < state.capex_p1.length; i++) {
      if (state.capex_p1[i].key === key) { idx = i; break; }
    }
    state.capex_p1 = state.capex_p1.filter(function (r) { return r.slot !== slot; });
    var exw = d.price_usd * (d.qty || 1);
    var p = devPrice(d, exw);
    var row = {
      key: d.key, slot: d.slot || d.key, item: d.name_ar || d.name, item_en: d.name,
      model: d.model, brand: d.brand, qty: d.qty || 1, exw: exw,
      unit: p.total, total: p.total, src: d.src, kind: d.kind, note: d.note,
      specs: d.specs, img: d.img || "", cls: d.cls, tier: d.tier,
      open_system: d.open_system, tests: d.tests || [], chain: p.chain
    };
    if (idx >= 0 && idx < state.capex_p1.length) state.capex_p1.splice(idx, 0, row);
    else state.capex_p1.push(row);
    onChange({ full: true });
    compute(true);
    renderKpis();
    renderDevices();
    renderCapex();
    if (currentTab() === "plan") renderReport();
    save();
  }

  function wireDevices() {
    document.addEventListener("click", function (ev) {
      var pick = ev.target.closest("[data-pick]");
      if (pick) {
        ev.preventDefault();
        pickDevice(pick.getAttribute("data-pick"), pick.getAttribute("data-slot"));
        return;
      }
      var tog = ev.target.closest("[data-toggle]");
      if (tog) {
        ev.preventDefault();
        var slot = tog.getAttribute("data-slot");
        var key = tog.getAttribute("data-toggle");
        var has = deviceInSlot(slot).length;
        if (has) {
          state.capex_p1 = state.capex_p1.filter(function (r) { return r.slot !== slot; });
          onChange({ full: true }); renderDevices(); renderCapex(); save();
        } else {
          pickDevice(key, slot);
        }
      }
    });
    ["dev-openonly", "dev-sourceonly"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener("change", renderDevices);
    });
  }

  /* ------------------------------------------------------------------ study
   * The Feasibility-study tab is the deliverable: a complete, printable study
   * built from the numbers currently on screen. It is not a summary that points
   * at a PDF — everything the owner needs to decide is rendered here.
   * ---------------------------------------------------------------------- */

  function tbl(headers, rows, cls, foot) {
    return "<div class='tw'><table class='tbl " + (cls || "") + "'><thead><tr>" +
      headers.map(function (h, i) {
        return "<th" + (i ? " class='num'" : "") + ">" + esc(h) + "</th>";
      }).join("") + "</tr></thead><tbody>" + rows + "</tbody>" +
      (foot ? "<tfoot>" + foot + "</tfoot>" : "") + "</table></div>";
  }
  function kpis(items) {
    return "<section class='rpt-kpis'>" + items.map(function (k) {
      return "<div class='rk'><span>" + esc(k[0]) + "</span><b>" + esc(k[1]) + "</b></div>";
    }).join("") + "</section>";
  }

  /* one-at-a-time swings, computed live from the current inputs */
  function tornadoRows() {
    var st = results.st, p = st.A;
    function npv(st2, over) { return M.metrics(M.run(st2, over || {})).npv22; }
    function withA(patch) {
      return Object.assign({}, st, { A: Object.assign({}, st.A, patch) });
    }
    var T = [
      ["Daily order volume", 0.60, 1.40, "%",
       function (v) { return npv(st, { vol: v }); }],
      ["Reagent cost per test", 0.65, 1.45, "%",
       function (v) { return npv(withA({ vc_mult: v })); }],
      ["Realised price", 0.85, 1.15, "%",
       function (v) { return npv(withA({ price_index: p.price_index * v })); }],
      ["Tests per patient", 1.20, 1.85, "x",
       function (v) { return npv(withA({ tests_per_patient: v })); }],
      ["FX pass-through", 0.50, 1.00, "%",
       function (v) { return npv(withA({ pass_through: v })); }],
      ["Price-list lag (months)", 0, 4, "mo",
       function (v) { return npv(withA({ pass_lag_months: v })); }],
      ["SDG depreciation / year", 0.10, 0.60, "%",
       function (v) { return npv(withA({ fx_drift: v })); }],
      ["Fixed costs", 0.85, 1.20, "%",
       function (v) { return npv(withA({ opex_mult: v })); }],
      ["Equipment price", 0.80, 1.30, "%",
       function (v) { return npv(withA({ capex_mult: v })); }]
    ];
    var base = results.m.npv22;
    var rows = T.map(function (t) {
      var lo = t[4](t[1]), hi = t[4](t[2]);
      return { name: t[0], lo: lo, hi: hi, loV: t[1], hiV: t[2], unit: t[3],
               swing: Math.abs(lo - hi) };
    });
    rows.sort(function (a, b) { return b.swing - a.swing; });
    return { base: base, rows: rows };
  }

  function drawReportTornado() {
    var host = $("#rpt-tornado");
    if (!host) return;
    var t = tornadoRows(), rows = t.rows, base = t.base;
    var all = [base];
    rows.forEach(function (r) { all.push(r.lo, r.hi); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var span = (hi - lo) || 1;
    lo -= span * .04; hi += span * .04;
    var pos = function (v) { return (v - lo) / (hi - lo) * 100; };
    host.innerHTML = rows.map(function (r) {
      var a = pos(r.lo), b = pos(r.hi), m = pos(base);
      var rng = r.unit === "%" ? (r.loV * 100).toFixed(0) + "% – " + (r.hiV * 100).toFixed(0) + "%"
        : r.unit === "x" ? r.loV + "x – " + r.hiV + "x"
        : r.loV + " – " + r.hiV + " months";
      return "<div class='torn'>" +
        "<div class='torn-h'><span>" + esc(r.name) + "</span><span>" + esc(rng) + "</span></div>" +
        "<div class='torn-bar'>" +
          "<i style='left:" + Math.min(a, m).toFixed(2) + "%;width:" +
            Math.max(.7, Math.abs(m - a)).toFixed(2) + "%;background:#a3261f'></i>" +
          "<i style='left:" + Math.min(b, m).toFixed(2) + "%;width:" +
            Math.max(.7, Math.abs(b - m)).toFixed(2) + "%;background:#1d7a4d'></i>" +
          "<u style='left:" + m.toFixed(2) + "%'></u>" +
        "</div>" +
        "<div class='torn-f'><span>" + usd(r.lo) + "</span><span>" + usd(base) +
          "</span><span>" + usd(r.hi) + "</span></div>" +
      "</div>";
    }).join("") +
      "<p class='chart-note'>Each bar moves one input to its low (red) and high (green) value " +
      "and recomputes the whole 36-month model. Sorted by how much that input can move NPV.</p>";
  }

  /* Replace just the free-text paragraphs of the study in place. */
  function updatePlanText() {
    var host = $("#report-host");
    if (!host) return;
    var plan = state.plan || EMPTY_PLAN();
    var val = function (k, fallback) { return (plan[k] || "").trim() || fallback; };
    var set = function (sel, txt) {
      var el = host.querySelector(sel);
      if (el && el.textContent !== txt) el.textContent = txt;
    };
    var h1 = host.querySelector(".rpt-head h1");
    if (h1) h1.textContent = val("name", "Medical Laboratory Feasibility Study");
    set("#rpt-strengths", val("strengths", "—"));
    set("#rpt-weaknesses", val("weaknesses", "—"));
    set("#rpt-recommendations", val("recommendations", "—"));
    set("#rpt-summary", val("notes", ""));
  }

  function renderReport() {
    var host = $("#report-host");
    if (!host) return;
    var m = results.m, ms = results.base.months, st = results.st, cap = results.base.capex;
    var plan = state.plan || EMPTY_PLAN();
    var val = function (k, fallback) { return (plan[k] || "").trim() || fallback; };
    var p = st.A;

    /* ---- capex ---- */
    var rowsCapex = st.capex_p1.map(function (c) {
      return "<tr><td>" + esc(c.item_en || c.item) + "</td><td class='num'>" + nf(c.qty) +
        "</td><td class='num'>" + usd(c.exw != null ? c.exw : c.qty * c.unit) +
        "</td><td class='num'>" + usd(c.total != null ? c.total : c.qty * c.unit) + "</td></tr>";
    }).join("");
    var footCapex =
      "<tr><td>Equipment subtotal</td><td></td><td></td><td class='num'>" + usd(cap.hardware) + "</td></tr>" +
      "<tr><td>Freight and clearance (" + nf(state.freight * 100) + "%)</td><td></td><td></td><td class='num'>" + usd(cap.freight) + "</td></tr>" +
      "<tr><td>Install and training (" + nf(state.install * 100) + "%)</td><td></td><td></td><td class='num'>" + usd(cap.install) + "</td></tr>" +
      "<tr><td>Opening reagent stock</td><td></td><td></td><td class='num'>" + usd(cap.stock) + "</td></tr>" +
      "<tr><td>Contingency (" + nf(state.contingency * 100) + "%)</td><td></td><td></td><td class='num'>" + usd(cap.contingency) + "</td></tr>" +
      "<tr class='total'><td>Phase 1 total</td><td></td><td></td><td class='num'>" + usd(cap.p1) + "</td></tr>";

    var later = st.capex_p2.map(function (c) { return ["Phase 2", c.item, usd(c.qty * c.unit)]; })
      .concat(st.capex_p3.map(function (c) { return ["Phase 3", c.item, usd(c.qty * c.unit)]; }));
    var rowsLater = later.map(function (r) {
      return "<tr><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td class='num'>" + r[2] + "</td></tr>";
    }).join("");

    /* ---- menu ---- */
    var shares = st.menu.reduce(function (a, t) { return a + t.share; }, 0) || 1;
    var rowsMenu = st.menu.map(function (t) {
      var price = t.price_usd * p.price_index;
      var vc = t.vc * p.vc_mult * (1 + p.import_premium);
      var cm = price - vc;
      var mg = price > 0 ? cm / price * 100 : 0;
      var mins = t.tech_min + p.overhead_min_per_order;
      var perMin = mins > 0 ? cm / mins : 0;
      return "<tr><td>" + esc(t.label) + "</td><td class='num'>" + nf(t.share / shares * 100) +
        "%</td><td class='num'>" + usd(price, 2) + "</td><td class='num'>" + usd(vc, 2) +
        "</td><td class='num'>" + usd(cm, 2) + "</td><td class='num'>" + nf(mg) + "%</td>" +
        "<td class='num'>" + nf(mins, 1) + "</td><td class='num'>" + usd(perMin, 2) + "</td></tr>";
    }).join("");

    /* ---- opex ---- */
    var opexSum = st.fixed_opex.reduce(function (a, o) { return a + o.usd; }, 0);
    var rowsOpex = st.fixed_opex.map(function (o) {
      return "<tr><td>" + esc(o.label) + "</td><td class='num'>" + usd(o.usd) +
        "</td><td class='num'>" + usd(o.usd * 12) + "</td></tr>";
    }).join("");

    /* ---- monthly ---- */
    var rowsMonths = ms.map(function (r) {
      var mg = r.rev > 0 ? r.ebitda / r.rev * 100 : 0;
      return "<tr><td class='num'>" + r.month + "</td><td class='num'>" + nf(r.patients) +
        "</td><td class='num'>" + nf(r.orders_day) + "</td><td class='num'>" + r.techs +
        "</td><td class='num'>" + usd(r.rev) + "</td><td class='num'>" + usd(r.ebitda) +
        "</td><td class='num'>" + nf(mg) + "%</td><td class='num'>" + usd(r.fcf) +
        "</td><td class='num'>" + usd(r.cum) + "</td></tr>";
    }).join("");

    /* ---- scenarios ---- */
    var rowsScen = (results.scen || []).map(function (s) {
      var x = s.m;
      return "<tr><td>" + esc(s.name) + "</td><td class='num'>" + usd(x.yr1_rev) +
        "</td><td class='num'>" + usd(x.yr1_ebitda) + "</td><td class='num'>" + usd(x.yr2_ebitda) +
        "</td><td class='num'>" + (x.payback_months === null ? "—" : nf(x.payback_months, 1)) +
        "</td><td class='num'>" + usd(x.funding_need) + "</td><td class='num'>" +
        usd(x.npv22) + "</td><td class='num'>" +
        (x.be_orders_day === null ? "—" : nf(x.be_orders_day, 1)) + "</td></tr>";
    }).join("");

    /* ---- repricing + price ladder ---- */
    var rep = M.repricing(st);
    var rowsRep = rep.map(function (r) {
      return "<tr><td class='num'>" + r.lag + "</td><td class='num'>" + usd(r.npv22) +
        "</td><td class='num'>" + usd(r.m12_ebitda) + "</td><td class='num'>" +
        (r.pb === null ? "—" : nf(r.pb, 1)) + "</td></tr>";
    }).join("");
    var grid = M.pricingGrid(st);
    var rowsGrid = grid.map(function (g) {
      var head = g.price_needed > 0 ? m.avg_price_usd / g.price_needed - 1 : 0;
      return "<tr><td class='num'>" + g.orders_day + "</td><td class='num'>" +
        usd(g.price_needed, 2) + "</td><td class='num'>" + usd(g.fixed) +
        "</td><td class='num'>" + usd(m.avg_price_usd, 2) + "</td><td class='num'>" +
        pct(head * 100, 0) + "</td></tr>";
    }).join("");

    /* ---- monte carlo (rendered only when it has been run) ---- */
    var mcBlock = "";
    if (mc && mc.sm) {
      var sm = mc.sm;
      mcBlock =
        "<h2 id='rpt-mc'>10. Risk: what the simulation says</h2>" +
        "<p>One scenario is a single point; the decision needs the distribution. The whole model " +
        "was re-run <b>" + nf(sm.n) + "</b> times with the uncertain inputs varied together, " +
        "using the widths set on the Assumptions tab.</p>" +
        kpis([
          ["Median NPV", usd(sm.npv_p50)],
          ["10th – 90th percentile", usd(sm.npv_p10) + " – " + usd(sm.npv_p90)],
          ["Chance of a loss", pct(sm.p_npv_neg * 100, 1)],
          ["Median payback", sm.pb_p50 === null ? "—" : nf(sm.pb_p50, 1) + " mo"],
          ["Never pays back", pct(sm.p_never_payback * 100, 1)],
          ["Cash to hold (90th pct)", usd(sm.fund_p90)]
        ]) +
        "<div class='grid c2' style='margin-top:14px'>" +
          "<div><h3>Distribution of NPV</h3><div id='rpt-mc-chart' class='chart'></div>" +
            "<p class='chart-note' id='rpt-mc-note'></p></div>" +
          "<div><h3>What drives the result when everything moves</h3>" +
            "<div id='rpt-mcrho'></div></div>" +
        "</div>" +
        "<p class='rpt-callout'><b>How to read this:</b> the funding target is the 90th percentile " +
        "cash figure (" + usd(sm.fund_p90) + "), not the point estimate (" + usd(m.funding_need) +
        "). If that cash is not available, defer Phase 2 rather than shrink Phase 1.</p>";
    } else {
      mcBlock = "<h2 id='rpt-mc'>10. Risk: what the simulation says</h2>" +
        "<p class='empty'>The simulation has not run yet in this session. " +
        "<button class='btn sm' data-goto='quant'>Open Risk &amp; Monte Carlo</button></p>";
    }

    var sections = [
      ["1", "Executive summary"], ["2", "Demand and volume assumptions"],
      ["3", "Capital expenditure"], ["4", "Test menu and unit economics"],
      ["5", "Operating costs and team"], ["6", "36-month projection"],
      ["7", "Break-even and safety margin"], ["8", "What moves the result"],
      ["9", "Currency exposure and repricing"], ["10", "Risk: what the simulation says"],
      ["11", "Scenarios"], ["12", "Analysis in your words"]
    ];

    host.innerHTML =
      "<header class='rpt-head'>" +
        "<h1>" + esc(val("name", "Medical Laboratory Feasibility Study")) + "</h1>" +
        "<p class='rpt-meta'>" + esc(val("location", "Location not set")) + " · " +
          esc(val("date", new Date().getFullYear())) +
          (plan.owner ? " · " + esc(plan.owner) : "") +
          (plan.area ? " · " + esc(plan.area) + " m²" : "") +
        "</p>" +
      "</header>" +

      kpis([
        ["Total investment", usd(m.capex_total)],
        ["Cash needed to open", usd(m.funding_need)],
        ["Payback", m.payback_months === null ? "Never" : nf(m.payback_months, 1) + " mo"],
        ["NPV @ 22%", usd(m.npv22)],
        ["Break-even", nf(m.be_orders_day, 1) + "/day"],
        ["EBITDA margin, m12", pct(m.m12_margin, 1)]
      ]) +

      "<nav class='rpt-toc'>" + sections.map(function (s) {
        return "<a href='#rpt-s" + s[0] + "'>" + s[0] + ". " + esc(s[1]) + "</a>";
      }).join("") + "</nav>" +

      /* 1 ------------------------------------------------------------- */
      "<h2 id='rpt-s1'>1. Executive summary</h2>" +
      "<p id='rpt-summary'>" + esc(val("notes",
        "A " + (plan.area ? plan.area + " m² " : "") + "medical laboratory in " +
        val("location", "the target location") + " opening with a 3-part haematology analyser and " +
        "semi-automatic chemistry, priced in USD at " + nf(p.price_index * 100) + "% of the local list.")) +
      "</p>" +
      "<p>Opening requires <b>" + usd(cap.p1) + "</b> of capital plus working capital: the " +
      "cash needed before opening is <b>" + usd(m.funding_need) + "</b>, reached at the lowest " +
      "point of the cumulative cash curve (month " + m.trough_month + "). The business covers its " +
      "fixed costs at <b>" + nf(m.be_orders_day, 1) + " orders per day</b> " +
      "(about " + nf(m.be_patients_day, 0) + " patients), against a month-12 volume of " +
      nf(m.m12_orders_day, 0) + " orders per day — a safety margin of " + pct(m.mos_pct, 0) + ".</p>" +
      "<p>Capital is returned in <b>" + (m.payback_months === null ? "more than 36 months" :
        nf(m.payback_months, 1) + " months") + "</b>; over 36 months the project is worth " +
      "<b>" + usd(m.npv22) + "</b> at a 22% discount rate" +
      (m.irr_annual === null ? "" : " (IRR " + nf(m.irr_annual) + "%)") + ".</p>" +

      /* 2 ------------------------------------------------------------- */
      "<h2 id='rpt-s2'>2. Demand and volume assumptions</h2>" +
      tbl(["Assumption", "Value"], [
        ["Working days per month", nf(p.days)],
        ["Tests per patient (rising with new sections)", nf(p.tests_per_patient, 2) +
          " → " + nf(m.tpp_m12, 2) + " by month 12"],
        ["Patients per day at month 1 / month 12", nf(state.ramp[0], 1) + " / " + nf(state.ramp[11], 1)],
        ["Patients per day at month 36", nf(ms[35].patients, 1)],
        ["Orders per day at month 12", nf(m.m12_orders_day, 1)],
        ["Seasonality", "monthly index " + nf(SEASON_MIN * 100) + "–" + nf(SEASON_MAX * 100) +
          "% (malaria/ICT peak in September–November), applied at 35% strength"]
      ].map(function (r) {
        return "<tr><td>" + esc(r[0]) + "</td><td class='num'>" + esc(r[1]) + "</td></tr>";
      }).join("")) +

      /* 3 ------------------------------------------------------------- */
      "<h2 id='rpt-s3'>3. Capital expenditure</h2>" +
      tbl(["Item", "Qty", "Unit price", "Total"], rowsCapex, "", footCapex) +
      (rowsLater ? "<h3>Later phases (bought only when demand is proven)</h3>" +
        tbl(["Phase", "Item", "Cost"], rowsLater) : "") +
      "<p class='chart-note'>Phase 2 is spent in month " + nf(p.phase2_month) +
        " (" + usd(ms[Math.min(35, p.phase2_month - 1)] ?
          usd(st.capex_p2.reduce(function (a, c) { return a + c.qty * c.unit; }, 0)) : "0") +
        ") and Phase 3 in month " + nf(p.phase3_month) + ". Total across all three phases: " +
        usd(m.capex_total) + ".</p>" +

      /* 4 ------------------------------------------------------------- */
      "<h2 id='rpt-s4'>4. Test menu and unit economics</h2>" +
      "<p>Shares are re-based to 100% when the model runs. Contribution is the USD price minus " +
      "reagent cost; the last two columns rank every test by profit per technologist-minute, " +
      "which is the real capacity constraint.</p>" +
      tbl(["Test", "Share", "Price", "Reagents", "Contribution", "Margin", "Tech min",
           "$ per tech-min"], rowsMenu) +
      "<p class='chart-note'>Average price per order " + usd(m.avg_price_usd, 2) +
        " · average reagent cost " + usd(m.avg_vc_usd, 2) +
        " · contribution margin " + pct(m.cm_pct, 1) + ".</p>" +

      /* 5 ------------------------------------------------------------- */
      "<h2 id='rpt-s5'>5. Operating costs and team</h2>" +
      tbl(["Monthly cost", "Per month", "Per year"], rowsOpex, "",
        "<tr class='total'><td>Fixed costs total</td><td class='num'>" + usd(opexSum) +
        "</td><td class='num'>" + usd(opexSum * 12) + "</td></tr>") +
      "<p>Wages are derived, not typed: the model hires when a technologist passes " +
        pct(p.hire_at_util * 100, 0) + " utilisation, at " + nf(results.minutes, 1) +
        " minutes of technologist time per order. Month 12 needs <b>" + m.m12_techs +
        "</b> technologists and staff wages of <b>" + usd(m.m12_labour) +
        "</b> per month. Technologist " + usd(st.lab.tech) + ", senior " + usd(st.lab.senior_tech) +
        ", phlebotomist " + usd(st.lab.phleb) + " per month.</p>" +

      /* 6 ------------------------------------------------------------- */
      "<h2 id='rpt-s6'>6. 36-month projection</h2>" +
      "<p class='chart-note'>Free cash flow is after tax, capex and the working-capital movement; " +
        "it is what the owner actually gets back.</p>" +
      tbl(["Month", "Patients/day", "Orders/day", "Techs", "Net revenue", "EBITDA", "Margin",
           "Free cash", "Cumulative"], rowsMonths) +

      /* 7 ------------------------------------------------------------- */
      "<h2 id='rpt-s7'>7. Break-even and safety margin</h2>" +
      "<p>Using the month-12 cost structure: fixed costs and wages of <b>" +
        usd(m.fixed_all_m12) + "</b> per month, contribution of <b>" + usd(m.cm_usd, 2) +
        "</b> per order. Break-even is <b>" + nf(m.be_orders_day, 1) + " orders/day</b> (" +
        nf(m.be_patients_day, 0) + " patients/day, about " + usd(m.be_rev_usd) +
        " of monthly revenue). Month-12 volume is " + nf(m.m12_orders_day, 0) +
        " orders/day, a safety margin of " + pct(m.mos_pct, 0) + ".</p>" +
      "<p>The price ladder below is the negotiating tool: it is the average price that covers " +
        "fixed costs, wages and service at each volume. Above that price the lab is safe at " +
        "that volume; below it, volume growth is the only route back.</p>" +
      tbl(["Orders/day", "Price needed", "Fixed + wages", "Your average", "Headroom"], rowsGrid) +

      /* 8 ------------------------------------------------------------- */
      "<h2 id='rpt-s8'>8. What moves the result</h2>" +
      "<p>Nine inputs, each pushed to a plausible low and high while everything else stays at " +
        "today's value, and the whole 36-month model recomputed.</p>" +
      "<div id='rpt-tornado'></div>" +

      /* 8b. the owner's own price board ---------------------------------- */
      (function () {
        var pl = (window.LabDevices || {}).price_list || [];
        if (!pl.length) return;
        return "<h2 id='rpt-s8b'>8b. Your own price board vs this model</h2>" +
          "<p>This is the price list from the clinic's board, in Sudanese pounds, next to what " +
          "the model charges. The board was written on an exchange rate of about " +
          nf((window.LabDevices || {}).price_list_fx_at_photo || 2500) +
          " SDG per dollar; at today's rate the same numbers are worth about a fifth of that. " +
          "The last column is the same price carried to today's rate.</p>" +
          tbl(["Test", "On the board (SDG)", "Means today ($)", "The model charges ($)",
               "Repriced list (SDG)"],
              pl.map(function (r) {
                var menu = (st.menu || []).filter(function (m) {
                  return m.key === r.menu;
                })[0];
                return "<tr><td>" + esc(r.label) + "</td><td class='num'>" + nf(r.sdg) +
                  "</td><td class='num'>" + usd(r.usd_as_written, 2) +
                  "</td><td class='num'>" + (menu ? usd(menu.price_usd, 2) : "—") +
                  "</td><td class='num'>" + nf(Math.round(r.sdg_repriced)) + "</td></tr>";
              }).join("")) +
          "<p class='rpt-callout'><b>Read this before printing any price list:</b> the board's " +
          "CBC at 12,000 SDG is $1.00 at today's rate, and the CBC reagents alone cost about " +
          "$1.20. Re-quote the whole board on today's rate, or the lab sells below cost.</p>";
      })() +

      /* 9 ------------------------------------------------------------- */
      "<h2 id='rpt-s9'>9. Currency exposure and repricing</h2>" +
      "<p>The lab charges in Sudanese pounds and buys reagents in dollars. The menu is priced in " +
        "USD (the anchor) and the pound list is derived, so when the pound slides the realised " +
        "dollar price per order falls by the share of the move that was <b>not</b> repriced — and " +
        "the lag compounds it, because the list in force today was written months ago. " +
        "Today's assumptions: " + pct(p.pass_through * 100, 0) + " of the move passed through, " +
        "with a " + nf(p.pass_lag_months) + "-month lag.</p>" +
      "<div id='rpt-fx' class='chart'></div>" +
      "<p class='chart-note' id='rpt-fx-note'></p>" +
      "<h3>The cost of a stale price list</h3>" +
      tbl(["List age (months)", "NPV @ 22%", "Month-12 EBITDA", "Payback"], rowsRep) +
      "<p class='chart-note'>Same model, only the repricing lag changes. " +
        "Repricing monthly instead of every " + rep[rep.length - 1].lag + " months is worth about " +
        usd(rep[0].npv22 - rep[rep.length - 1].npv22) + " of NPV.</p>" +

      /* 10 ------------------------------------------------------------ */
      mcBlock +

      /* 11 ------------------------------------------------------------ */
      "<h2 id='rpt-s11'>11. Scenarios</h2>" +
      tbl(["Scenario", "Y1 revenue", "Y1 EBITDA", "Y2 EBITDA", "Payback", "Cash needed",
           "NPV 22%", "Break-even"], rowsScen) +

      /* 12 ------------------------------------------------------------ */
      "<h2 id='rpt-s12'>12. Analysis in your words</h2>" +
      "<h3>Strengths</h3><p id='rpt-strengths'>" + esc(val("strengths", "—")) + "</p>" +
      "<h3>Weaknesses and risks</h3><p id='rpt-weaknesses'>" + esc(val("weaknesses", "—")) + "</p>" +
      "<h3>Recommendations</h3><p id='rpt-recommendations'>" + esc(val("recommendations", "—")) + "</p>" +

      "<p class='rpt-foot'>Generated in this browser on " +
        new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) +
        " from the inputs on the other tabs. Every figure is computed by the same model; " +
        "nothing is typed by hand.</p>";

    var cnt = $("#study-count");
    if (cnt) cnt.textContent = ms.length + " months · " + st.menu.length + " tests";

    /* charts inside the study */
    drawReportTornado();
    if (mc) {
      drawMcHistogram("#rpt-mc-chart", "#rpt-mc-note");
      drawMcRho("#rpt-mcrho");
    }
    drawFxChart("#rpt-fx", "#rpt-fx-note");
  }

  /* a standalone copy of the study, so it can be shared without the app */
  function studyHtml() {
    var host = $("#report-host");
    if (!host) return "";
    var css = "";
    try {
      css = Array.prototype.slice.call(document.styleSheets)
        .filter(function (ss) { return ss.href && /app\.css/.test(ss.href); })
        .map(function (ss) {
          return Array.prototype.slice.call(ss.cssRules || []).map(function (r) { return r.cssText; }).join("\n");
        }).join("\n");
    } catch (e) { css = ""; }
    return "<!DOCTYPE html><html lang='en' dir='ltr'><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width, initial-scale=1'>" +
      "<title>" + esc((state.plan && state.plan.name) || "Laboratory feasibility study") + "</title>" +
      "<style>body{margin:0;background:#fff}" + css +
      ".wrap{max-width:960px;margin:0 auto;padding:28px 20px 80px}</style></head><body>" +
      "<div class='wrap report'>" + host.innerHTML + "</div></body></html>";
  }

  /* ------------------------------------------------------- add / delete rows */
  function wireRowActions() {
    document.addEventListener("click", function (ev) {
      var add = ev.target.closest("[data-add]");
      if (add) {
        var kind = add.getAttribute("data-add");
        if (kind === "capex1") state.capex_p1.push({ item: "New item", qty: 1, unit: 100, src: "est", note: "" });
        if (kind === "capex2") state.capex_p2.push({ item: "New item", qty: 1, unit: 500, src: "est", note: "" });
        if (kind === "capex3") state.capex_p3.push({ item: "New item", qty: 1, unit: 500, src: "est", note: "" });
        if (kind === "opex") state.fixed_opex.push({ label: "New item", usd: 50 });
        if (kind === "menu") {
          var n = Object.keys(state.menu).length + 1;
          state.menu.push({
            key: "custom_" + Date.now(), label: "New test " + n,
            price_usd: 2.5, vc: 0.8, tech_min: 5, share: 0.02, phase: 1, note: ""
          });
        }
        onChange();
        renderTab(currentTab());
        return;
      }
      var del = ev.target.closest("[data-del]");
      if (del) {
        var key = del.getAttribute("data-del");
        var i = +del.getAttribute("data-i");
        if (key === "fixed_opex" && state.fixed_opex.length <= 1) return;
        if (key === "capex_p1" && state.capex_p1.length <= 1) return;
        if (key === "menu" && state.menu.length <= 1) return;
        state[key].splice(i, 1);
        onChange({ full: true });
        renderTab(currentTab());
      }
    });
  }

  /* -------------------------------------------------------- export / import */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function wireToolbar() {
    $("#btn-print").addEventListener("click", function () { window.print(); });
    var mcBtn = $("#btn-mc");
    if (mcBtn) mcBtn.addEventListener("click", function () { runMonteCarlo(true); });
    var pr = $("#btn-print-report");
    if (pr) pr.addEventListener("click", function () {
      if (!mc) {
        // one short run is enough to fill section 10, then print the real thing
        pr.disabled = true;
        var done = function () {
          pr.disabled = false;
          setTimeout(function () {
            document.body.classList.add("print-report");
            window.print();
            setTimeout(function () { document.body.classList.remove("print-report"); }, 500);
          }, 250);
        };
        var origDraw = drawQuant;
        drawQuant = function () { origDraw(); drawQuant = origDraw; renderReport(); done(); };
        runMonteCarlo(true);
        return;
      }
      document.body.classList.add("print-report");
      window.print();
      setTimeout(function () { document.body.classList.remove("print-report"); }, 500);
    });
    var dlStudy = $("#btn-study-html");
    if (dlStudy) dlStudy.addEventListener("click", function () {
      download("lab-feasibility-study.html", studyHtml(), "text/html;charset=utf-8");
    });

    $("#btn-json").addEventListener("click", function () {
      download("lab-inputs.json", JSON.stringify(state, null, 1));
    });

    $("#btn-load").addEventListener("click", function () { $("#file-input").click(); });
    $("#file-input").addEventListener("change", function (ev) {
      var file = ev.target.files[0];
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var got = JSON.parse(fr.result);
          state = mergeDeep(defaultsState(), got);
          onChange();
          renderTab(currentTab());
        } catch (e) { alert("Invalid file"); }
      };
      fr.readAsText(file);
      ev.target.value = "";
    });

    var empty = $("#btn-empty");
    if (empty) empty.addEventListener("click", function () {
      if (!confirm("Start from a blank sheet? All current data will be deleted.")) return;
      SUPPRESS_AUTOSAVE = true;
      state = blankState();
      localStorage.setItem(STORE, JSON.stringify(state));
      SUPPRESS_AUTOSAVE = false;
      compute(true);
      renderKpis();
      var b = $('#tabs button[data-tab="capex"]');
      if (b) {
        $$("#tabs button").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        b.setAttribute("aria-selected", "true");
        renderTab("capex");
      }
      syncPlanInputs();
      renderReport();
    });

    $("#btn-reset").addEventListener("click", function () {
      if (!confirm("Restore the worked example? Your edits will be lost.")) return;
      SUPPRESS_AUTOSAVE = true;
      state = defaultsState();
      localStorage.removeItem(STORE);
      SUPPRESS_AUTOSAVE = false;
      onChange();
      renderTab(currentTab());
    });

    document.addEventListener("click", function (ev) {
      var g = ev.target.closest("[data-goto]");
      if (!g) return;
      ev.preventDefault();
      var b = $('#tabs button[data-tab="' + g.getAttribute("data-goto") + '"]');
      if (b) b.click();
      else selectTab(g.getAttribute("data-goto"));
    });

    var openStudy = $("#btn-study");
    if (openStudy) openStudy.addEventListener("click", function () {
      selectTab("plan");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    var navPlan = $("#nav-plan");
    if (navPlan) navPlan.addEventListener("click", function (ev) {
      ev.preventDefault();
      selectTab("plan");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    $$("#tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
        selectTab(b.getAttribute("data-tab"));
      });
    });
  }

  /* -------------------------------------------------------------------- boot */
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (currentTab() === "overview") drawAll();
      if (currentTab() === "quant" && mc) drawFxChart();
    }, 180);
  });

  function init() {
    compute(true);
    renderKpis();
    wireToolbar();
    wireAssumptions();
    wireRowActions();
    wireDevices();
    wireCardInputs();
    wirePlanInputs();
    // The study is the deliverable, so it opens first; the dashboard tabs are
    // one click away and every number in the study comes from them.
    selectTab(/overview|tests|capex|opex|assumptions|monthly|quant/.test(location.hash)
      ? location.hash.replace("#", "")
      : "plan");
    syncAssumptionInputs();
    syncPlanInputs();
    renderReport();
  }

  /* deep links: #tests, #quant, #plan … switch tabs without a reload */
  /* flush the pending save when the tab is hidden or closed */
  ["visibilitychange", "pagehide", "beforeunload"].forEach(function (evt) {
    window.addEventListener(evt, function () {
      if (SUPPRESS_AUTOSAVE) return;      // do not resurrect a cleared state
      clearTimeout(saveTimer);
      clearTimeout(saveTimer2);
      try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {}
    });
  });

  window.addEventListener("hashchange", function () {
    var name = (location.hash || "").replace("#", "");
    if (/^(overview|tests|capex|opex|assumptions|monthly|quant|plan)$/.test(name)) {
      selectTab(name);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
