# Laboratory Feasibility Dashboard

A static site (HTML/CSS/JS, no libraries, no server) for planning a small medical laboratory.

| Page | What it is |
|---|---|
| `index.html` | **Interactive dashboard** - edit test prices, equipment, reagent costs and FX; every metric and chart updates instantly |
| `study.html` | The original 32-page feasibility report (Arabic, print-ready) |
| `out/*.pdf` | PDF version of the report |
| `out/*.xlsx` | Editable Excel model |

## What you can edit

- **Test menu** - name, price (USD), reagent cost, order share, technologist minutes, add/delete rows
- **Equipment & set-up** - 20 phase-1 lines plus phase 2 and 3, all editable, add/delete
- **Monthly costs** - 15 fixed lines, add/delete; wages are separate
- **Assumptions** - FX rate, volume, pass-through, tax, service contract, freight, contingency
- **Feasibility study** - free-text title, location, owner, summary, strengths, weaknesses, recommendations

The report tab rebuilds itself from your numbers and prints to PDF.

## Pricing model

The menu is priced in **USD** (what the patient pays). The **SDG** list price is derived:
`price_usd x price_index x fx(t)`. A weaker pound therefore raises the local price list
instead of silently eating the margin.

Exchange rates used: **1 USD = 12,000 SDG** (Sudan) and **54 EGP** (Egypt - a different
currency, used only for Egyptian supplier quotes).

## Privacy

No server, no analytics. Data lives in `localStorage`. Export/import JSON to move scenarios.

## Structure

```
index.html        dashboard
study.html        original report
assets/engine.js  financial model (mirrors model.py in the parent folder)
assets/app.js     UI, SVG charts, persistence
assets/app.css    styles (LTR, mobile-first)
assets/img/       report figures
```

## Rebuild

```bash
cd ..                 # labsudan-ops
./build.sh            # Word + PDF + Excel + charts
python3 export_html.py
```

## Note on the numbers

Anything marked *estimate* in the model should be replaced by a written supplier quote
before any money is committed.
