// Builds the library data from the IBGE municipal mesh (Malha Municipal Digital).
//
//   npm run data -- ~/Downloads/BR_Municipios_2025.zip
//
// Only the maintainer runs this, when IBGE publishes a new mesh; the generated files are
// committed and shipped, so users of the library never need the mesh.
//
// Two levels of detail, both drawn with the same projection so they line up:
//   overview — the whole country simplified at country scale: regions, states, border lines and
//              coarse municipalities (used when the map shows the whole country)
//   detail   — each state simplified at its own scale (used when the map zooms into states)
//
// Output (src/generated/):
//   meta.json                          regions, states, border lines, country outline (overview)
//   municipalities/overview/<UF>.json  coarse municipalities of each state
//   municipalities/detail/<UF>.json    municipalities at the state's scale
//   outlines/<UF>.json                 the state's outline at its own scale (small; used to draw a
//                                      zoomed-in state, and over detailed municipalities)
//   loaders.ts, types.ts
//
// Requires `unzip` for .zip input and a few GB of memory (the national .shp is ~320 MB).

import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { geoArea, geoCentroid, geoPath, geoTransverseMercator } from "d3-geo";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src", "generated");

const WIDTH = 900;
const PADDING = 8;
// simplification tolerance = width of the area / DETAIL; at the size a state is shown when the
// map zooms into it, this keeps the error under one pixel
const DETAIL = 1000;
const OVERVIEW_DIGITS = 1;
const DETAIL_DIGITS = 2;

const REGIONS = {
  1: { key: "north", name: "Norte" },
  2: { key: "northeast", name: "Nordeste" },
  3: { key: "southeast", name: "Sudeste" },
  4: { key: "south", name: "Sul" },
  5: { key: "centralWest", name: "Centro-Oeste" },
};

// "Área Operacional" codes (Lagoa Mirim, Lagoa dos Patos): water bodies, not municipalities
const isWater = (code) => String(code).slice(2, 6) === "0000";

const input = process.argv[2] ?? process.env.IBGE_MESH;
if (!input) {
  console.error("Usage: npm run data -- <path to BR_Municipios_YYYY.zip or .shp>");
  process.exit(1);
}

// mapshaper may be hoisted to the workspace root
const MAPSHAPER = await Promise.any(
  [join(ROOT, "node_modules", ".bin", "mapshaper"), join(ROOT, "..", "..", "node_modules", ".bin", "mapshaper")].map(
    async (bin) => (await access(bin), bin),
  ),
);

async function mapshaper(args) {
  await run(MAPSHAPER, args, {
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=6000" },
  });
}

/** [west, south, east, north] from the .shp header, without reading the geometry. */
async function shapefileBounds(path) {
  const file = await open(path);
  const header = Buffer.alloc(100);
  await file.read(header, 0, 100, 0);
  await file.close();
  return [36, 44, 52, 60].map((offset) => header.readDoubleLE(offset));
}

/** Simplification tolerance in meters for an area: its east-west width / DETAIL. */
async function tolerance(shp) {
  const [west, south, east, north] = await shapefileBounds(shp);
  const latitude = ((south + north) / 2) * (Math.PI / 180);
  return Math.round(((east - west) * 111_320 * Math.cos(latitude)) / DETAIL);
}

function toSlug(text) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * d3-geo needs exterior rings clockwise; a polygon wound the other way covers the whole globe
 * minus itself, so it is detected by its area and its rings are reversed.
 */
function rewind(geometry) {
  const fix = (rings) =>
    geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings;
  if (geometry?.type === "Polygon") return { ...geometry, coordinates: fix(geometry.coordinates) };
  if (geometry?.type === "MultiPolygon") return { ...geometry, coordinates: geometry.coordinates.map(fix) };
  return geometry;
}

async function readFeatures(path) {
  const collection = JSON.parse(await readFile(path, "utf8"));
  return collection.features.map((f) => ({ ...f, geometry: rewind(f.geometry) }));
}

const temp = await mkdtemp(join(tmpdir(), "brazil-svg-map-"));
const file = (name) => join(temp, `${name}.json`);
// layers without attributes (country, border lines) would otherwise come out as GeometryCollection
const geojson = (name, precision) => ["-o", file(name), "format=geojson", "geojson-type=FeatureCollection", `precision=${precision}`];

