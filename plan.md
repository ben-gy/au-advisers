# Site Plan: Financial Advisers

## Overview
- **Name:** Financial Advisers
- **Repo name:** au-advisers
- **Tagline:** Every person who has ever advised Australians on money — who they worked for, who owned that firm, and where they went when the banks walked away.

### Naming Convention
Plain topic name, no country code. The `country: "AU"` field in `index/sites.json` renders the flag.

## Target Audience
Four groups, in order of volume:

1. **Someone about to hand money to a financial adviser.** "Check my financial adviser" is a
   standing, high-intent Google query. ASIC's own Moneysmart lookup answers it badly: it shows the
   adviser's *current* appointment and little else, with no history, no ownership context and no way
   to see the firm they came from. This site is the landing page for that query.
2. **Compliance officers vetting a hire**, who currently have no way to see a candidate's full
   appointment history, CPD failures and any ASIC disciplinary action on one page.
3. **The trade press** (Professional Planner, ifa, Money Management), who write the
   adviser-headcount story every quarter off a paid consultancy's number.
4. **Licensee M&A analysts and recruiters** tracking where a dissolved firm's advisers landed.

Mostly desktop for groups 2–4, but group 1 arrives on a phone from a search result and needs one
name, one page, one answer.

## Value Proposition
ASIC publishes the register but not the *history*. Every row carries the ownership chain that
controls the licensee **as it stands today**, with `[Date Ceased: dd/mm/yyyy]` markers buried in
free text — so the file silently contains a decade of industry restructuring that nobody can read
without parsing it. This site does three things no free tool does:

- reconstructs each adviser's **whole career** as a dated timeline, tinted by who owned their
  licensee *at the time*, not today;
- replays 89,060 appointment date-ranges to draw the **bank retreat as it actually happened**;
- turns consecutive appointments into a **directed movement graph** — 41,994 licensee-to-licensee
  transitions — so you can ask where a dissolved firm's people went.

## Data Sources
| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| ASIC Financial Advisers Register | `data.gov.au` CKAN pkg `f2b7c2c1-f4ef-4ae9-aba5-45c19e4d3038` → resource `91d80440-5787-46fc-99de-0c1d93e6cc9f` | 89,060 appointment rows × 76 cols; every person ever on the register, their licensees, ownership chains, dates, authorisations, qualifications, CPD failures and ASIC disciplinary actions | Monthly | No — CC BY 3.0 AU |
| ABS ASGS 2021 POA boundaries | `geo.abs.gov.au` ArcGIS `ASGS2021/POA/MapServer/0` | 2,644 postcode polygons for the density map | Static (2021 vintage) | No — CC BY 4.0 |
| ABS ERP by state | vendored static (factory pattern) | per-capita denominator | Annual | No — CC BY 4.0 |

### Deliberately NOT used, and why
**The ASIC Banned & Disqualified Persons register is not joined to named advisers.** It has no
adviser number — the only possible join key is a person's *name*, and a name collision would
publish, next to a real named individual, a banning that belongs to somebody else. That is a
defamation risk the site would be creating out of nothing, because the Financial Advisers Register
**already carries ASIC's own disciplinary linkage** in `ADV_DA_TYPE` / `ADV_DA_DESCRIPTION` (859
rows: 710 AFS bannings, 103 enforceable undertakings, 27 FSCP actions, 15 disqualified persons,
3 credit bannings, 1 SMSF auditor disqualification). Using ASIC's own linkage is both safer and
more accurate. This narrowing is stated in the About panel, the README and the build log — it is a
correctness decision, not a shortcut.

## Key Features
1. **Adviser lookup** — search 42,305 people by name or adviser number; stable URL per person.
2. **Career ribbon** — one lane per appointment on a shared time axis, tinted by the owner of that
   licensee *at that date*.
3. **Dated bank-retreat streamgraph** with a naive/dated toggle that makes the correctness guard a
   visible feature.
4. **Movement network** — settled directed graph of licensee-to-licensee transitions, with an
   explicit "left the register" sink so exits are never hidden.
5. **Ownership chain icicle** — depth on the x axis, ceased parents greyed with their cease date.
6. **Cohort survival curves** — how long each intake year lasted.
7. **Firm diaspora Sankey** — pick any dead licensee, see where its people scattered.
8. **Conduct board** — ASIC's own disciplinary actions and CPD failures, with a denominator-honest
   beeswarm that visually disqualifies small-sample outliers.
9. **Authorisation matrix** — seriated, showing which kinds of advice have disappeared.
10. **Density map** — real ABS POA choropleth, per-capita, current advisers only.

## Style Direction
**Tone:** professional / civic, leaning to the register's own seriousness. This page will be read by
somebody deciding whether to trust a named human being with their retirement savings, and by that
named human being.

