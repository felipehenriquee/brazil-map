# brazil-map

Monorepo of **brazil-svg-map**, an interactive SVG map of Brazil for React (regions, states and the 5,571 IBGE municipalities), and a demo site.

```
packages/brazil-svg-map/          → the library (see its README)
  scripts/build-data.mjs          → reads the IBGE shapefile, simplifies it at two levels of detail
                                    (country and per state), dissolves states/regions, border lines
  src/generated/                  → output of the script (committed, so the build doesn't need the source)
  src/BrazilMap.tsx, data.ts      → component and data API
demo/                             → Vite + React demo: levels, filters, drill-down, tooltip, details
```

## Running

Requires Node 18 or newer.

```bash
npm install
npm run dev        # builds the library and starts the demo at http://localhost:5173
npm run dev:lib    # (optional, another terminal) rebuilds the library on every change
npm test           # library tests
npm run data -- ~/Downloads/BR_Municipios_2025.zip   # regenerate src/generated/ (maintainers only)
npm run build      # library + demo
```

> Code, comments and docs are in English; the demo UI is in Portuguese.

## Updating the data

Only maintainers need this, when IBGE publishes a new mesh; users of the library get the generated data in the package.

1. Download the national municipal mesh (`BR_Municipios_YYYY.zip`, ~240 MB) from IBGE: <https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html>.
2. `npm run data -- path/to/BR_Municipios_YYYY.zip` (needs `unzip` and a few GB of RAM; takes ~20 s).
3. `npm test`, then publish a new version.

The mesh itself is not stored in the repository.

## License

[MIT](LICENSE) © 2019-2026 Felipe Henrique Morais Araujo.
