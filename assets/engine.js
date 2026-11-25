/* Model engine — a faithful JavaScript port of labsudan-ops/model.py.
 * Pure functions, no DOM. Usable from the browser and from Node (for tests).
 * All money in USD unless the field name says SDG.
 */
(function (root) {
  "use strict";

  var LAB = { tech: 220, phleb: 130, senior_tech: 320 };
  var RAMP = [10, 16, 24, 30, 36, 42, 48, 53, 58, 62, 65, 68];
  var SEASON = { 1: 1.02, 2: 0.98, 3: 0.96, 4: 1.0, 5: 1.02, 6: 1.05,
                 7: 1.10, 8: 1.18, 9: 1.25, 10: 1.28, 11: 1.20, 12: 1.05 };
  var SEASONAL = ["malaria", "ict", "stool", "serology", "cbc", "urine"];

  var A = {
    fx_sdg: 12000, fx_egp: 54, fx_drift: 0.18, pass_through: 0.9, pass_lag_months: 1,
    reagent_fx_beta: 0,
    days: 26, price_index: 1, tests_per_patient: 1.55, vc_mult: 1, opex_mult: 1,
    capex_mult: 1, discount: 0.22, tax: 0.17, dep_years_eq: 5, dep_years_it: 3,
    dep_years_fit: 5, phase2_month: 6, phase3_month: 16, terminal_ebitda_x: 12,
    tech_eff: 0.85, shift_min: 480, overhead_min_per_order: 1.3,
    collection_consumables_usd: 0.55, revenue_leakage: 0.03,
    service_contract_pct: 0.025, price_erosion: 0.015, stock_months: 1.5,
    referral_pct: 0.08, referred_share: 0.55, import_premium: 0.08,
    hire_at_util: 0.9, wc_months_recv: 0.35, tpp_bonus_phase2: 0.1,
    tpp_bonus_phase3: 0.12
  };

  /* key, label, price_usd, vc_usd, tech_min, share, phase, note
   * price_usd is what the patient pays, in USD. SDG is derived from it. */
  var MENU = [
    ["cbc", "Complete Blood Count (CBC, 3-part)", 4.42, 1.2, 5.0, 0.24, 1, "3 reagents + daily QC"],
    ["chem", "Chemistry - single test (urea/creatinine/uric acid/glucose)", 3.13, 0.45, 4.0, 0.24, 1, "Liquid reagents, weekly calibration"],
    ["panel", "Chemistry panel (10-12 analytes)", 15.46, 2.6, 16.0, 0.07, 1, "Highest revenue per tech-minute"],
    ["hb", "Hemoglobin (Hb)", 1.47, 0.12, 1.5, 0.04, 1, "Drabkin"],
    ["esr", "ESR (erythrocyte sedimentation)", 2.94, 0.2, 5.0, 0.04, 1, "Westergren, manual"],
    ["malaria", "Malaria smear / RDT", 2.94, 0.75, 8.0, 0.08, 1, "Seasonal"],
    ["urine", "Urinalysis (dipstick + microscopy)", 2.94, 0.45, 6.0, 0.06, 1, "10-parameter strip"],
    ["stool", "Stool analysis", 2.94, 0.3, 7.0, 0.02, 1, ""],
    ["serology", "Serology (Widal/ASO/RF/CRP/VDRL)", 2.76, 0.55, 6.0, 0.07, 1, "Latex / titre"],
    ["ict", "Rapid test ICT (typhoid/H.pylori/hepatitis/HCG/Dengue)", 4.05, 1.25, 3.0, 0.09, 1, "Cassette is the priciest USD item"],
    ["semen", "Semen analysis", 5.52, 0.25, 12.0, 0.01, 1, ""],
    ["hba1c", "HbA1c", 4.42, 1.6, 4.0, 0.04, 2, "Imported reagents"],
    ["electro", "Electrolytes Na/K/Cl (ISE)", 6.62, 1.35, 3.0, 0.05, 2, "ISE cartridges"],
    ["coag", "Coagulation PT/INR", 5.52, 2.0, 4.0, 0.03, 2, ""],
    ["hormone", "Hormones CLIA (TSH/FT4/beta-hCG)", 9.2, 4.5, 6.0, 0.02, 3, "Most expensive reagents"],
    ["elisa", "ELISA (confirmation / viral hepatitis)", 8.1, 2.5, 16.0, 0.01, 2, "96-well plate"]
  ];

  var CAPEX_P1 = [
    ["Mindray BC-21s CBC analyzer (new, 6-month warranty)", 1, 2900, "own"],
    ["Semi-auto chemistry analyzer (ELHODA 880 / HC-80+)", 1, 1250, "own"],
    ["Centrifuge, 6-place", 1, 65, "own"],
    ["Binocular LED microscope + 100x oil objective", 1, 210, "own"],
    ["ESR stand + timer", 1, 70, "est"],
    ["Digital water bath", 1, 120, "est"],
    ["Vortex mixer", 1, 35, "est"],
    ["Rotator for latex tests", 1, 45, "est"],
    ["Analytical balance 0.001 g", 1, 180, "est"],
    ["Reagent fridge 350 L, glass door", 1, 600, "est"],
    ["Water still 4 L/h", 1, 220, "est"],
    ["Micropipettes x3 + stand + tips", 1, 240, "est"],
    ["Online UPS 2 kVA", 1, 250, "est"],
    ["Voltage regulator AVR 5 kVA", 1, 120, "est"],
    ["Generator 6-7 kVA", 1, 900, "est"],
    ["PC + laser printer + LIS", 1, 700, "est"],
    ["Split AC 1.5 HP x2", 1, 1000, "est"],
    ["Furniture and fit-out, 60-80 m2", 1, 1200, "est"],
    ["Signage + licensing + legal fees", 1, 600, "est"],
    ["Biosafety and PPE kit", 1, 350, "est"]
  ];

  var CAPEX_P2 = [
    ["Electrolyte analyzer Na/K/Cl (ISE)", 1600],
    ["HbA1c analyzer", 1300],
    ["Coagulation analyzer, 2-channel (PT/INR/APTT)", 1900],
    ["ELISA reader + washer", 2400],
    ["Reagent stock for section 2", 900]
  ];

  var CAPEX_P3 = [
    ["Semi-auto CLIA hormone analyzer", 3600],
    ["Incubator + autoclave", 1600]
  ];

  var FIXED_OPEX = [
    ["Rent, 60-80 m2 in Arkawit", 500],
    ["Owner/manager salary (admin + QC review)", 350],
    ["Receptionist", 100],
    ["Cleaner (part-time)", 55],
    ["Grid electricity", 90],
    ["Generator fuel", 140],
    ["Water", 30],
    ["Internet and phone", 40],
    ["Service and spare parts", 130],
    ["Marketing (signage, clinic rep, social)", 150],
    ["Non-reagent consumables (gloves/tubes/needles/slides)", 190],
    ["QC and calibration materials", 90],
    ["Medical waste disposal", 45],
    ["LIS software + backup", 35],
    ["Admin and misc", 70]
  ];

  var STOCK_OPENING = 2300;
  var CONTINGENCY = 0.08;
  var FREIGHT = 0.12;
  var INSTALL = 0.03;
  var PHLEB_PATIENTS_PER = 55;


  /* Lean preset: a small lab that really opens for about 5,000 USD turnkey.
   * Same engine, shorter BOM, lower logistics percentages. */
  var LEAN_BOM = [
    ["CBC 3-part (PH-70 or DH33)", 1, 1180, "est"],
    ["Semi-auto chemistry (HC-80+ / 888)", 1, 780, "est"],
    ["Centrifuge, 6-place", 1, 50, "est"],
    ["Binocular LED microscope", 1, 150, "est"],
    ["ESR stand + timer", 1, 50, "est"],
    ["Vortex mixer", 1, 28, "est"],
    ["Micropipettes x3 + stand", 1, 160, "est"],
    ["Reagent fridge 200 L", 1, 185, "est"],
    ["UPS 1 kVA", 1, 100, "est"],
    ["Voltage regulator AVR 5 kVA", 1, 55, "est"],
    ["Generator 3 kVA", 1, 260, "est"],
    ["PC + printer + basic LIS", 1, 310, "est"],
    ["Basic furniture and fit-out (40-60 m2)", 1, 330, "est"],
    ["Licensing and signage", 1, 350, "est"],
    ["Biosafety kit", 1, 100, "est"]
  ];
  var LEAN_PCT = { freight: 0.05, install: 0.02, stock: 400, contingency: 0.04 };

  var PRESETS = {
    full: { label: "Full build", note: "Mindray CBC + 350 L reagent fridge + 6-7 kVA generator + larger stock" },
    lean: { label: "Small lab (~$5,000)", note: "Minimum workable setup: two analyzers + essentials + licence" }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------ state build */
  function makeState(over) {
    over = over || {};
    var st = {
      A: Object.assign({}, A, over.A || {}),
      menu: (over.menu || MENU).map(function (m) {
        if (Array.isArray(m)) {
          return { key: m[0], label: m[1], price_usd: m[2], vc: m[3],
                   tech_min: m[4], share: m[5], phase: m[6], note: m[7] };
        }
        return Object.assign({}, m);
      }),
      capex_p1: (over.capex_p1 || CAPEX_P1).map(function (c) {
        if (Array.isArray(c)) return { item: c[0], qty: c[1], unit: c[2], src: c[3], note: "" };
        return Object.assign({}, c);
      }),
      capex_p2: (over.capex_p2 || CAPEX_P2).map(function (c) {
        if (Array.isArray(c)) return { item: c[0], qty: 1, unit: c[1], src: "est", note: "" };
        return Object.assign({}, c);
      }),
      capex_p3: (over.capex_p3 || CAPEX_P3).map(function (c) {
        if (Array.isArray(c)) return { item: c[0], qty: 1, unit: c[1], src: "est", note: "" };
        return Object.assign({}, c);
      }),

      fixed_opex: (over.fixed_opex || FIXED_OPEX).map(function (o) {
        if (Array.isArray(o)) return { label: o[0], usd: o[1] };
        return Object.assign({}, o);
      }),
      ramp: (over.ramp || RAMP).slice(),
      lab: Object.assign({}, LAB, over.lab || {}),
      stock_opening: over.stock_opening != null ? over.stock_opening : STOCK_OPENING,
      contingency: over.contingency != null ? over.contingency : CONTINGENCY,
      freight: over.freight != null ? over.freight : FREIGHT,
      install: over.install != null ? over.install : INSTALL
    };
    return st;
  }

  /* ------------------------------------------------------------------ capex */
  function capex(st, P) {
    var p = P || st.A;
    var hw = st.capex_p1.reduce(function (s, r) { return s + (r.qty || 0) * (r.unit || 0); }, 0);
    // round each derived line the same way the reference python model does,
    // otherwise the report and the dashboard disagree by a dollar
    var freight = Math.round(hw * st.freight);
    var install = Math.round(hw * st.install);
    var sub = hw + freight + install + st.stock_opening;
    var cont = Math.round(sub * st.contingency);
    var p1 = Math.round((sub + cont) * p.capex_mult);
    var p2 = Math.round(st.capex_p2.reduce(function (s, r) { return s + (r.qty || 0) * (r.unit || 0); }, 0) * p.capex_mult);
    var p3 = Math.round(st.capex_p3.reduce(function (s, r) { return s + (r.qty || 0) * (r.unit || 0); }, 0) * p.capex_mult);
    return { hardware: hw, freight: freight, install: install,
             stock: st.stock_opening, contingency: cont, subtotal: sub,
             p1: p1, p2_total: p2, p3_total: p3 };
  }

  /* --------------------------------------------------------------- staffing */
  function minutesPerOrder(st, keys) {
    var p = st.A, mk = st.menu.filter(function (m) { return !keys || keys.indexOf(m.key) >= 0; });
    var tot = mk.reduce(function (s, m) { return s + m.share; }, 0) || 1;
    var w = mk.reduce(function (s, m) { return s + m.share * m.tech_min; }, 0) / tot;
    return w + p.overhead_min_per_order;
  }

  function staffing(ordersDay, st) {
    var p = st.A;
    var needed = ordersDay * minutesPerOrder(st);
    var cap = p.shift_min * p.tech_eff;
    var target = cap * p.hire_at_util;
    var techs = Math.max(1, Math.ceil(needed / target));
    return { techs: techs, needed: needed, cap: cap * techs };
  }

  function labourCost(ordersDay, ptsDay, st) {
    var s = staffing(ordersDay, st);
    var senior = s.techs >= 3 ? 1 : 0;
    var cost = s.techs * st.lab.tech + senior * (st.lab.senior_tech - st.lab.tech);
    var phleb = Math.max(1, Math.ceil(ptsDay / PHLEB_PATIENTS_PER));
    cost += phleb * st.lab.phleb;
    return { cost: cost, techs: s.techs, phleb: phleb, needed: s.needed,
             capMin: s.cap, util: s.needed / s.cap * 100 };
  }

  /* ----------------------------------------------------------------- demand */
  function testsPerPatient(t, p) {
    var v = p.tests_per_patient;
    if (t >= p.phase2_month + 1) v += p.tpp_bonus_phase2;
    if (t >= p.phase3_month + 1) v += p.tpp_bonus_phase3;
    return v;
  }

  function demand(t, st, vol, P) {
    vol = vol == null ? 1 : vol;
    var p = P || st.A;
    var pts = t < 12 ? st.ramp[t] : st.ramp[11] * Math.pow(1.005, t - 11);
    pts *= vol;
    return { patients: pts, orders: pts * testsPerPatient(t, p) * p.days };
  }

  function liveKeys(t, st, P) {
    var p = P || st.A;
    return st.menu.filter(function (m) {
      return m.phase === 1 ||
        (m.phase === 2 && t >= p.phase2_month) ||
        (m.phase === 3 && t >= p.phase3_month);
    });
  }

  /* ------------------------------------------------------------------- run */
  function run(st, over) {
    over = over || {};
    var p = Object.assign({}, st.A, over.A || {});
    // A state-level phase month wins over the defaults packed into A() only when
    // the caller did not pass its own value (neither top-level nor inside A).
    var oA = over.A || {};
    if (oA.phase2_month == null && over.phase2_month == null && st.phase2_month != null) {
      p.phase2_month = st.phase2_month;
    }
    if (oA.phase3_month == null && over.phase3_month == null && st.phase3_month != null) {
      p.phase3_month = st.phase3_month;
    }
    var vol = over.vol != null ? over.vol : 1;
    var cap = capex(st, p);
    var m2 = p.phase2_month - 1, m3 = p.phase3_month - 1;
    var fixedBase = st.fixed_opex.reduce(function (s, o) { return s + o.usd; }, 0);
    var months = [], wcPrev = 0, wcPeak = 0;

    function fxAt(t) { return p.fx_sdg * Math.pow(1 + p.fx_drift, t / 12); }

    for (var t = 0; t < 36; t++) {
      var y = 2026 + Math.floor((10 + t) / 12);
      var m = ((10 + t) % 12) + 1;
      var d = demand(t, st, vol, p);
      var od = d.orders / p.days;
      var lab = labourCost(od, d.patients, st);
      var keys = liveKeys(t, st, p);
      var tot = keys.reduce(function (s, k) { return s + k.share; }, 0) || 1;
      var season = SEASON[m] || 1;
      // --- FX exposure (identical to model.py) ---------------------------
      // The lab charges in SDG but buys reagents in USD. The USD list is the
      // anchor; what is realized depends on how much of the SDG move has been
      // repriced (pass_through) and how stale the live list is (pass_lag).
      var fxNow = fxAt(t);
      var fxList = t >= p.pass_lag_months ? fxAt(t - p.pass_lag_months) : p.fx_sdg;
      var fxPriceF = Math.pow(fxList / p.fx_sdg, p.pass_through) / (fxNow / p.fx_sdg);
      var erosionF = Math.pow(1 - p.price_erosion, t / 12);
      var priceF = fxPriceF * erosionF;
      var costFxF = Math.pow(fxNow / p.fx_sdg, p.reagent_fx_beta);
      var revSdg = 0, varc = 0, per = {};
      keys.forEach(function (k) {
        var mult = SEASONAL.indexOf(k.key) >= 0 ? season : 1;
        var n = d.orders * (k.share / tot) * (1 + (mult - 1) * 0.35);
        // USD-priced menu: the SDG list is derived, and `priceF` is the share of
        // the USD price actually realized after FX and repricing lag.
        var pUsd = k.price_usd * p.price_index * priceF;
        var vc = k.vc * p.vc_mult * (1 + p.import_premium) * costFxF;
        revSdg += n * pUsd * fxNow;
        varc += n * vc;
        per[k.key] = {
          label: k.label, n: n, price_usd: pUsd, price_sdg: pUsd * fxNow, vc: vc,
          contribution: n * (pUsd - vc), revenue: n * pUsd,
          share_pct: d.orders ? n / d.orders * 100 : 0, phase: k.phase, tech_min: k.tech_min
        };
      });

      var rev = revSdg / fxNow;
      var referral = rev * p.referred_share * p.referral_pct;
      var revNet = rev * (1 - p.revenue_leakage) - referral;
      var collect = d.patients * p.days * p.collection_consumables_usd * p.vc_mult;
      var service = cap.hardware * p.service_contract_pct / 12;
      var fixed = fixedBase * p.opex_mult;
      var ebitda = revNet - varc - collect - service - fixed - lab.cost;

      var dep = cap.p1 / (p.dep_years_eq * 12);
      if (t >= m2) dep += cap.p2_total / (p.dep_years_eq * 12);
      if (t >= m3) dep += cap.p3_total / (p.dep_years_eq * 12);
      var ebit = ebitda - dep;
      var tax = Math.max(ebit, 0) * p.tax;
      var net = ebit - tax;

      var recv = t + 1 >= 12 ? p.wc_months_recv * (varc + lab.cost + fixed) : 0;
      var wcNeed = t === 0 ? 0 : varc * p.stock_months + recv;
      var wcDelta = wcNeed - wcPrev;
      wcPrev = wcNeed;
      if (wcNeed > wcPeak) wcPeak = wcNeed;

      var capexOut = t === 0 ? cap.p1 : 0;
      if (t === m2) capexOut += cap.p2_total;
      if (t === m3) capexOut += cap.p3_total;
      var fcf = ebitda - tax - capexOut - wcDelta;

      months.push({
        t: t, month: t + 1, y: y, m: m, patients: d.patients, orders: d.orders,
        orders_day: od, techs: lab.techs, phleb: lab.phleb, util: lab.util,
        fx: fxNow, price_f: priceF, rev_gross: rev, rev: revNet, var: varc,
        collect: collect, service: service, referral: referral, fixed: fixed,
        labour: lab.cost, ebitda: ebitda, dep: dep, ebit: ebit, tax: tax, net: net,
        capex: capexOut, wc: wcNeed, wc_delta: wcDelta, fcf: fcf, per: per,
        season: season, tpp: testsPerPatient(t, p)
      });
    }

    var cum = 0, trough = 0, troughM = 0;
    months.forEach(function (r) {
      cum += r.fcf;
      r.cum = cum;
      if (cum < trough) { trough = cum; troughM = r.month; }
    });

    return { months: months, capex: cap, params: p, fixedBase: fixedBase,
             wcPeak: wcPeak, trough: trough, troughMonth: troughM,
             hardware: cap.hardware };
  }

  /* --------------------------------------------------------------- metrics */
  function npvOf(cf, rate, terminal) {
    var mr = Math.pow(1 + rate, 1 / 12) - 1, v = 0;
    for (var i = 0; i < cf.length; i++) v += cf[i] / Math.pow(1 + mr, i + 1);
    if (terminal) v += terminal / Math.pow(1 + mr, cf.length);
    return v;
  }

  function irrOf(cf) {
    var lo = -0.95, hi = 3.0;
    if (npvOf(cf, lo) < 0 || npvOf(cf, hi) > 0) return null;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (npvOf(cf, mid) > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function sum(arr, f) { return arr.reduce(function (s, x) { return s + f(x); }, 0); }

  function metrics(res) {
    var ms = res.months, cap = res.capex, p = res.params;
    var spent2 = p.phase2_month <= 36 ? cap.p2_total : 0;
    var spent3 = p.phase3_month <= 36 ? cap.p3_total : 0;
    var capexTotal = cap.p1 + spent2 + spent3;

    var payback = null, run_ = 0;
    for (var i = 0; i < ms.length; i++) {
      var prev = run_;
      run_ += ms[i].fcf;
      if (payback === null && run_ > 0 && prev <= 0) {
        var den = run_ - prev;
        payback = ms[i].t + (den ? -prev / den : 0.5);
      }
    }
    var cf = ms.map(function (r) { return r.fcf; });
    var terminal = p.terminal_ebitda_x * ms[ms.length - 1].ebitda;
    var irr = irrOf(cf);

    var r12 = ms[11];
    var avgP = r12.orders ? r12.rev / r12.orders : 0;
    var avgVc = r12.orders ? r12["var"] / r12.orders : 0;
    var cm = avgP * (1 - p.revenue_leakage - p.referred_share * p.referral_pct) - avgVc;
    var fixedAll = r12.fixed + r12.labour + r12.service;
    var be = cm > 0 ? fixedAll / cm : Infinity;

    return {
      p1: cap.p1, p2: cap.p2_total, p3: cap.p3_total, hardware: cap.hardware,
      capex_total: Math.round(capexTotal), stock_wc: Math.round(res.wcPeak),
      wc_peak: Math.round(res.wcPeak),
      invested: Math.round(cap.p1 + res.wcPeak),
      payback_months: payback === null ? null : Math.round(payback * 10) / 10,
      npv22: Math.round(npvOf(cf, 0.22)),
      npv12: Math.round(npvOf(cf, 0.12)),
      npv22_term: Math.round(npvOf(cf, 0.22, terminal)),
      npv0: Math.round(npvOf(cf, 0)),
      irr_annual: irr === null ? null : Math.round(irr * 1000) / 10,
      trough: Math.round(res.trough),
      trough_month: res.troughMonth,
      funding_need: Math.round(-res.trough * 1.10 / 100) * 100,
      yr1_rev: Math.round(sum(ms.slice(0, 12), function (r) { return r.rev; })),
      yr2_rev: Math.round(sum(ms.slice(12, 24), function (r) { return r.rev; })),
      yr3_rev: Math.round(sum(ms.slice(24, 36), function (r) { return r.rev; })),
      yr1_ebitda: Math.round(sum(ms.slice(0, 12), function (r) { return r.ebitda; })),
      yr2_ebitda: Math.round(sum(ms.slice(12, 24), function (r) { return r.ebitda; })),
      yr3_ebitda: Math.round(sum(ms.slice(24, 36), function (r) { return r.ebitda; })),
      yr1_net: Math.round(sum(ms.slice(0, 12), function (r) { return r.net; })),
      yr2_net: Math.round(sum(ms.slice(12, 24), function (r) { return r.net; })),
      yr3_net: Math.round(sum(ms.slice(24, 36), function (r) { return r.net; })),
      m12_rev: Math.round(r12.rev), m12_ebitda: Math.round(r12.ebitda),
      m12_margin: r12.rev ? Math.round(r12.ebitda / r12.rev * 1000) / 10 : null,
      m12_orders_day: Math.round(r12.orders_day * 10) / 10,
      m12_orders: Math.round(r12.orders),
      m12_patients: Math.round(r12.patients * 10) / 10,
      m12_techs: r12.techs, m12_util: Math.round(r12.util * 10) / 10,
      m12_fx: Math.round(r12.fx), m12_var: Math.round(r12["var"]),
      m12_fixed: Math.round(r12.fixed), m12_labour: Math.round(r12.labour),
      m12_cum: Math.round(r12.cum), m36_cum: Math.round(ms[35].cum),
      m36_rev: Math.round(ms[35].rev), m36_ebitda: Math.round(ms[35].ebitda),
      avg_price_usd: Math.round(avgP * 100) / 100,
      avg_price_sdg: Math.round(avgP * r12.fx),
      avg_vc_usd: Math.round(avgVc * 100) / 100,
      cm_usd: Math.round(cm * 100) / 100,
      cm_pct: Math.round(cm / avgP * 1000) / 10,
      fixed_all_m12: Math.round(fixedAll),
      be_orders_m: be === Infinity ? null : Math.round(be),
      be_orders_day: be === Infinity ? null : Math.round(be / p.days * 10) / 10,
      be_patients_day: be === Infinity ? null : Math.round(be / p.days / r12.tpp * 10) / 10,
      be_rev_usd: be === Infinity ? null : Math.round(be * avgP),
      mos_pct: be === Infinity ? null : Math.round((r12.orders - be) / r12.orders * 1000) / 10,
      tpp_m12: Math.round(r12.tpp * 100) / 100
    };
  }

  /* -------------------------------------------------------------- scenarios */
  function scenarios(st) {
    var base = run(st, {});
    var cons = run(st, { vol: 0.70, A: { price_index: 0.98, fx_drift: 0.45, vc_mult: 1.30,
      opex_mult: 1.10, capex_mult: 1.20, phase2_month: 9, phase3_month: 22,
      tests_per_patient: 1.35, pass_through: 0.75 } });
    var opt = run(st, { vol: 1.25, A: { fx_drift: 0.12, tests_per_patient: 1.75,
      price_index: 0.95, capex_mult: 0.95 } });
    return [
      { key: "cons", name: "Conservative", res: cons, m: metrics(cons) },
      { key: "base", name: "Base case", res: base, m: metrics(base) },
      { key: "opt", name: "Optimistic", res: opt, m: metrics(opt) }
    ];
  }

  /* ----------------------------------------------------------------- queue */
  function queue(ordersDay, techs, minutes, st, hours) {
    hours = hours || 8;
    var eff = st.A.tech_eff;
    var lam = ordersDay / hours, mu = 60 * eff / minutes, c = techs;
    var a = lam / mu, rho = a / c;
    if (rho >= 1) return { rho: rho, p_wait: 1, wq: null };
    var s = 0, f = 1;
    for (var k = 0; k <= c; k++) {
      if (k > 0) f *= k;
      s += Math.pow(a, k) / f;
    }
    f *= c;
    var last = Math.pow(a, c) / f * (c / (c - a));
    var pw = last / (s + last);
    return { rho: rho, p_wait: pw, wq: pw / (c * mu - lam) * 60 };
  }

  /* ================================================================ QUANT
   * Deterministic Monte Carlo, variance attribution, price ladder and the FX
   * ladder. These mirror model.py 1:1 — the parity test compares every one of
   * them, so a change here must be made there too.
   * ==================================================================== */
  var DIST = {
    vol_sigma: 0.22,
    fx_drift_mean: 0.18, fx_drift_sigma: 0.12, fx_drift_floor: -0.05,
    price_sigma: 0.07, vc_sigma: 0.10, opex_sigma: 0.07,
    tpp_sigma: 0.12, pass_sigma: 0.08,
    seed: 20261125, draws: 2000
  };
  var FX_DRIFTS = [0.0, 0.10, 0.18, 0.30, 0.45, 0.60, 0.80];

  /* 64-bit LCG in BigInt so the sequence is bit-identical to model.py's
   * integer generator — the Monte Carlo in the browser and in the report must
   * draw the same numbers, otherwise the parity test is meaningless. */
  var LCG_MUL = 6364136223846793005n, LCG_ADD = 1442695040888963407n, MASK64 = (1n << 64n) - 1n;
  function Lcg(seed) { this.s = (BigInt(seed) & MASK64); }
  Lcg.prototype.next = function () {
    this.s = (this.s * LCG_MUL + LCG_ADD) & MASK64;
    return Number((this.s >> 11n) & ((1n << 53n) - 1n)) / 9007199254740992;
  };
  function makeRng(seed) { var r = new Lcg(seed); return function () { return r.next(); }; }
  function normPair(u) {
    return Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
  }

  function mcDraws(n, dist, baseP) {
    var d = Object.assign({}, DIST, dist || {});
    n = n || d.draws;
    var u = makeRng(d.seed), p0 = baseP || A, out = [];
    for (var i = 0; i < n; i++) {
      var vol = Math.exp(d.vol_sigma * normPair(u));
      out.push({
        vol: Math.round(Math.min(2.5, Math.max(0.15, vol)) * 1e4) / 1e4,
        fx_drift: Math.round(Math.max(d.fx_drift_floor,
          d.fx_drift_mean + d.fx_drift_sigma * normPair(u)) * 1e4) / 1e4,
        price_index: Math.round(Math.max(0.50, p0.price_index + d.price_sigma * normPair(u)) * 1e4) / 1e4,
        vc_mult: Math.round(Math.max(0.60, p0.vc_mult + d.vc_sigma * normPair(u)) * 1e4) / 1e4,
        opex_mult: Math.round(Math.max(0.70, p0.opex_mult + d.opex_sigma * normPair(u)) * 1e4) / 1e4,
        tests_per_patient: Math.round(Math.max(1.05, p0.tests_per_patient + d.tpp_sigma * normPair(u)) * 1e4) / 1e4,
        pass_through: Math.round(Math.min(1.0, Math.max(0.30, p0.pass_through + d.pass_sigma * normPair(u))) * 1e4) / 1e4
      });
    }
    return out;
  }

  function drawOverrides(dr) {
    return { fx_drift: dr.fx_drift, price_index: dr.price_index, vc_mult: dr.vc_mult,
             opex_mult: dr.opex_mult, tests_per_patient: dr.tests_per_patient,
             pass_through: dr.pass_through };
  }

  /* Run the whole model per draw. Callers pass an already-built state. */
  function mcRun(st, n, dist) {
    var draws = mcDraws(n, dist, st.A);
    var out = [];
    for (var i = 0; i < draws.length; i++) {
      var st2 = Object.assign({}, st, { A: Object.assign({}, st.A, drawOverrides(draws[i])) });
      var m = metrics(run(st2, { vol: draws[i].vol }));
      out.push({ dr: draws[i], npv: m.npv22, pb: m.payback_months, be: m.be_orders_day,
                 fund: m.funding_need, m12eb: m.m12_ebitda, m36cum: m.m36_cum,
                 margin: m.m12_margin });
    }
    return out;
  }

  function quantile(arr, p) {
    if (!arr.length) return null;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var i = Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))));
    return a[i];
  }

  /* Summarise an already-computed set of draws (the dashboard runs them in
   * chunks so the page stays responsive; the maths is still this one function). */
  function mcSummaryFrom(res) {
    var npv = res.map(function (r) { return r.npv; });
    var pb = res.filter(function (r) { return r.pb !== null; }).map(function (r) { return r.pb; });
    var be = res.filter(function (r) { return r.be !== null; }).map(function (r) { return r.be; });
    var len = res.length;
    return {
      n: len,
      npv_p10: quantile(npv, .10), npv_p50: quantile(npv, .50), npv_p90: quantile(npv, .90),
      npv_mean: Math.round(npv.reduce(function (a, b) { return a + b; }, 0) / len),
      p_npv_neg: Math.round(npv.filter(function (v) { return v < 0; }).length / len * 1000) / 1000,
      p_npv_50k: Math.round(npv.filter(function (v) { return v > 50000; }).length / len * 1000) / 1000,
      pb_p10: quantile(pb, .10), pb_p50: quantile(pb, .50), pb_p90: quantile(pb, .90),
      p_never_payback: Math.round((len - pb.length) / len * 1000) / 1000,
      be_p10: quantile(be, .10), be_p50: quantile(be, .50), be_p90: quantile(be, .90),
      fund_p90: quantile(res.map(function (r) { return r.fund; }), .90),
      margin_p50: quantile(res.map(function (r) { return r.margin; }), .50)
    };
  }

  function mcSummary(st, n, dist) { return mcSummaryFrom(mcRun(st, n, dist)); }

  /* rank correlation of each driver with NPV */
  function rankCorr(rows, keys) {
    function ranks(arr) {
      var order = arr.map(function (v, i) { return i; })
        .sort(function (a, b) { return arr[a] - arr[b]; });
      var rk = new Array(arr.length);
      order.forEach(function (idx, pos) { rk[idx] = pos; });
      return rk;
    }
    var rn = ranks(rows.map(function (r) { return r.npv; }));
    var my = (rn.length - 1) / 2;
    var dmy = rn.reduce(function (a, b) { return a + (b - my) * (b - my); }, 0);
    var out = (keys || ["vol", "fx_drift", "price_index", "vc_mult", "opex_mult",
                        "tests_per_patient", "pass_through"]).map(function (key) {
      var rx = ranks(rows.map(function (r) { return r.dr[key]; }));
      var mx = (rx.length - 1) / 2;
      var num = 0, dx = 0;
      for (var i = 0; i < rx.length; i++) {
        num += (rx[i] - mx) * (rn[i] - my);
        dx += (rx[i] - mx) * (rx[i] - mx);
      }
      var den = Math.sqrt(dx * dmy);
      return { key: key, rho: den ? Math.round(num / den * 1000) / 1000 : 0 };
    });
    out.sort(function (a, b) { return Math.abs(b.rho) - Math.abs(a.rho); });
    return out;
  }

  function mcSpearman(st, n, dist) {
    return rankCorr(mcRun(st, n, dist));
  }

  function mcSpearmanOld(st, n, dist) {
    var draws = mcDraws(n, dist, st.A);
    function ranks(arr) {
      var order = arr.map(function (v, i) { return i; })
        .sort(function (a, b) { return arr[a] - arr[b]; });
      var rk = new Array(arr.length);
      order.forEach(function (idx, pos) { rk[idx] = pos; });
      return rk;
    }
    var npvs = draws.map(function (dr) {
      var st2 = Object.assign({}, st, { A: Object.assign({}, st.A, drawOverrides(dr)) });
      return metrics(run(st2, { vol: dr.vol })).npv22;
    });
    var rn = ranks(npvs), my = (rn.length - 1) / 2;
    var dmy = rn.reduce(function (a, b) { return a + (b - my) * (b - my); }, 0);
    var keys = ["vol", "fx_drift", "price_index", "vc_mult", "opex_mult",
                "tests_per_patient", "pass_through"];
    var out = keys.map(function (key) {
      var rx = ranks(draws.map(function (d) { return d[key]; }));
      var mx = (rx.length - 1) / 2;
      var num = 0, dx = 0;
      for (var i = 0; i < rx.length; i++) {
        num += (rx[i] - mx) * (rn[i] - my);
        dx += (rx[i] - mx) * (rx[i] - mx);
      }
      var den = Math.sqrt(dx * dmy);
      return { key: key, rho: den ? Math.round(num / den * 1000) / 1000 : 0 };
    });
    out.sort(function (a, b) { return Math.abs(b.rho) - Math.abs(a.rho); });
    return out;
  }

  /* Price ladder: the average USD price that covers fixed cost, wages and
   * service at a given daily volume. */
  function pricingGrid(st) {
    var base = run(st, {});
    var m = metrics(base);
    var p = st.A;
    var leak = p.revenue_leakage + p.referred_share * p.referral_pct;
    var tpp = testsPerPatient(11, p);
    var service = base.capex.hardware * p.service_contract_pct / 12;
    return [20, 30, 40, 50, 60, 80, 100, 120, 150].map(function (od) {
      var pts = od / tpp;
      var lab = labourCost(od, pts, st);
      var fixedAll = st.fixed_opex.reduce(function (s, o) { return s + o.usd; }, 0) * p.opex_mult
        + lab.cost + service;
      var priceNet = fixedAll / (od * p.days) + m.avg_vc_usd;
      var need = priceNet / (1 - leak);
      return { orders_day: od, price_needed: Math.round(need * 100) / 100,
               fixed: Math.round(fixedAll),
               margin_at_base: Math.round((m.avg_price_usd / need - 1) * 1000) / 1000 };
    });
  }

  function fxLadder(st) {
    return FX_DRIFTS.map(function (drift) {
      var st1 = Object.assign({}, st, { A: Object.assign({}, st.A, { fx_drift: drift }) });
      var m1 = metrics(run(st1, {}));
      var st2 = Object.assign({}, st, { A: Object.assign({}, st.A,
        { fx_drift: drift, pass_through: 0.55, pass_lag_months: 3 }) });
      var m2 = metrics(run(st2, {}));
      return { drift: drift, npv: m1.npv22, be: m1.be_orders_day, margin: m1.m12_margin,
               pb: m1.payback_months, fx: m1.m12_fx, m12: m1.m12_ebitda,
               sticky_npv: m2.npv22, sticky_margin: m2.m12_margin,
               sticky_m12: m2.m12_ebitda };
    });
  }

  function repricing(st) {
    return [0, 1, 2, 3, 6].map(function (lag) {
      var s2 = Object.assign({}, st, { A: Object.assign({}, st.A, { pass_lag_months: lag }) });
      var m = metrics(run(s2, {}));
      return { lag: lag, npv22: m.npv22, pb: m.payback_months, m12_ebitda: m.m12_ebitda,
               m12_price_sdg: m.avg_price_sdg };
    });
  }

  var API = {
    A: A, MENU: MENU, CAPEX_P1: CAPEX_P1, CAPEX_P2: CAPEX_P2, CAPEX_P3: CAPEX_P3,
    LEAN_BOM: LEAN_BOM, LEAN_PCT: LEAN_PCT, PRESETS: PRESETS,
    FIXED_OPEX: FIXED_OPEX, RAMP: RAMP, SEASON: SEASON, SEASONAL: SEASONAL, LAB: LAB,
    DIST: DIST, FX_DRIFTS: FX_DRIFTS,
    makeState: makeState, clone: clone, capex: capex, run: run, metrics: metrics,
    scenarios: scenarios, queue: queue, minutesPerOrder: minutesPerOrder,
    staffing: staffing, testsPerPatient: testsPerPatient,
    mcDraws: mcDraws, mcRun: mcRun, mcSummary: mcSummary, mcSummaryFrom: mcSummaryFrom,
    mcSpearman: mcSpearman, rankCorr: rankCorr,
    pricingGrid: pricingGrid, fxLadder: fxLadder, repricing: repricing, quantile: quantile
  };

  if (typeof module === "object" && module.exports) module.exports = API;
  root.LabModel = API;
})(typeof window !== "undefined" ? window : globalThis);
