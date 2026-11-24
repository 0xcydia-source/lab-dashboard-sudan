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
    ["cbc", "صورة دم كاملة CBC (3-part)", 4.42, 1.20, 5.0, 0.24, 1, "3 كواشف + QC يومي"],
    ["chem", "كيمياء – فحص مفرد (يوريا/كرياتينين/حمض بوليك/سكر)", 3.13, 0.45, 4.0, 0.24, 1, "كواشف سائلة، معايرة أسبوعية"],
    ["panel", "باقة كيمياء (10–12 محللاً)", 15.46, 2.60, 16.0, 0.07, 1, "أعلى سعر لكل دقيقة فني"],
    ["hb", "هيموغلوبين Hb", 1.47, 0.12, 1.5, 0.04, 1, "Drabkin"],
    ["esr", "سرعة الترسيب ESR", 2.94, 0.20, 5.0, 0.04, 1, "Westergren يدوي"],
    ["malaria", "شريط/فيلم الملاريا", 2.94, 0.75, 8.0, 0.08, 1, "موسمي"],
    ["urine", "بول عام U.G (شريط + مجهر)", 2.94, 0.45, 6.0, 0.06, 1, "شريط 10 بارامتر"],
    ["stool", "براز عام", 2.94, 0.30, 7.0, 0.02, 1, ""],
    ["serology", "سيرولوجي (Widal/ASO/RF/CRP/VDRL)", 2.76, 0.55, 6.0, 0.07, 1, "لاتكس/تترا"],
    ["ict", "اختبار سريع ICT (تيفوئيد/H.pylori/فيروسات كبد/HCG/Dengue)", 4.05, 1.25, 3.0, 0.09, 1, "الكاسيت أغلى بند بالدولار"],
    ["semen", "تحليل منوي", 5.52, 0.25, 12.0, 0.01, 1, ""],
    ["hba1c", "HbA1c", 4.42, 1.60, 4.0, 0.04, 2, "كواشف مستوردة"],
    ["electro", "كهارل Na/K/Cl (ISE)", 6.62, 1.35, 3.0, 0.05, 2, "خراطيش ISE"],
    ["coag", "تخثر PT/INR", 5.52, 2.00, 4.0, 0.03, 2, ""],
    ["hormone", "هرمونات CLIA (TSH/FT4/β-hCG)", 9.2, 4.50, 6.0, 0.02, 3, "أغلى كواشف"],
    ["elisa", "ELISA (تأكيد/فيروسات كبد)", 8.1, 2.50, 16.0, 0.01, 2, "صفيحة 96 عيناً"]
  ];

  var CAPEX_P1 = [
    ["جهاز CBC 3-part ماركة Mindray (BC-21s، جديد، ضمان 6 أشهر)", 1, 2900, "own"],
    ["جهاز كيمياء نصف آلي (ELHODA 880 / HC-80+)", 1, 1250, "own"],
    ["سنترفيوج 6 عين", 1, 65, "own"],
    ["ميكروسكوب ثنائي العينية LED 107 + عدسة 100x", 1, 210, "own"],
    ["حامل سرعة الترسيب ESR + مؤقت", 1, 70, "est"],
    ["حمام مائي رقمي", 1, 120, "est"],
    ["خلاط Vortex", 1, 35, "est"],
    ["دوار Rotator لاختبارات اللاتكس", 1, 45, "est"],
    ["ميزان تحليلي 0.001g", 1, 180, "est"],
    ["ثلاجة كواشف 350 لتر بباب زجاجي", 1, 600, "est"],
    ["مقطر ماء 4 لتر/ساعة", 1, 220, "est"],
    ["3 ماصات دقيقة + حامل + رؤوس", 1, 240, "est"],
    ["UPS أونلاين 2kVA", 1, 250, "est"],
    ["منظم جهد AVR 5kVA", 1, 120, "est"],
    ["مولد 6–7 kVA", 1, 900, "est"],
    ["كمبيوتر + طابعة ليزر + LIS", 1, 700, "est"],
    ["تكييف سبليت 1.5 حصان × 2", 1, 1000, "est"],
    ["أثاث وتجهيز 60–80 م²", 1, 1200, "est"],
    ["لافتة + تراخيص + رسوم + استشارة قانونية", 1, 600, "est"],
    ["سلامة وأمن حيوي", 1, 350, "est"]
  ];

  var CAPEX_P2 = [
    ["جهاز كهارل Na/K/Cl (ISE)", 1600],
    ["جهاز HbA1c", 1300],
    ["جهاز تخثر قناتين (PT/INR/APTT)", 1900],
    ["ELISA Reader + Washer", 2400],
    ["مخزون كواشف للقسم الثاني", 900]
  ];

  var CAPEX_P3 = [
    ["جهاز هرمونات CLIA نصف آلي", 3600],
    ["حاضنة + أوتوكلاف", 1600]
  ];

  var FIXED_OPEX = [
    ["إيجار 60–80 م² في أركوت", 500],
    ["أجر المالك/المدير (إدارة + مراجعة QC)", 350],
    ["موظف استقبال", 100],
    ["عامل نظافة (جزئي)", 55],
    ["كهرباء الشبكة", 90],
    ["وقود المولد", 140],
    ["مياه", 30],
    ["إنترنت وهاتف", 40],
    ["صيانة وقطع غيار", 130],
    ["تسويق (لوحات، مندوب عيادات، سوشيال)", 150],
    ["مستهلكات غير كواشف (قفازات/أنابيب/إبر/شرائح)", 190],
    ["مواد ضبط الجودة QC ومعايرة", 90],
    ["تخلص من النفايات الطبية", 45],
    ["برنامج LIS + نسخ احتياطي", 35],
    ["مصاريف إدارية متفرقة", 70]
  ];

  var STOCK_OPENING = 2300;
  var CONTINGENCY = 0.08;
  var FREIGHT = 0.12;
  var INSTALL = 0.03;
  var PHLEB_PATIENTS_PER = 55;


  /* Lean preset: a small lab that really opens for about 5,000 USD turnkey.
   * Same engine, shorter BOM, lower logistics percentages. */
  var LEAN_BOM = [
    ["CBC 3-part (PH-70 أو DH33)", 1, 1180, "est"],
    ["جهاز كيمياء نصف آلي (HC-80+ / 888)", 1, 780, "est"],
    ["سنترفيوج 6 عين", 1, 50, "est"],
    ["ميكروسكوب ثنائي العينية LED", 1, 150, "est"],
    ["حامل ESR + مؤقت", 1, 50, "est"],
    ["خلاط Vortex", 1, 28, "est"],
    ["3 ماصات + حوامل + رؤوس", 1, 160, "est"],
    ["ثلاجة كواشف 200 لتر", 1, 185, "est"],
    ["UPS 1kVA", 1, 100, "est"],
    ["منظم جهد AVR 5kVA", 1, 55, "est"],
    ["مولد 3kVA", 1, 260, "est"],
    ["كمبيوتر + طابعة + LIS بسيط", 1, 310, "est"],
    ["أثاث وتجهيز أساسي (40–60 م²)", 1, 330, "est"],
    ["تراخيص ولافتة", 1, 350, "est"],
    ["سلامة وأمن حيوي", 1, 100, "est"]
  ];
  var LEAN_PCT = { freight: 0.05, install: 0.02, stock: 400, contingency: 0.04 };

  var PRESETS = {
    full: { label: "خطة كاملة", note: "CBC Mindray + ثلاجة 350 لتر + مولد 6–7kVA + مخزون أكبر" },
    lean: { label: "معمل صغير (~5,000$)", note: "حد أدنى قابل للتشغيل: جهازان + أساسيات + رخصة" }
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
      var rEff = fxAt(Math.max(t - p.pass_lag_months, 0)) / p.fx_sdg - 1;
      var priceF = (1 + p.pass_through * rEff) * Math.pow(1 - p.price_erosion, t / 12);
      var erosionF = Math.pow(1 - p.price_erosion, t / 12);
      var fxNow = fxAt(t);

      var revSdg = 0, varc = 0, per = {};
      keys.forEach(function (k) {
        var mult = SEASONAL.indexOf(k.key) >= 0 ? season : 1;
        var n = d.orders * (k.share / tot) * (1 + (mult - 1) * 0.35);
        // USD-priced menu: no FX pass-through (USD is the anchor), only erosion
        var pUsd = k.price_usd * p.price_index * erosionF;
        var vc = k.vc * p.vc_mult * (1 + p.import_premium);
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
      capex_total: Math.round(capexTotal),
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
      { key: "cons", name: "متحفظ", res: cons, m: metrics(cons) },
      { key: "base", name: "أساسي", res: base, m: metrics(base) },
      { key: "opt", name: "طموح", res: opt, m: metrics(opt) }
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

  var API = {
    A: A, MENU: MENU, CAPEX_P1: CAPEX_P1, CAPEX_P2: CAPEX_P2, CAPEX_P3: CAPEX_P3,
    LEAN_BOM: LEAN_BOM, LEAN_PCT: LEAN_PCT, PRESETS: PRESETS,
    FIXED_OPEX: FIXED_OPEX, RAMP: RAMP, SEASON: SEASON, SEASONAL: SEASONAL, LAB: LAB,
    makeState: makeState, clone: clone, capex: capex, run: run, metrics: metrics,
    scenarios: scenarios, queue: queue, minutesPerOrder: minutesPerOrder,
    staffing: staffing, testsPerPatient: testsPerPatient
  };

  if (typeof module === "object" && module.exports) module.exports = API;
  root.LabModel = API;
})(typeof window !== "undefined" ? window : globalThis);
