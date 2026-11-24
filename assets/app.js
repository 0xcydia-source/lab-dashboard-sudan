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
  function usd(x, d) { return nf(x, d) + "$"; }
  function sdg(x) { return nf(x) + " ج.س"; }   // SDG, not EGP
  function pct(x, d) { return nf(x, d == null ? 0 : d) + "%"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ------------------------------------------------------------------ state */
  var state = load();
  var results = null;

  function defaultsState(preset) {
    preset = preset || (typeof PRESET !== "undefined" ? PRESET.id : "full");
    var s = M.makeState();
    var lean = preset === "lean";
    var A2 = Object.assign({}, s.A);
    if (lean) { A2.phase2_month = 999; A2.phase3_month = 999; }
    return {
      preset: preset,
      A: A2,
      menu: s.menu.map(function (m) { return Object.assign({}, m); }),
      capex_p1: (lean
        ? M.LEAN_BOM.map(function (c) {
            return { item: c[0], qty: c[1], unit: c[2], src: c[3], note: "" };
          })
        : s.capex_p1.map(function (c) { return Object.assign({}, c); })),
      // the lean lab is the whole project: no phase 2/3 until you add them back
      capex_p2: lean ? [] : s.capex_p2.map(function (c) { return Object.assign({}, c); }),
      capex_p3: lean ? [] : s.capex_p3.map(function (c) { return Object.assign({}, c); }),
      fixed_opex: s.fixed_opex.map(function (c) { return Object.assign({}, c); }),
      lab: Object.assign({}, s.lab),
      ramp: s.ramp.slice(),
      stock_opening: lean ? M.LEAN_PCT.stock : s.stock_opening,
      contingency: lean ? M.LEAN_PCT.contingency : s.contingency,
      freight: lean ? M.LEAN_PCT.freight : s.freight,
      install: lean ? M.LEAN_PCT.install : s.install
    };
  }
  var DEFAULTS = defaultsState();
  var PRESET = { id: "full" };

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return defaultsState();
      var got = JSON.parse(raw);
      var base = defaultsState(got.preset || "full");
      return mergeDeep(base, got);
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
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(STORE, JSON.stringify(state));
        var el = $("#save-state");
        el.textContent = "محفوظ";
        el.className = "pill g";
        setTimeout(function () {
          el.textContent = "محفوظ تلقائياً";
          el.className = "pill";
        }, 1400);
      } catch (e) {
        $("#save-state").textContent = "تعذّر الحفظ";
        $("#save-state").className = "pill r";
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
    var pb = m.payback_months === null
      ? { v: "لا يحدث", s: "خلال 36 شهراً", c: "bad" }
      : { v: nf(m.payback_months, 1) + " شهر", s: "لا تشمل قيمة بيعية",
          c: m.payback_months <= 18 ? "good" : "warn" };

    var npvC = m.npv22 > 0 ? "good" : "bad";
    var beC = m.be_orders_day === null ? "bad"
      : (m.be_orders_day <= m.m12_orders_day ? "good" : "warn");

    var cards = [
      { k: "إجمالي الاستثمار (3 مراحل)", v: usd(m.capex_total),
        s: "منها " + usd(m.p1) + " للمرحلة 1", c: "" },
      { k: "النقد المطلوب قبل الافتتاح", v: usd(m.funding_need),
        s: "أسوأ نقطة: الشهر " + m.trough_month, c: "warn" },
      { k: "استرداد رأس المال", v: pb.v, s: pb.s, c: pb.c },
      { k: "هامش EBITDA (شهر 12)", v: pct(m.m12_margin),
        s: "إيراد " + usd(m.m12_rev) + "/شهر", c: m.m12_margin >= 30 ? "good" : "warn" },
      { k: "نقطة التعادل", v: nf(m.be_orders_day, 1) + " طلب/يوم",
        s: "≈ " + nf(m.be_patients_day, 0) + " مريضاً/يوم", c: beC },
      { k: "صافي القيمة الحالية (22%)", v: usd(m.npv22),
        s: "36 شهراً" + (m.irr_annual === null ? "" : " · IRR " + nf(m.irr_annual) + "%"), c: npvC }
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
        '<td class="name">' + esc(item.label) +
          (item.phase > 1 ? ' <span class="pill">م' + item.phase + "</span>" : "") + "</td>" +
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
          '" title="حذف الفحص">✕</button></td>' +
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
          '<div class="tcard-h"><span>' + esc(item.label) +
            (item.phase > 1 ? ' <span class="pill">م' + item.phase + "</span>" : "") +
          '</span><span style="display:flex;gap:6px;align-items:center;flex:none">' +
            '<span class="pill ' + cls + '" data-derived="mgc:' + i + '">' + nf(margin) + "%</span>" +
            '<button class="btn sm ghost" data-del="menu" data-i="' + i + '" title="حذف">✕</button>' +
          "</span></div>" +
          '<div class="tcard-g">' +
            '<div class="field"><label>السعر ($)</label><input type="number" step="0.25" min="0" ' +
              'data-menu="' + i + '" data-field="price_usd" value="' + item.price_usd + '"></div>' +
            '<div class="field"><label>تكلفة الكواشف ($)</label><input type="number" step="0.05" min="0" ' +
              'data-menu="' + i + '" data-field="vc" value="' + item.vc + '"></div>' +
            '<div class="field"><label>حصة الطلب</label><input type="number" step="0.005" min="0" max="1" ' +
              'data-menu="' + i + '" data-field="share" value="' + item.share + '"></div>' +
            '<div class="field"><label>دقائق فني</label><input type="number" step="0.5" min="0.5" ' +
              'data-menu="' + i + '" data-field="tech_min" value="' + item.tech_min + '"></div>' +
          "</div>" +
          '<div class="tcard-f"><span data-derived="cmc:' + i + '">مساهمة ' + usd(cm, 2) + '/طلب</span>' +
            '<span data-derived="nc:' + i + '">' + nf(per.n, 0) + " طلب/شهر</span></div>" +
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
    tfoot.innerHTML = "<tr class='total'><td>الإجمالي / المتوسط</td>" +
      "<td class='num'>—</td><td class='num'>—</td>" +
      "<td class='num' id='mt-share'>" + nf(shareSum * 100) + "%</td>" +
      "<td class='num' id='mt-cm'>" + nf(cmSum / (r12.orders || 1), 2) + "</td>" +
      "<td class='num' id='mt-mg'>" + nf(results.m.cm_pct) + "%</td>" +
      "<td class='num' id='mt-min'>" + nf(results.minutes, 1) + "</td>" +
      "<td class='num' id='mt-n'>" + nf(r12.orders) + "</td><td></td></tr>";

    var warn = Math.abs(shareSum - 1) > 0.02
      ? '<div class="note" style="margin:10px 0 0">مجموع الحصص ' + nf(shareSum * 100) +
        "% — سيُعاد توزيعها تلقائياً على 100% عند الحساب. عدّل الحصص إن أردت مزيجاً مختلفاً.</div>"
      : "";
    $("#menu-note").innerHTML = warn +
      "عمود «مساهمة» = السعر بالدولار ناقص تكلفة الكواشف. عمود «هامش» نسبته من السعر. " +
      "«طلبات/شهر» محسوبة من الشهر 12 بالحجم الحالي.";
    $("#menu-count").textContent = state.menu.length + " فحصاً";
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
      setTxt('[data-derived="cmc:' + i + '"]', "مساهمة " + usd(cm, 2) + "/طلب");
      setTxt('[data-derived="nc:' + i + '"]', nf(per.n) + " طلب/شهر");
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
        '<td><input class="wide" type="text" data-cx="1" data-i="' + i + '" data-f="item" value="' + esc(c.item) + '"></td>' +
        '<td class="num"><input type="number" min="0" step="1" data-cx="1" data-i="' + i + '" data-f="qty" value="' + c.qty + '"></td>' +
        '<td class="num"><input type="number" min="0" step="25" data-cx="1" data-i="' + i + '" data-f="unit" value="' + c.unit + '"></td>' +
        '<td class="num">' + usd(c.qty * c.unit) + "</td>" +
        '<td><span class="pill">' + (c.src === "own" ? "مقدَّم منك" : "تقدير") + "</span></td>" +
        '<td class="num"><button class="btn sm ghost" data-del="capex_p1" data-i="' + i + '" title="حذف">✕</button></td>' +
        "</tr>";
    }).join("");

    var cx = results.base.capex;
    $("#capex1-table tfoot").innerHTML =
      "<tr class='total'><td>عتاد</td><td></td><td></td><td class='num'>" + usd(cx.hardware) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>شحن وتخليص " + nf(state.freight * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.freight) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>تركيب وتدريب " + nf(state.install * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.install) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>مخزون افتتاحي</td><td></td><td></td><td class='num'>" + usd(cx.stock) + "</td><td colspan='2'></td></tr>" +
      "<tr><td>احتياطي طوارئ " + nf(state.contingency * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.contingency) + "</td><td colspan='2'></td></tr>" +
      "<tr class='total'><td>إجمالي المرحلة 1</td><td></td><td></td><td class='num'>" + usd(cx.p1) + "</td><td colspan='2'></td></tr>";

    [2, 3].forEach(function (ph) {
      var key = "capex_p" + ph;
      var t = $("#capex" + ph + "-table tbody");
      t.innerHTML = state[key].map(function (c, i) {
        return "<tr>" +
          '<td><input class="wide" type="text" data-cx="' + ph + '" data-i="' + i + '" data-f="item" value="' + esc(c.item) + '"></td>' +
          '<td class="num"><input type="number" min="0" step="25" data-cx="' + ph + '" data-i="' + i + '" data-f="unit" value="' + c.unit + '"></td>' +
          '<td class="num"><button class="btn sm ghost" data-del="' + key + '" data-i="' + i + '" title="حذف">✕</button></td>' +
          "</tr>";
      }).join("");
      var tot = state[key].reduce(function (s, c) { return s + c.qty * c.unit; }, 0);
      $("#capex" + ph + "-table tfoot").innerHTML =
        "<tr class='total'><td>الإجمالي</td><td class='num'>" + usd(tot) + "</td><td></td></tr>";
    });

    // phone cards mirror the same rows
    var c1 = $("#capex1-cards");
    if (c1) {
      c1.innerHTML = state.capex_p1.map(function (c, i) {
        return '<div class="tcard"><div class="tcard-h"><span>' + esc(c.item) + "</span>" +
          '<button class="btn sm ghost" data-del="capex_p1" data-i="' + i + '" title="حذف">✕</button></div>' +
          '<div class="tcard-g">' +
            '<div class="field"><label>العدد</label><input type="number" min="0" step="1" ' +
              'data-cx="1" data-i="' + i + '" data-f="qty" value="' + c.qty + '"></div>' +
            '<div class="field"><label>سعر الوحدة ($)</label><input type="number" min="0" step="25" ' +
              'data-cx="1" data-i="' + i + '" data-f="unit" value="' + c.unit + '"></div>' +
          "</div>" +
          '<div class="tcard-f"><span>الإجمالي ' + usd(c.qty * c.unit) + "</span>" +
          "<span>" + (c.src === "own" ? "مقدَّم منك" : "تقدير") + "</span></div></div>";
      }).join("");
    }
    [2, 3].forEach(function (ph) {
      var el = $("#capex" + ph + "-cards");
      if (!el) return;
      el.innerHTML = state["capex_p" + ph].map(function (c, i) {
        return '<div class="tcard"><div class="tcard-h"><span>' + esc(c.item) + "</span>" +
          '<button class="btn sm ghost" data-del="capex_p' + ph + '" data-i="' + i + '" title="حذف">✕</button></div>' +
          '<div class="tcard-g"><div class="field"><label>السعر ($)</label>' +
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
        "<tr class='total'><td>عتاد</td><td></td><td></td><td class='num'>" + usd(cx.hardware) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>شحن وتخليص " + nf(state.freight * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.freight) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>تركيب وتدريب " + nf(state.install * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.install) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>مخزون افتتاحي</td><td></td><td></td><td class='num'>" + usd(cx.stock) + "</td><td colspan='2'></td></tr>" +
        "<tr><td>احتياطي طوارئ " + nf(state.contingency * 100) + "%</td><td></td><td></td><td class='num'>" + usd(cx.contingency) + "</td><td colspan='2'></td></tr>" +
        "<tr class='total'><td>إجمالي المرحلة 1</td><td></td><td></td><td class='num'>" + usd(cx.p1) + "</td><td colspan='2'></td></tr>";
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
      if (tf) tf.innerHTML = "<tr class='total'><td>الإجمالي</td><td class='num'>" + usd(tot) + "</td><td></td></tr>";
    });
  }

  function refreshOpexTotals() {
    var sum = state.fixed_opex.reduce(function (a, o) { return a + o.usd; }, 0);
    var lab = results.base.months[11].labour;
    var tf = document.querySelector("#opex-table tfoot");
    if (tf) {
      tf.innerHTML =
        "<tr class='total'><td>إجمالي الثابتة</td><td class='num'>" + usd(sum) +
        "</td><td class='num'>" + usd(sum * 12) + "</td><td></td></tr>" +
        "<tr><td>أجور الفريق (تُحسب تلقائياً)</td><td class='num'>" + usd(lab) +
        "</td><td class='num'>" + usd(lab * 12) + "</td><td></td></tr>" +
        "<tr class='total'><td>الإجمالي الشهري</td><td class='num'>" + usd(sum + lab) +
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
        '<td class="num"><button class="btn sm ghost" data-del="fixed_opex" data-i="' + i + '" title="حذف">✕</button></td>' +
        "</tr>";
    }).join("");

    var sum = state.fixed_opex.reduce(function (s, o) { return s + o.usd; }, 0);
    var lab = results.base.months[11].labour;
    $("#opex-table tfoot").innerHTML =
      "<tr class='total'><td>إجمالي الثابتة</td><td class='num'>" + usd(sum) +
      "</td><td class='num'>" + usd(sum * 12) + "</td><td></td></tr>" +
      "<tr><td>أجور الفريق (تُحسب تلقائياً)</td><td class='num'>" + usd(lab) +
      "</td><td class='num'>" + usd(lab * 12) + "</td><td></td></tr>" +
      "<tr class='total'><td>الإجمالي الشهري</td><td class='num'>" + usd(sum + lab) +
      "</td><td class='num'>" + usd((sum + lab) * 12) + "</td><td></td></tr>";

    var oc = $("#opex-cards");
    if (oc) {
      oc.innerHTML = state.fixed_opex.map(function (o, i) {
        return '<div class="tcard"><div class="tcard-h"><span>' + esc(o.label) + "</span>" +
          '<button class="btn sm ghost" data-del="fixed_opex" data-i="' + i + '" title="حذف">✕</button></div>' +
          '<div class="tcard-g"><div class="field"><label>شهرياً ($)</label>' +
            '<input type="number" min="0" step="10" data-op="1" data-i="' + i +
            '" data-f="usd" value="' + o.usd + '"></div>' +
            '<div class="field"><label>سنوياً</label><input type="text" value="' +
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
          '<div class="tcard-h"><span>الشهر ' + r.month + " · " + r.y + "-" + (r.m < 10 ? "0" : "") + r.m +
            '</span><span class="pill ' + cls + '">EBITDA ' + nf(mg) + "%</span></div>" +
          '<div class="mrow-g">' +
            "<span>مرضى/يوم<b>" + nf(r.patients) + "</b></span>" +
            "<span>طلبات/يوم<b>" + nf(r.orders_day) + "</b></span>" +
            "<span>فنيون<b>" + r.techs + "</b></span>" +
            "<span>إيراد صافٍ<b>" + usd(r.rev) + "</b></span>" +
            "<span>كواشف<b>" + usd(r["var"]) + "</b></span>" +
            "<span>أجور<b>" + usd(r.labour) + "</b></span>" +
            "<span>ثابتة<b>" + usd(r.fixed) + "</b></span>" +
            "<span>EBITDA<b>" + usd(r.ebitda) + "</b></span>" +
            "<span>تدفق حر<b>" + usd(r.fcf) + "</b></span>" +
            "<span>تراكمي<b>" + usd(r.cum) + "</b></span>" +
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
    if (a >= 1e6) return (v / 1e6).toFixed(1) + "م";
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
      ? "الحالة الأساسية لا تسترد رأس المال خلال 36 شهراً بالمدخلات الحالية."
      : "الاسترداد في الحالة الأساسية: " + nf(m.payback_months, 1) + " شهراً. " +
        "التدفق التراكمي بعد 36 شهراً: " + usd(m.m36_cum) + ". المحور الأفقي: الشهر من الافتتاح.";
  }

  function drawBreakeven() {
    var host = $("#ch-breakeven");
    if (!host) return;
    var f = chartFrame(host, host.clientHeight || 300);
    var svg = f.svg, W = f.w, H = f.h;
    var m = results.m;
    if (m.be_orders_day === null) {
      host.innerHTML = '<p class="empty">هامش المساهمة سالب — راجع الأسعار والتكاليف.</p>';
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

    svgText(svg, "التعادل " + nf(m.be_orders_day, 0) + " طلب/يوم",
            X(m.be_orders_day) - 6, Y(hiY * 0.88), { anchor: "start", rtl: true, fill: "#4a5866" });
    svgText(svg, "طلبات / يوم", (X(0) + X(maxX)) / 2, H - 6,
            { anchor: "middle", rtl: true });

    $("#breakeven-note").textContent =
      "التكاليف الثابتة " + usd(fixed) + "/شهر · هامش المساهمة " + usd(m.cm_usd, 2) +
      " لكل طلب · هامش الأمان في الشهر 12: " + pct(m.mos_pct) + ".";
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
      ["كواشف ومستهلكات", r["var"], "#12507a"],
      ["أجور", r.labour, "#c8860d"],
      ["تكاليف ثابتة", r.fixed, "#7d8b99"],
      ["مستهلكات سحب", r.collect, "#4b7f9e"],
      ["عمولة إحالة", r.referral, "#b06a2c"],
      ["تسرب إيراد", r.rev_gross - r.rev - r.referral, "#c0a08a"]
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
      '<p class="chart-note" style="margin-top:10px">إجمالي التكلفة النقدية ' + usd(total) +
      " من إيراد إجمالي " + usd(r.rev_gross) + " · هامش EBITDA " + pct(results.m.m12_margin) + ".</p>";
  }

  function drawTornado() {
    var host = $("#ch-tornado");
    if (!host) return;
    var st = results.st;
    var tests = [
      ["حجم الطلب اليومي", function (v) { return M.metrics(M.run(st, { vol: v })).npv22; }, 0.6, 1.4, "%"],
      ["سعر البيع الحقيقي", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { price_index: st.A.price_index * v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.85, 1.15, "%"],
      ["تكلفة الكواشف", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { vc_mult: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.65, 1.45, "%"],
      ["طلبات لكل مريض", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { tests_per_patient: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 1.2, 1.85, "x"],
      ["تمرير سعر الصرف", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { pass_through: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.5, 1.0, "%"],
      ["انخفاض الجنيه", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { fx_drift: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.10, 0.60, "%"],
      ["تكاليف ثابتة", function (v) {
        var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { opex_mult: v }) });
        return M.metrics(M.run(s2, {})).npv22;
      }, 0.85, 1.20, "%"],
      ["سعر الأجهزة", function (v) {
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
        '<span><i style="background:#a3261f"></i>عند الحد الأدنى</span>' +
        '<span><i style="background:#1d7a4d"></i>عند الحد الأعلى</span>' +
        '<span><i style="background:#16212b"></i>الحالة الأساسية (' + usd(base) + ")</span>" +
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
    var ANALYZERS = /CBC|كيمياء|سنترفيوج|ميكروسكوب|ESR|Vortex|Rotator|ماصات|ميزان|حامل/i;
    var BASICS = /ثلاجة|مولد|UPS|AVR|تكييف|مقطر|حمام|كمبيوتر|LIS/i;
    var hw = results.st.capex_p1.map(function (c) { return { item: c.item, total: c.qty * c.unit }; });
    var sum = function (re) {
      return hw.filter(function (x) { return re.test(x.item); })
               .reduce(function (a, x) { return a + x.total; }, 0);
    };
    var analyzers = sum(ANALYZERS), basics = sum(BASICS);
    var rest = Math.max(0, cx.hardware - analyzers - basics);
    var groups = [
      ["أجهزة التحليل والماصات", analyzers, "#12507a"],
      ["تجهيز وأثاث وتراخيص", rest, "#3f7fa6"],
      ["أساسيات (ثلاجة/مولد/UPS/تكييف)", basics, "#7ba7c4"],
      ["شحن وتخليص", cx.freight, "#c8860d"],
      ["تركيب وتدريب", cx.install, "#d9a54a"],
      ["مخزون افتتاحي", cx.stock, "#1d7a4d"],
      ["احتياطي طوارئ", cx.contingency, "#9aa6b2"]
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
      '<p class="chart-note" style="margin-top:8px">إجمالي الاستثمار ' + usd(total) +
      " · العتاد " + usd(cx.hardware) + "</p>";
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
            r.perMin.toFixed(2) + " / دقيقة</span></div>" +
        '<div style="height:12px;background:#f2f5f8;border-radius:4px;overflow:hidden">' +
          '<span style="display:block;height:100%;width:' + (r.perMin / max * 100).toFixed(1) +
          '%;background:#12507a"></span></div>' +
        "</div>";
    }).join("") +
      '<p class="chart-note">' + nf(rows.length) + " فحصاً نشطاً · أعلى قيمة لكل دقيقة فني: " +
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
    // localStorage write is ~1 KB of JSON; do it off the typing path
    clearTimeout(saveTimer2);
    saveTimer2 = setTimeout(save, 400);
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

  /* -------------------------------------------------------------------- tabs */
  function currentTab() {
    var b = $("#tabs button[aria-selected='true']");
    return b ? b.getAttribute("data-tab") : "overview";
  }
  function renderTab(name) {
    $$("[data-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
    if (name === "tests") renderMenu();
    if (name === "capex") renderCapex();
    if (name === "opex") renderOpex();
    if (name === "monthly") renderMonthly();
    if (name === "assumptions") syncAssumptionInputs();
    if (name === "overview") {
      setTimeout(function () {
        if (!results.scen) compute(true);
        drawAll();
      }, 20);
    }
  }

  function syncAssumptionInputs() {
    var map = {
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
      "lab-phleb": "lab.phleb"
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var v = getByPath(state, map[id]);
      el.value = v;
      el.className = isChanged(map[id]) ? "changed" : "";
    });
    var r12 = document.getElementById("ramp12");
    if (r12) { r12.value = state.ramp[11]; r12.className = isChanged("ramp12") ? "changed" : ""; }
  }

  function wireAssumptions() {
    var map = {
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
      "lab-phleb": "lab.phleb"
    };
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
            if (tot) tot.textContent = "الإجمالي " + usd(state["capex_p" + ph][i].qty * state["capex_p" + ph][i].unit);
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
        var val = Number(inp.value);
        if (isNaN(val)) return;
        state.menu[k][fld] = val;
        inp.className = "changed";
        onChange();
      }
    }, true);
  }

  /* --------------------------------------------------------------- presets */
  function syncPresetBar() {
    var id = state.preset || "full";
    $$("[data-preset]").forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-preset") === id ? "true" : "false");
    });
    var note = $("#preset-note");
    if (note && M.PRESETS[id]) {
      note.textContent = id === "lean"
        ? "معمل صغير: جهازا CBC وكيمياء + أساسيات + رخصة. مناسب لبداية بـ 5,000$ نقداً. " +
          "الأجهزة هنا فئة دخول — تحقق من الكواشف والضمان قبل الشراء."
        : "الخطة الكاملة: CBC Mindray بضمان + ثلاجة كواشف 350 لتر + مولد 6–7kVA + مخزون أكبر + احتياطي 8%.";
    }
  }

  function applyPreset(id) {
    if (!confirm(id === "lean"
      ? "التحويل إلى «معمل صغير ~5,000$»؟ سيُستبدل جدول الأجهزة بالكامل ونسب الشحن/المخزون. تعديلاتك الحالية على الأجهزة ستُفقد."
      : "العودة إلى «الخطة الكاملة»؟ سيُستبدل جدول الأجهزة بالكامل. تعديلاتك الحالية على الأجهزة ستُفقد.")) return;
    var keep = { A: state.A, menu: state.menu, fixed_opex: state.fixed_opex,
                 lab: state.lab, ramp: state.ramp };
    state = defaultsState(id);
    state = mergeDeep(state, keep);
    state.preset = id;
    localStorage.setItem(STORE, JSON.stringify(state));
    compute(true);
    renderKpis();
    renderTab(currentTab());
    syncPresetBar();
    save();
  }

  function wirePresets() {
    document.addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-preset]");
      if (!b) return;
      var id = b.getAttribute("data-preset");
      if (id === (state.preset || "full")) return;
      applyPreset(id);
    });
    syncPresetBar();
  }

  /* ------------------------------------------------------- add / delete rows */
  function wireRowActions() {
    document.addEventListener("click", function (ev) {
      var add = ev.target.closest("[data-add]");
      if (add) {
        var kind = add.getAttribute("data-add");
        if (kind === "capex1") state.capex_p1.push({ item: "بند جديد", qty: 1, unit: 100, src: "est", note: "" });
        if (kind === "capex2") state.capex_p2.push({ item: "بند جديد", qty: 1, unit: 500, src: "est", note: "" });
        if (kind === "capex3") state.capex_p3.push({ item: "بند جديد", qty: 1, unit: 500, src: "est", note: "" });
        if (kind === "opex") state.fixed_opex.push({ label: "بند جديد", usd: 50 });
        if (kind === "menu") {
          var n = Object.keys(state.menu).length + 1;
          state.menu.push({
            key: "custom_" + Date.now(), label: "فحص جديد " + n,
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
        } catch (e) { alert("ملف غير صالح"); }
      };
      fr.readAsText(file);
      ev.target.value = "";
    });

    $("#btn-reset").addEventListener("click", function () {
      if (!confirm("استعادة القيم الأصلية للدراسة؟ ستُفقد كل تعديلاتك.")) return;
      state = defaultsState(state.preset || "full");
      localStorage.removeItem(STORE);
      syncPresetBar();
      onChange();
      renderTab(currentTab());
    });

    $$("#tabs button").forEach(function (b) {
      b.addEventListener("click", function () {
        $$("#tabs button").forEach(function (x) { x.setAttribute("aria-selected", "false"); });
        b.setAttribute("aria-selected", "true");
        renderTab(b.getAttribute("data-tab"));
      });
    });
  }

  /* -------------------------------------------------------------------- boot */
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (currentTab() === "overview") drawAll();
    }, 180);
  });

  function init() {
    compute(true);
    renderKpis();
    wireToolbar();
    wireAssumptions();
    wireRowActions();
    wireCardInputs();
    wirePresets();
    renderTab("overview");
    syncAssumptionInputs();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
