# Financial Advisers

**Every person who has ever advised Australians on money — who they worked for, who owned that firm, and where they went when the banks walked away.**

🔗 **Live:** [https://au-advisers.benrichardson.dev](https://au-advisers.benrichardson.dev)

## What is this?

ASIC is required by law to keep a public register of everyone authorised to give
personal financial advice to retail clients in Australia. It publishes that
register — 89,060 appointment rows covering 42,305 people at 4,077 licensees —
but it publishes it as a **snapshot**, and the snapshot hides its own history.

Every row carries the corporate ownership chain controlling that adviser's
licensee **as it stands today**, with cease dates buried inside free text like
`AMP LIMITED [Date Ceased: 13/12/2024]`. That chain is stamped onto every one of
the adviser's historical rows, including appointments that ended a decade before
the parent in question ever acquired the firm. A decade of industry
restructuring is sitting in the file, and it is invisible unless you parse it.

This site parses it. It reconstructs each adviser's whole career as a dated
timeline tinted by who owned their employer *at the time*, replays 89,060 date
ranges to draw the banks' retreat from advice as it actually happened, and turns
consecutive appointments into a directed movement graph of 41,991 transitions so
you can ask where a dissolved firm's people went.

The headline that falls out is not one anybody publishes: **the banks left, but
their advisers didn't.** Only 289 of Australia's 15,101 current advisers still
sit under a live CBA, NAB, Westpac, ANZ or AMP ownership chain — but 6,537 of
them, **43.3% of the entire profession**, spent part of their career inside a
bank or AMP advice business that no longer exists.

## Who is this for?

- **Anyone about to hand money to a financial adviser.** "Check my financial
  adviser" is a standing, high-intent search, and ASIC's own lookup answers it
  poorly — it shows a current appointment and little else. Here you get one
  person, one page, their whole career, every firm, every ownership chain, and
  any disciplinary action ASIC has recorded against them.
- **Compliance officers** vetting a hire, who otherwise have no way to see a
  candidate's full appointment history, CPD failures and ASIC actions together.
- **The trade press**, who write the adviser-headcount story every quarter.
- **Licensee M&A analysts and recruiters** tracking where a dissolved firm's
  advisers landed.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| [ASIC Financial Advisers Register](https://data.gov.au/data/dataset/asic-financial-adviser-dataset) (CC BY 3.0 AU) | Every person ever on the register, their licensees, ownership chains, appointment dates, authorisations, qualifications, CPD failures and ASIC disciplinary actions | Monthly |
| ABS ASGS 2021 postal areas (CC BY 4.0) | 2,644 postcode boundaries for the density map | Static (2021) |
| ABS 2021 Census, G01 by POA (CC BY 4.0) | Postcode population, the per-capita denominator | Static (2021) |

### What this site deliberately does NOT use

**ASIC's Banned & Disqualified Persons register is not joined to named
advisers.** It carries no adviser number, so the only possible join key is a
person's *name* — and one name collision would publish, next to a real named
individual, a banning that belongs to somebody else. That is a defamation risk
created out of nothing, because the Financial Advisers Register **already
carries ASIC's own disciplinary linkage** in `ADV_DA_TYPE` (859 records: 710 AFS
bannings, 103 enforceable undertakings, 27 FSCP actions, 15 disqualified
persons, 3 credit bannings, 1 SMSF auditor disqualification). Using ASIC's own
linkage is both safer and more accurate.

## Features

- **Find an adviser** — search all 42,305 people by name or adviser number,
  including the 27,204 no longer registered, with a click-to-filter
  career-length histogram.
- **Adviser dossier** — a career ribbon with one lane per appointment on a
  shared time axis, tinted by who owned that licensee at the time; concurrent
  authorisations get their own lane rather than being merged.
- **The bank retreat, dated** — a streamgraph of headcount by ultimate owner,
  with a naive/dated toggle that renders the site's correctness guard as a
  feature.
- **Movement network** — a settled directed graph with an explicit "left the
  register" sink, so the picture can never imply everyone landed somewhere.
- **Ownership chains** — an icicle with depth on the x axis, so chain *length*
  is legible; ceased links greyed with their date.
- **Cohort survival** — Kaplan-Meier-style small multiples, right-censored.
- **Diaspora** — pick any dead licensee and follow its people via a Sankey.
- **Conduct** — ASIC's own actions, with a denominator-visible scatter instead
  of a league table.
- **Authorisations** — a seriated binary matrix of what advice is still offered.
- **Where** — a real ABS postcode choropleth, per-capita, current advisers only.

## Tech Stack

- **Runtime:** Vanilla TypeScript — no framework
- **Build:** Vite 6 · **Testing:** Vitest (212 tests)
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline, monthly, matching ASIC's publication cadence
- **Only shipped dependency:** Leaflet 1.9.4, for the map. Every chart is
  hand-rolled SVG.

## Local Development

```bash
npm install       # install dependencies
npm run data      # refresh public/data from ASIC + ABS (runs every gate)
npm run dev       # start dev server
npm test          # run the test suite
npm run build     # production build
npm run preview   # preview the production build
```

## How it works

`pipeline/collect.mjs` resolves ASIC's monthly CSV through the data.gov.au CKAN
API (the filename changes every month; the resource id does not), validates it
**by content** rather than by filename, and hands it to `pipeline/parse.mjs`.
Everything that thinks lives in `parse.mjs`, with no Node-only imports, so the
test suite exercises the exact code the pipeline runs. Output is written as
compact JSON to `public/data/`, with the 21 MB of per-adviser career detail
sharded into 83 lazily-fetched files so opening one person's record does not
cost every visitor the whole register.

### The eight gates

The pipeline refuses to write data if any gate fails, and **every gate has a
test proving it fails on the exact fault it claims to catch.** A gate that has
only ever been seen passing is decoration.

1. **row-conservation** — every source row is accepted or lands in a named
   rejection bucket.
2. **status-coherence** — `Current` ⟺ blank end date, asserted not assumed.
3. **dating-rule** *(load-bearing)* — see below.
4. **movement-conservation** — transitions and exit edges reconcile with the
   emitted edge weights.
5. **geography-scope** — postcode coverage really is near-total on current rows
   and partial on ceased ones, which is what forces the map to be current-only.
6. **survivorship** — see below.
7. **census-anchor** — the postcode populations sum to within 0.1% of ABS's
   published national count (observed: 25,422,756 against 25,422,788).
8. **boundary-coverage** — real ABS geometry, and any postcode without a
   boundary must also have no census population.

### Two findings that were wrong before they were right

**The dating rule.** Counting an owner's advisers naively — any mention of that
owner anywhere in today's chain — gives 15,949 bank and AMP alumni. Intersecting
each appointment's dates against the cease dates gives 15,419. The difference is
**530 advisers who were never there.** Crucially the correction is *not
uniform*: it removes 337 from CBA, 382 from ANZ, 179 from AMP, and **nothing at
all** from NAB or Westpac. A check written only against NAB or Westpac passes on
an implementation with the date logic deleted entirely — so the gate asserts a
strict gap on the three groups where the fault can appear and exact equality on
the two where it cannot, and a test demonstrates the broken build slipping past
the NAB/Westpac check.

**The survivorship bias.** The first version of the cohort view charted intakes
back to 1995 and reported that 98.8% of the 1995–2012 intakes were still
registered five years later. That number was pure artefact. ASIC's register
commenced in 2015 and does not contain the people who had already left before it
existed — of 42,305 advisers, exactly **12** have a last appointment ending
before 2015, against 27,192 after. Every pre-2015 "cohort" is therefore only the
part of that intake which survived to 2015, and its measured survival is ~100%
by construction. Cohorts now start at 2015, keyed on the first *observed
appointment* rather than the self-reported first-advice year, and the
`survivorship` gate fails in both directions if that ever changes.

## Licence

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
Data sources keep theirs, and their attribution requirements are listed in the
site's own About panel and footer.
