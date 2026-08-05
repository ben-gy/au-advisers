# Third-party notices

The list below is derived from the **sourcemaps of the shipped bundle**
(`dist/**/*.js.map`), not from `npm ls` — the sourcemap records what actually
reaches a visitor's browser, which is the only thing that needs a notice here.
Exactly one third-party package ships.

No third-party fonts are used: the site uses the operating system's own font
stack, so nothing is downloaded and nothing needs a font licence.

---

## Leaflet 1.9.4

Interactive map rendering on the *Where the advisers are* view. Loaded from npm
and code-split into its own chunk, never from a CDN.

- Homepage: https://leafletjs.com/
- Licence: **BSD 2-Clause**

```
BSD 2-Clause License

Copyright (c) 2010-2023, Volodymyr Agafonkin
Copyright (c) 2010-2011, CloudMade
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## Map tiles (fetched at runtime, not bundled)

- Basemap tiles © [CARTO](https://carto.com/attributions) ("light_all" style).
- Underlying map data © OpenStreetMap contributors, licensed
  [ODbL](https://www.openstreetmap.org/copyright).

Both are credited in the map's own attribution control, as their terms require.

---

## Data sources

Data is **not** covered by this project's code licence and carries its own
attribution requirements, which are met in the site footer, the About panel and
the JSON-LD metadata:

- **ASIC Financial Advisers Register** — © Commonwealth of Australia
  (Australian Securities and Investments Commission), published via data.gov.au
  under [CC BY 3.0 AU](https://creativecommons.org/licenses/by/3.0/au/).
- **ABS ASGS 2021 postal areas** and **2021 Census** postcode population —
  © Commonwealth of Australia (Australian Bureau of Statistics), under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Neither publisher endorses this site or its analysis.

---

## Build-time only (not shipped to the browser)

TypeScript, Vite, Vitest, jsdom and `@types/*` are development dependencies. No
part of them reaches a visitor, so they are listed for completeness only.
