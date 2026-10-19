import { DETAIL_LOADERS, OUTLINE_LOADERS, OVERVIEW_LOADERS } from "./generated/loaders";
import meta from "./generated/meta.json";
import type { StateCode } from "./generated/types";

export type { StateCode };

export type RegionKey = "north" | "northeast" | "southeast" | "south" | "centralWest";

/** [minX, minY, maxX, maxY] in map (viewBox) units */
export type BBox = [number, number, number, number];

export type Region = {
  key: RegionKey;
  /** IBGE region code, 1–5 */
  code: number;
  /** official Portuguese name, for display: "Nordeste" */
  name: string;
  bbox: BBox;
  /** SVG path data of the whole region */
  d: string;
};

export type State = {
  /** two-letter code: "CE" */
  uf: StateCode;
  /** IBGE state code: 23 */
  code: number;
  name: string;
  region: RegionKey;
  bbox: BBox;
  d: string;
};

export type Municipality = {
  /** 7-digit IBGE code: 2304400 (Fortaleza) */
  ibgeCode: number;
  /** unique within the state: "juazeiro-do-norte" */
  slug: string;
  name: string;
  uf: StateCode;
  /** IBGE intermediate geographic region (2017 division) */
  intermediateRegion: string | null;
  /** IBGE immediate geographic region (2017 division) */
  immediateRegion: string | null;
  areaKm2: number | null;
  /** water bodies in the IBGE mesh (Lagoa Mirim, Lagoa dos Patos) — not municipalities */
  water?: true;
  bbox: BBox;
  d: string;
};

export const VIEW_BOX: string = meta.viewBox;
export const MAP_WIDTH: number = meta.width;
export const MAP_HEIGHT: number = meta.height;
/** outline of the whole country */
export const COUNTRY_OUTLINE: string = meta.outline;
/** lines between states only (no coastline) */
export const STATE_BORDERS: string = meta.stateBorders;
/** lines between regions only (no coastline) */
export const REGION_BORDERS: string = meta.regionBorders;

export const REGIONS = meta.regions as Region[];
export const STATES = meta.states as State[];
export const STATES_BY_NAME = [...STATES].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

const STATE_BY_UF = new Map(STATES.map((s) => [s.uf, s]));
const REGION_BY_KEY = new Map(REGIONS.map((r) => [r.key, r]));

export function findState(uf: string): State | undefined {
  return STATE_BY_UF.get(uf.toUpperCase() as StateCode);
}

export function findRegion(key: RegionKey): Region | undefined {
  return REGION_BY_KEY.get(key);
}

export function statesInRegion(region: RegionKey): State[] {
  return STATES.filter((s) => s.region === region);
}

/** The state of a municipality, from the first two digits of its IBGE code. */
export function stateOfIbgeCode(code: number | string): State | undefined {
  const prefix = Number(String(code).slice(0, 2));
  return STATES.find((s) => s.code === prefix);
}

/** Region color as a CSS variable (defined in styles.css), e.g. "var(--bm-region-northeast)". */
export function regionColor(region: RegionKey) {
  return `var(--bm-region-${region})`;
}

/**
 * Level of detail of the shapes:
 * - "overview": simplified at country scale (light; looks right when the whole country is shown)
 * - "detail": each state simplified at its own scale (for when the map zooms into states)
 */
export type Detail = "overview" | "detail";

const cache = new Map<string, Promise<unknown>>();

// each state and level is a separate chunk; results are cached and a failed load is retried
function cached<T>(key: string, load: () => Promise<{ default: unknown }>): Promise<T> {
  let promise = cache.get(key) as Promise<T> | undefined;
  if (!promise) {
    promise = load().then((module) => module.default as T);
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return promise;
}

function loaderFor<T>(loaders: Record<StateCode, () => Promise<{ default: unknown }>>, uf: StateCode, key: string) {
  const loader = loaders[uf];
  return loader ? cached<T>(key, loader) : Promise.reject(new Error(`Unknown state: ${uf}`));
}

/**
 * Municipalities of one state, loaded on demand: "overview" (default; up to ~240 KB, Minas Gerais)
 * or "detail" (up to ~470 KB) — see `Detail`.
 */
export function loadMunicipalities(uf: StateCode, detail: Detail = "overview"): Promise<Municipality[]> {
  return loaderFor<Municipality[]>(detail === "detail" ? DETAIL_LOADERS : OVERVIEW_LOADERS, uf, `${detail}:${uf}`);
}

/** A state's outline at its own scale (5–20 KB), for drawing it zoomed in. */
export async function loadStateOutline(uf: StateCode): Promise<string> {
  return (await loaderFor<{ d: string }>(OUTLINE_LOADERS, uf, `outline:${uf}`)).d;
}

/** Municipalities of several states (all 27 when omitted — ~1.7 MB in overview detail). */
export async function loadAllMunicipalities(ufs: StateCode[] = STATES.map((s) => s.uf), detail: Detail = "overview") {
  return (await Promise.all(ufs.map((uf) => loadMunicipalities(uf, detail)))).flat();
}

/** Looks a municipality up by IBGE code, loading only its state. */
export async function findMunicipalityByIbgeCode(code: number | string) {
  const state = stateOfIbgeCode(code);
  if (!state) return undefined;
  return (await loadMunicipalities(state.uf)).find((m) => m.ibgeCode === Number(code));
}

/** Strips accents and case, for searching: normalize("Crateús") === "crateus". */
export function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Same format as the municipality slugs. */
export function toSlug(text: string) {
  return normalize(text).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