**Colour palette:** light, cool, documentary. Paper white and slate-navy, with a restrained
five-colour categorical set reserved *exclusively* for the bank/AMP owner groups (CBA, NAB, Westpac,
ANZ, AMP) so an owner is always the same colour in the streamgraph, the ribbon, the icicle and the
network. Independent/other is a neutral grey-green. A single amber is reserved for conduct events
and is used nowhere else, so amber always means "ASIC took an action". No red-for-drama: a
disciplinary action is a fact, not an accusation from this site.

**UI density:** balanced. Dense where the audience is professional (matrix, network, table),
spacious on the adviser dossier, which is the page a nervous consumer lands on.

**Dark/light theme:** light. A dark monitoring console would misrepresent a monthly regulatory
register as a live feed, and is the wrong register for a page naming individuals.

**Reference sites for tone:** the UK FCA Financial Services Register (for the "one person, one
page" seriousness) and OpenCorporates (for making a public register legible without editorialising).

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite (no component tree deep enough to justify React)
- **Data strategy:** pipeline — **monthly cron**, matching ASIC's monthly republication of the file
- **Key libraries:** Leaflet (map) only. Every chart is hand-rolled SVG; treemap/force/zoom/tooltip
  come from `patterns/`.

## Layout
Sticky header with brand, word-only nav tabs and a `?` About button. Content is a centred
`max-width: 1680px` column. Drill-downs (adviser dossier, licensee, postcode) open in one shared
right-hand drawer, detached from the DOM when closed. Below 768px the nav scrolls horizontally, the
drawer becomes full-width, and every wide view (matrix, network, Sankey, table) scrolls locally
inside its own `overflow-x: auto` container.

## Pages/Views
Overview · Bank Retreat · Movements · Ownership · Cohorts · Diaspora · Conduct · Authorisations ·
Where · Explorer

## Visualization Strategy
The data is a **named-person longitudinal register that is natively a directed movement graph** —
the fleet's usual choropleth + ranked-bars + treemap stack would answer none of its real questions.
Forms are chosen per question:

- **Career ribbon** (per-person Gantt on a shared time axis) — the only form that shows one
  person's overlapping appointments *and* who owned each employer at the time.
- **Streamgraph** — composition-over-time of a total that itself changes; a stacked bar would hide
  that the independent band thickens as the bank bands collapse.
- **Directed force network** (settled before first paint, `patterns/network.ts`) — 18,443 weighted
  edges; the only form that shows the industry's whole rewiring at once.
- **Icicle / horizontal partition** — depth on x, so *chain length* is legible. A treemap of the
  same data hides depth entirely, which is the one thing the reader wants.
- **Kaplan-Meier step survival small multiples** — retention is a curve, not a bar; the 2019
  education-standards cliff shows up as a change in curve *shape*.
- **Sankey** — the single-firm dispersal question, without asking the reader to read a graph.
- **Beeswarm with a shaded low-n zone** — a ranked league table of "share of alumni later
  disciplined" is actively misleading at small denominators; the beeswarm makes the denominator
  visible and disqualifies the outliers on sight.
- **Seriated binary matrix** — authorisation flags are 0/1 across ~42 columns; ordering by
  similarity makes blocks emerge that alphabetical order destroys.
- **Choropleth (exactly one)** — real ABS POA polygons, per-capita, current advisers only.
- **Click-to-filter histogram** in the Explorer.

## Correctness gates (the site's spine)
1. **The dating gate.** `LICENCE_CONTROLLED_BY` is today's ownership chain stamped onto every
   historical row. An appointment only counts toward an owner if it started on or before that
   owner's `[Date Ceased]`. Naive = 15,949 alumni; dated = 15,419; **530 phantom advisers**.
   The gate must be *measured where the failure lives*: the rule is a **no-op on NAB (+0) and
   Westpac (+0)** and only bites on **CBA (+337), ANZ (+382) and AMP (+179)**. A test that checks
   Westpac passes on a completely broken implementation. This is the `au-bushfires` lesson and it
   ships as an explicit regression test.
2. **Row conservation.** Every one of the 89,060 source rows is either accepted into an appointment
   or lands in a named rejection bucket. Accepted + rejected must equal the source row count.
3. **Status coherence.** `ADV_ROLE_STATUS == 'Current'` ⟺ blank `ADV_END_DT` — asserted, not assumed.
4. **Movement conservation.** For every adviser, transitions = appointments − 1 when appointments
   are chained by start date; every terminal adviser is accounted for either as still-current or as
   an edge into the explicit exit sink.
5. **Geography honesty.** `ADV_ADD_STATE` is blank on 47,676 of 89,060 rows. The map is asserted to
   be built from current appointments only (15,502 of 15,532 carry a postcode), and the view says so.
