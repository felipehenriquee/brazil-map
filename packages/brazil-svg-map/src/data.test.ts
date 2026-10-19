import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrazilMap } from "./BrazilMap";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  REGIONS,
  STATE_BORDERS,
  STATES,
  VIEW_BOX,
  findMunicipalityByIbgeCode,
  findState,
  loadAllMunicipalities,
  loadMunicipalities,
  loadStateOutline,
  stateOfIbgeCode,
  statesInRegion,
} from "./data";

type Point = [number, number];

function rings(d: string): Point[][] {
  return (d.match(/M[^MZ]*Z/g) ?? []).map((part) =>
    (part.match(/-?[\d.]+,-?[\d.]+/g) ?? []).map((p) => p.split(",").map(Number) as Point),
  );
}

function ringArea(ring: Point[]) {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function inside([x, y]: Point, ring: Point[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Area with the even-odd rule: a ring inside an odd number of other rings is a hole. */
function evenOddArea(d: string) {
  const all = rings(d);
  return all.reduce((total, ring, i) => {
    // test the middle of an edge, so a vertex shared with the outer ring doesn't count as inside
    const [a, b] = [ring[0], ring[1]];
    const probe: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const depth = all.filter((other, j) => j !== i && inside(probe, other)).length;
    return total + (depth % 2 === 0 ? 1 : -1) * ringArea(ring);
  }, 0);
}

describe("country data", () => {
  it("has the 5 regions and the 27 states", () => {
    expect(REGIONS.map((r) => r.key)).toEqual(["north", "northeast", "southeast", "south", "centralWest"]);
    expect(STATES).toHaveLength(27);
    expect(statesInRegion("northeast").map((s) => s.uf)).toEqual(["MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE", "BA"]);
    expect(findState("ce")?.name).toBe("Ceará");
  });

  it("draws every state and region as closed rings inside the map", () => {
    for (const shape of [...STATES, ...REGIONS]) {
      expect(shape.d.startsWith("M") && shape.d.endsWith("Z")).toBe(true);
      const [x0, y0, x1, y1] = shape.bbox;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(MAP_WIDTH);
      expect(y1).toBeLessThanOrEqual(MAP_HEIGHT);
    }
    expect(STATE_BORDERS.length).toBeGreaterThan(1000);
  });
});

describe("municipalities", () => {
  it("loads one state on demand", async () => {
    const ceara = await loadMunicipalities("CE");
    expect(ceara).toHaveLength(184);
    expect(ceara.every((m) => m.uf === "CE")).toBe(true);
    expect(new Set(ceara.map((m) => m.slug)).size).toBe(184);
  });

  it("covers the whole country: 5,571 municipalities and 2 water bodies", async () => {
    const all = await loadAllMunicipalities();
    expect(all.filter((m) => !m.water)).toHaveLength(5571);
    expect(all.filter((m) => m.water).map((m) => m.name)).toEqual([
      'Área Operacional "Lagoa dos Patos"',
      'Área Operacional "Lagoa Mirim"',
    ]);
  });

  it("finds a municipality by IBGE code", async () => {
    expect(stateOfIbgeCode(2304400)?.uf).toBe("CE");
    expect((await findMunicipalityByIbgeCode("2304400"))?.name).toBe("Fortaleza");
    expect(await findMunicipalityByIbgeCode(9999999)).toBeUndefined();
  });

  it("dissolves each state without losing or adding area", async () => {
    for (const state of STATES) {
      const municipalities = await loadMunicipalities(state.uf);
      const sum = municipalities.reduce((total, m) => total + evenOddArea(m.d), 0);
      expect(Math.abs(evenOddArea(state.d) - sum) / sum, state.uf).toBeLessThan(0.001);
    }
  });

  it("dissolves each region into the sum of its states", () => {
    for (const region of REGIONS) {
      const sum = statesInRegion(region.key).reduce((total, s) => total + evenOddArea(s.d), 0);
      expect(Math.abs(evenOddArea(region.d) - sum) / sum, region.key).toBeLessThan(0.001);
    }
  });
});

describe("level of detail", () => {
  const points = (d: string) => (d.match(/-?[\d.]+,-?[\d.]+/g) ?? []).length;

  it("has the same municipalities in overview and detail", async () => {
    for (const state of STATES) {
      const [overview, detail] = await Promise.all([loadMunicipalities(state.uf), loadMunicipalities(state.uf, "detail")]);
      expect(detail.map((m) => m.ibgeCode), state.uf).toEqual(overview.map((m) => m.ibgeCode));
    }
  });

  it("draws a state with many more points when zoomed in", async () => {
    const overview = await loadMunicipalities("CE");
    const detail = await loadMunicipalities("CE", "detail");
    const count = (list: typeof overview) => list.reduce((total, m) => total + points(m.d), 0);
    expect(count(detail)).toBeGreaterThan(count(overview) * 4);
    expect(count(detail)).toBeGreaterThan(8000);
  });

  it("keeps detailed municipalities, detailed outline and overview shape in the same place", async () => {
    for (const state of STATES) {
      const municipalities = await loadMunicipalities(state.uf, "detail");
      const outline = await loadStateOutline(state.uf);
      const sum = municipalities.reduce((total, m) => total + evenOddArea(m.d), 0);
      // the outline is dissolved from the same detailed arcs: same area
      expect(Math.abs(evenOddArea(outline) - sum) / sum, state.uf).toBeLessThan(0.001);
      // simplified at another scale, the overview shape still covers about the same area
      expect(Math.abs(evenOddArea(state.d) - sum) / sum, state.uf).toBeLessThan(0.03);
    }
  });
});

describe("<BrazilMap>", () => {
  const render = (props: Parameters<typeof BrazilMap>[0]) => renderToString(createElement(BrazilMap, props));
  const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

  it("renders the 27 states by default and the 5 regions at region level", () => {
    expect(count(render({}), /data-area="/g)).toBe(27);
    expect(count(render({ level: "region" }), /data-area="/g)).toBe(5);
  });

  it("filters by region and zooms into it, keeping the rest as context", () => {
    const html = render({ regions: ["northeast"] });
    expect(count(html, /data-area="/g)).toBe(9);
    // the rest of the country is one silhouette, without the other states' lines
    expect(count(html, /class="bm-silhouette"/g)).toBe(1);
    expect(html).not.toContain("bm-context");
    expect(html).not.toContain(`viewBox="${VIEW_BOX}"`);
  });

  it("can show the other states with their borders instead of a silhouette", () => {
    const html = render({ regions: ["northeast"], context: "states" });
    expect(html).not.toContain("bm-silhouette");
    expect(count(html.split('class="bm-context"')[1].split("</g>")[0], /<path /g)).toBe(18);
  });

  it("clips border lines to the filtered states", () => {
    const html = render({ states: ["CE"], borders: "region" });
    expect(html).toMatch(/<clipPath id="bm-clip-[\w-]+"><path [^>]*><\/path><\/clipPath>/);
    expect(html).toMatch(/class="bm-borders bm-borders-region"[^>]*clip-path="url\(#bm-clip-/);
    expect(render({ borders: "region" })).not.toContain("clip-path");
  });

  it("hides the context when asked", () => {
    expect(render({ states: ["CE"], context: "hide" })).not.toContain("bm-context");
  });

  it("uses links, roles and colors from the props", () => {
    const html = render({
      states: ["CE", "PI"],
      getHref: (a) => `/estados/${a.id}`,
      fills: { CE: "red" },
    });
    expect(html).toContain('href="/estados/CE"');
    expect(html).toContain("fill:red");
  });
});
