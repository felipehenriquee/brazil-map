# brazil-svg-map

Interactive SVG map of **Brazil** for React: the 5 regions, the 27 states and all **5,571 municipalities** (IBGE 2025). Municipalities are split per state and loaded on demand, so a map of states weighs ~120 KB and opening one state adds only that state's data — drawn at the state's own scale, so borders stay detailed when the map zooms in.

```bash
npm install brazil-svg-map
```

```tsx
import { BrazilMap } from "brazil-svg-map";
import "brazil-svg-map/styles.css";

<BrazilMap tooltip onClick={(area) => console.log(area.id)} />;          // 27 states
<BrazilMap level="region" tooltip />;                                     // 5 regions
<BrazilMap level="municipality" states={["CE"]} tooltip />;               // Ceará's 184 municipalities
<BrazilMap level="municipality" regions={["south"]} borders="state" />;   // a region, with state lines on top
```

## Levels, filters and borders

| Prop | Values | |
|---|---|---|
| `level` | `"region"` \| `"state"` (default) \| `"municipality"` | What each shape is |
| `regions` | `RegionKey[]` | Only these regions: `north`, `northeast`, `southeast`, `south`, `centralWest` |
| `states` | `StateCode[]` | Only these states (`"CE"`, `"SP"`…); takes precedence over `regions` |
| `areaFilter` | `(area) => boolean` | Finer filter on the areas of the current level (e.g. municipalities of one intermediate region); rejected areas are muted like those outside the filter and the view zooms to the rest. Keep it memoized |
| `context` | `"show"` (default) \| `"hide"` | Areas outside the filter: muted for context, or not drawn |
| `zoomToFilter` | `boolean` (default `true`) | Fit the view to the filtered area |
| `zoomDuration` | `number` (default `600`) | Duration in ms of the animated zoom when the view changes; `0` jumps. Skipped with `prefers-reduced-motion` |
| `borders` | `"none"` \| `"state"` \| `"region"` | Lines on top; default `"state"` at municipality level |
| `showOutline` | `boolean` (default `true`) | Country outline |

States and regions are real dissolved shapes (not municipalities with hidden strokes), so there are no seams, and at state level only 27 paths are drawn.

## Level of detail

Shapes come in two levels, drawn with the same projection:

| | Simplified at | Used for | Size |
|---|---|---|---|
| `"overview"` | country scale | the whole country | ~120 KB for regions/states; 6–240 KB of municipalities per state |
| `"detail"` | each state's own scale | zoomed into states | 5–20 KB state outline; 15–470 KB of municipalities per state (Ceará: ~180 KB, ~11k points) |

`detail="auto"` (default) uses `"detail"` whenever `regions`/`states` zoom the map in, and `"overview"` for the whole country; pass `"overview"` or `"detail"` to force one. In detail mode the overview shapes are drawn underneath in the context color, so the seam between a detailed state and its (overview) neighbors never shows the background.

## Areas and callbacks

Every callback receives a `MapArea`:

```ts
type MapArea =
  | { level: "region"; id: RegionKey; name: string; region: Region }
  | { level: "state"; id: StateCode; name: string; state: State }
  | { level: "municipality"; id: string /* IBGE code */; name: string; municipality: Municipality };
```

| Prop | |
|---|---|
| `getFill(area)` / `fills` / `defaultFill` | Fill colors (`fills` is a serializable `{ id: color }` object) |
| `getClassName(area)` | Extra class per area |
| `highlighted` | An `id` highlighted from outside (e.g. hovering a list) |
| `getHref(area)` | Areas become links |
| `onClick(area, event)` | Click, and Enter/Space on the keyboard |
| `onHover(area \| null, event)` | Mouse entered / left an area |
| `loadingFallback` | Shown over the map while municipalities load |
| `title` | Accessible label (default "Mapa do Brasil") |

```tsx
// drill down: region → its states → a state's municipalities
<BrazilMap
  level={level}
  regions={region ? [region] : undefined}
  states={state ? [state] : undefined}
  getFill={(a) => regionColor(a.level === "region" ? a.id : a.level === "state" ? a.state.region : findState(a.municipality.uf)!.region)}
  onClick={(a) => (a.level === "region" ? showRegion(a.id) : a.level === "state" ? showState(a.id) : select(a.municipality))}
/>
```

## Tooltip

Same API as [ceara-map](https://github.com/felipehenriquee/ceara-mapa):

```tsx
<BrazilMap tooltip />                                              {/* name only */}
<BrazilMap tooltip={{ content: (a) => ({ image, title, subtitle }), width: 260, placement: "anchored", delay: 150, touch: "first-tap" }} />
<BrazilMap renderTooltip={(a) => <MyCard area={a} />} />
```

`touch: "first-tap"` shows the tooltip on the first tap and clicks on the second. With `onClick` or `getHref`, areas are in the Tab order; keyboard focus shows the tooltip.

## Data

From `brazil-svg-map/data` (no `"use client"`, safe in Server Components) or the main entry:

| Export | |
|---|---|
| `REGIONS`, `STATES`, `STATES_BY_NAME` | Regions and states with name, IBGE code, bounding box and path |
| `findState(uf)`, `findRegion(key)`, `statesInRegion(key)`, `stateOfIbgeCode(code)` | Lookups |
| `loadMunicipalities(uf, detail?)`, `loadAllMunicipalities(ufs?, detail?)`, `findMunicipalityByIbgeCode(code)` | Municipalities, loaded on demand and cached (`detail`: `"overview"` or `"detail"`) |
| `loadStateOutline(uf)` | A state's outline at its own scale |
| `useMunicipalities(ufs \| null)` | The same as a React hook: `{ municipalities, loading, error }` |
| `regionColor(key)` | `"var(--bm-region-<key>)"` |
| `VIEW_BOX`, `COUNTRY_OUTLINE`, `STATE_BORDERS`, `REGION_BORDERS` | Raw layers, to draw your own SVG |
| `normalize`, `toSlug` | Accent-insensitive search helpers |

```ts
type Municipality = {
  ibgeCode: number; slug: string; name: string; uf: StateCode;
  intermediateRegion: string | null; immediateRegion: string | null; areaKm2: number | null;
  water?: true; // Lagoa Mirim and Lagoa dos Patos, drawn as water, not as municipalities
  bbox: [number, number, number, number]; d: string;
};
```

The package is ESM only (code splitting needs it). In bundlers, each state's municipalities become a separate chunk.

## Styles

Import `brazil-svg-map/styles.css` and override the variables:

```css
:root {
  --bm-area-fill: #cbd5e1;
  --bm-area-highlight: #0f172a;
  --bm-context-fill: #e8edf3;
  --bm-border-state: #fff;
  --bm-border-region: #475569;
  --bm-region-northeast: #f97316;   /* and the other --bm-region-* */
  --bm-tooltip-background: #fff;
}
```

Lines keep their pixel width when the view zooms in (`vector-effect: non-scaling-stroke`). When zooming into tall states, cap the height yourself, e.g. `.bm-svg { max-height: 75vh }`.

Classes: `.bm-map` (with `data-level`), `.bm-svg`, `.bm-area` (`[data-highlighted]`), `.bm-context`, `.bm-water`, `.bm-borders-state`, `.bm-borders-region`, `.bm-outline`, `.bm-tooltip` (`[data-visible]`).

## Data source

Municipal mesh **IBGE Malha Municipal Digital 2025**, simplified and dissolved into states and regions by `scripts/build-data.mjs`. IBGE asks users of the mesh to read its methodological note: <https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html>.

## License

Code: [MIT](LICENSE) © 2019-2026 Felipe Henrique Morais Araujo.