try {
  // ---- 1. the national shapefile ----
  let shp = input;
  if (input.toLowerCase().endsWith(".zip")) {
    console.log(`unzipping ${basename(input)}…`);
    await run("unzip", ["-q", "-o", input, "-d", join(temp, "source")]);
    const name = (await readdir(join(temp, "source"))).find((f) => f.toLowerCase().endsWith(".shp"));
    if (!name) throw new Error("no .shp inside the zip");
    shp = join(temp, "source", name);
  }

  // ---- 2. overview: simplified at country scale, then dissolved from the same arcs ----
  const countryTolerance = await tolerance(shp);
  console.log(`overview, tolerance ${countryTolerance} m…`);
  await mapshaper([
    "-i", shp, "encoding=utf8", "name=municipalities",
    "-simplify", `interval=${countryTolerance}`, "keep-shapes",
    ...geojson("overview", 0.00001),
    "-dissolve", "SIGLA_UF", "copy-fields=CD_UF,NM_UF,CD_REGIAO", "+", "name=states",
    ...geojson("states", 0.00001),
    "-innerlines", "+", "name=state-borders",
    ...geojson("state-borders", 0.00001),
    "-target", "municipalities",
    "-dissolve", "CD_REGIAO", "+", "name=regions",
    ...geojson("regions", 0.00001),
    "-innerlines", "+", "name=region-borders",
    ...geojson("region-borders", 0.00001),
    "-target", "municipalities",
    "-dissolve", "+", "name=country",
    ...geojson("country", 0.00001),
  ]);

  // ---- 3. detail: each state on its own, simplified at its own scale ----
  console.log("splitting by state…");
  const split = join(temp, "split");
  await mkdir(split);
  await mapshaper(["-i", shp, "encoding=utf8", "-split", "SIGLA_UF", "-o", `${split}/`, "format=shapefile"]);
  const ufs = (await readdir(split))
    .filter((f) => f.endsWith(".shp"))
    .map((f) => f.slice(0, -4))
    .sort();

  const tolerances = {};
  const queue = [...ufs];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let uf = queue.shift(); uf; uf = queue.shift()) {
        tolerances[uf] = await tolerance(join(split, `${uf}.shp`));
        await mapshaper([
          "-i", join(split, `${uf}.shp`), "encoding=utf8", "name=municipalities",
          "-simplify", `interval=${tolerances[uf]}`, "keep-shapes",
          ...geojson(`detail-${uf}`, 0.000001),
          "-dissolve", "+", "name=outline",
          ...geojson(`outline-${uf}`, 0.000001),
        ]);
      }
    }),
  );
  console.log(`detail tolerances (m): ${ufs.map((uf) => `${uf} ${tolerances[uf]}`).join(", ")}`);

  // ---- 4. one projection for everything, fitted to the country ----
  const country = { type: "FeatureCollection", features: await readFeatures(file("country")) };
  const [lon, lat] = geoCentroid(country);
  const projection = geoTransverseMercator().rotate([-lon, -lat]).fitWidth(WIDTH - PADDING * 2, country);
  const [[x0, y0], [, y1]] = geoPath(projection).bounds(country);
  const [tx, ty] = projection.translate();
  projection.translate([tx + PADDING - x0, ty + PADDING - y0]);
  const height = Math.ceil(y1 - y0 + PADDING * 2);

  const overviewPath = geoPath(projection).digits(OVERVIEW_DIGITS);
  const detailPath = geoPath(projection).digits(DETAIL_DIGITS);
  const bbox = (path, feature) =>
    path
      .bounds(feature)
      .flat()
      .map((n) => Math.round(n * 10) / 10);
  const paths = (path, features) => features.map((f) => path(f) ?? "").join("");

  // ---- 5. meta: regions, states, border lines ----
  const states = (await readFeatures(file("states")))
    .map((f) => ({
      uf: f.properties.SIGLA_UF,
      code: Number(f.properties.CD_UF),
      name: f.properties.NM_UF,
      region: REGIONS[f.properties.CD_REGIAO].key,
      bbox: bbox(overviewPath, f),
      d: overviewPath(f),
    }))
    .sort((a, b) => a.code - b.code);

  const regions = (await readFeatures(file("regions")))
    .map((f) => ({
      key: REGIONS[f.properties.CD_REGIAO].key,
      code: Number(f.properties.CD_REGIAO),
      name: REGIONS[f.properties.CD_REGIAO].name,
      bbox: bbox(overviewPath, f),
      d: overviewPath(f),
    }))
    .sort((a, b) => a.code - b.code);

  const meta = {
    viewBox: `0 0 ${WIDTH} ${height}`,
    width: WIDTH,
    height,
    outline: paths(overviewPath, country.features),
    regions,
    states,
    stateBorders: paths(overviewPath, await readFeatures(file("state-borders"))),
    regionBorders: paths(overviewPath, await readFeatures(file("region-borders"))),
  };

  // ---- 6. municipalities, overview and detail ----
  const toMunicipality = (path) => (f) => {
    const p = f.properties;
    return {
      ibgeCode: Number(p.CD_MUN),
      slug: toSlug(p.NM_MUN),
      name: p.NM_MUN,
      uf: p.SIGLA_UF,
      intermediateRegion: p.NM_RGINT || null,
      immediateRegion: p.NM_RGI || null,
      areaKm2: typeof p.AREA_KM2 === "number" ? p.AREA_KM2 : null,
      ...(isWater(p.CD_MUN) ? { water: true } : {}),
      bbox: bbox(path, f),
      d: path(f),
    };
  };
  const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, "municipalities", "overview"), { recursive: true });
  await mkdir(join(OUT, "municipalities", "detail"), { recursive: true });
  await mkdir(join(OUT, "outlines"), { recursive: true });
  await writeFile(join(OUT, "meta.json"), JSON.stringify(meta));

  const overview = (await readFeatures(file("overview"))).map(toMunicipality(overviewPath));
  const sizes = { overview: {}, detail: {}, outline: {} };
  for (const uf of ufs) {
    const coarse = overview.filter((m) => m.uf === uf).sort(byName);
    const fine = (await readFeatures(file(`detail-${uf}`))).map(toMunicipality(detailPath)).sort(byName);
    const outline = paths(detailPath, await readFeatures(file(`outline-${uf}`)));
    if (coarse.length !== fine.length) throw new Error(`${uf}: ${coarse.length} overview vs ${fine.length} detail municipalities`);
    if (new Set(fine.map((m) => m.slug)).size !== fine.length) throw new Error(`duplicate municipality slug in ${uf}`);

    const coarseJson = JSON.stringify(coarse);
    const fineJson = JSON.stringify(fine);
    const outlineJson = JSON.stringify({ d: outline });
    sizes.overview[uf] = coarseJson.length;
    sizes.detail[uf] = fineJson.length;
    sizes.outline[uf] = outlineJson.length;
    await writeFile(join(OUT, "municipalities", "overview", `${uf}.json`), coarseJson);
    await writeFile(join(OUT, "municipalities", "detail", `${uf}.json`), fineJson);
    await writeFile(join(OUT, "outlines", `${uf}.json`), outlineJson);
  }

  const loaderMap = (name, folder) => [
    `export const ${name}: Record<StateCode, () => Promise<{ default: unknown }>> = {`,
    ...states.map((s) => `  ${s.uf}: () => import("./${folder}/${s.uf}.json"),`),
    "};",
  ];
  await writeFile(
    join(OUT, "loaders.ts"),
    [
      "// Generated by scripts/build-data.mjs — do not edit.",
      "// One dynamic import per state and file, so bundlers emit a separate chunk for each.",
      "// The JSON types are wide (bbox as number[], uf as string); data.ts narrows them.",
      'import type { StateCode } from "./types";',
      "",
      ...loaderMap("OVERVIEW_LOADERS", "municipalities/overview"),
      "",
      ...loaderMap("DETAIL_LOADERS", "municipalities/detail"),
      "",
      ...loaderMap("OUTLINE_LOADERS", "outlines"),
      "",
    ].join("\n"),
  );
  await writeFile(
    join(OUT, "types.ts"),
    [
      "// Generated by scripts/build-data.mjs — do not edit.",
      `export type StateCode = ${states.map((s) => `"${s.uf}"`).join(" | ")};`,
      "",
    ].join("\n"),
  );

  const kb = (n) => `${Math.round(n / 1024)} KB`;
  const total = (s) => Object.values(s).reduce((a, b) => a + b, 0);
  const largest = (s) => Object.entries(s).sort(([, a], [, b]) => b - a)[0];
  console.log(`meta.json: ${kb(JSON.stringify(meta).length)} — ${regions.length} regions, ${states.length} states, ${meta.viewBox}`);
  console.log(`municipalities: ${overview.length} (${overview.filter((m) => m.water).length} water bodies)`);
  console.log(`overview: ${kb(total(sizes.overview))} total, largest ${largest(sizes.overview).join(" ").replace(/\d+$/, (n) => kb(+n))}`);
  console.log(
    `detail:   ${kb(total(sizes.detail))} total, largest ${largest(sizes.detail).join(" ").replace(/\d+$/, (n) => kb(+n))}, CE ${kb(sizes.detail.CE)}`,
  );
  console.log(`outlines: ${kb(total(sizes.outline))} total, largest ${largest(sizes.outline).join(" ").replace(/\d+$/, (n) => kb(+n))}, CE ${kb(sizes.outline.CE)}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
