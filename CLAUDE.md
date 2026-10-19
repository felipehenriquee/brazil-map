# CLAUDE.md

Monorepo: `packages/brazil-svg-map` (React map library of Brazil: regions, states, 5,571 municipalities) + `demo/` (Vite app). See README.md.

## Conventions

- Code, comments, commit messages and docs in **English**; UI text in **Portuguese (pt-BR)**.
- Never add a `Co-Authored-By: Claude` trailer (or any Claude attribution) to commits or PRs.
- Node **18.20** on this machine: keep Vite 6, Vitest 3, tsup 8.
- npm name `brazil-map` is taken; the package is `brazil-svg-map` (checked free on 2026-10-19).

## Data pipeline

- Input: the IBGE national shapefile zip (`~/Downloads/BR_Municipios_2025.zip`, 237 MB; not in the repo). `npm run data -- <zip>` runs `scripts/build-data.mjs` (mapshaper + d3-geo, ~20 s) → `src/generated/`: meta.json (overview regions/states/borders), municipalities/overview/<UF>.json, municipalities/detail/<UF>.json, outlines/<UF>.json, loaders.ts, types.ts. Generated files are committed.
- Two levels of detail, one projection (transverse Mercator fitted to the country, 900 wide): overview simplified at country scale; detail simplified per state with tolerance = state width / 1000 (Ceará ≈ 460 m → ~11k points). mapshaper dissolves/innerlines from the same simplified arcs, so shapes within one level always share borders.
- In detail mode `BrazilMap` draws the overview shapes of the filtered states underneath in the context color (`.bm-underlay`) to hide slivers against overview neighbors, and the detailed outlines on top; the overview country outline is skipped.
- Tests check areas: each dissolved state/region equals the sum of its parts, detailed outline equals the sum of detailed municipalities, overview state is within 3% of it.
- Water bodies (codes `43000x`: Lagoa Mirim, Lagoa dos Patos) are flagged `water: true`, drawn but not interactive.

## Library notes

- ESM only, `splitting: true`, so each state's JSON becomes its own chunk; `"use client"` is prepended to `dist/index.js` only (`data` entry stays server-safe).
- `BrazilMap` delegates mouse/click/keyboard/focus events from the `<svg>`; `AreaShape` is memoized so hovering re-renders two areas, not thousands.
- Focus only opens the tooltip for keyboard focus (`:focus-visible`): a tap focuses the area right before its click, which would otherwise break `touch: "first-tap"`. The same fix was applied to `../mapa-ceara/packages/ceara-map`.

## Checks

```bash
npm run typecheck && npm test && npm run build
```

UI was verified with /usr/bin/google-chrome + puppeteer-core (installed outside the repo) against `vite preview` of the demo: drill-down, per-state chunk loading, 5,571 areas hover (~20 ms/frame), keyboard, touch first-tap, mobile dark.

## Open items

- Repository: github.com/felipehenriquee/brazil-map (whole monorepo). Package not published to npm yet.
