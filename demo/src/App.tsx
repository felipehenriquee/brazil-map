import { useMemo, useState } from "react";
import {
  BrazilMap,
  REGIONS,
  STATES,
  STATES_BY_NAME,
  findRegion,
  findState,
  regionColor,
  useMunicipalities,
  type MapArea,
  type MapLevel,
  type Municipality,
  type RegionKey,
  type StateCode,
} from "brazil-svg-map";

type ColorMode = "region" | "single";
type Borders = "none" | "state" | "region";

const LEVELS: { value: MapLevel; label: string }[] = [
  { value: "region", label: "Regiões" },
  { value: "state", label: "Estados" },
  { value: "municipality", label: "Municípios" },
];

// one color per state: hues spread by the golden angle so states with nearby codes (usually
// neighbors) get distant hues
const STATE_COLORS = new Map(STATES.map((s, i) => [s.uf, `hsl(${Math.round((i * 137.508) % 360)} 65% 55%)`]));

// intermediate regions of the chosen state (Minas Gerais has the most: 13)
const SUBREGION_COLORS = [
  "#3b82f6", "#14b8a6", "#8b5cf6", "#84cc16", "#ec4899", "#f97316", "#eab308",
  "#6366f1", "#ef4444", "#06b6d4", "#10b981", "#d946ef", "#f59e0b",
];

function formatArea(km2: number | null) {
  return km2 === null ? "—" : `${km2.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km²`;
}

export default function App() {
  const [level, setLevel] = useState<MapLevel>("state");
  const [region, setRegion] = useState<RegionKey | null>(null);
  const [state, setState] = useState<StateCode | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("region");
  const [borders, setBorders] = useState<Borders>("state");
  const [showContext, setShowContext] = useState(true);
  const [selected, setSelected] = useState<Municipality | null>(null);
  const [subregions, setSubregions] = useState<string[]>([]);

  const regionName = region ? findRegion(region)?.name : null;
  const stateInfo = state ? findState(state) : null;

  // the chosen state's intermediate regions, from its municipalities (cached, so the map shares the load)
  const { municipalities: stateMunicipalities } = useMunicipalities(state ? [state] : null);
  const subregionColors = useMemo(() => {
    const names = [...new Set(stateMunicipalities.map((m) => m.intermediateRegion).filter((n): n is string => Boolean(n)))];
    names.sort((a, b) => a.localeCompare(b, "pt-BR"));
    return new Map(names.map((name, i) => [name, SUBREGION_COLORS[i % SUBREGION_COLORS.length]]));
  }, [stateMunicipalities]);

  const areaFilter = useMemo(() => {
    if (subregions.length === 0) return undefined;
    return (area: MapArea) => area.level === "municipality" && subregions.includes(area.municipality.intermediateRegion ?? "");
  }, [subregions]);

  function toggleSubregion(name: string) {
    setSubregions((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]));
    setLevel("municipality");
    setSelected(null);
  }

  function chooseRegion(key: RegionKey | null) {
    setRegion(key);
    setState(null);
    setSubregions([]);
    setSelected(null);
  }

  function chooseState(uf: StateCode | null) {
    setState(uf);
    if (uf) setRegion(findState(uf)!.region);
    setSubregions([]);
    setSelected(null);
  }

  // clicking drills down: region → its states → a state's municipalities
  function handleClick(area: MapArea) {
    if (area.level === "region") {
      chooseRegion(area.id);
      setLevel("state");
    } else if (area.level === "state") {
      chooseState(area.id);
      setLevel("municipality");
    } else {
      setSelected(area.municipality);
    }
  }

  function getFill(area: MapArea) {
    if (colorMode === "single") return undefined;
    if (area.level === "region") return regionColor(area.id);
    if (area.level === "state") return STATE_COLORS.get(area.state.uf);
    const m = area.municipality;
    return (state && m.intermediateRegion && subregionColors.get(m.intermediateRegion)) || STATE_COLORS.get(m.uf);
  }

  function tooltipSubtitle(area: MapArea) {
    if (area.level === "region") return "Clique para ver os estados";
    if (area.level === "state") return `${area.state.uf} · ${findRegion(area.state.region)?.name} · clique para ver os municípios`;
    const m = area.municipality;
    return `${m.uf}${m.intermediateRegion ? ` · região de ${m.intermediateRegion}` : ""}`;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Mapa do Brasil</h1>
        <p>
          Regiões, estados e os 5.571 municípios do IBGE (2025) com a biblioteca <code>brazil-svg-map</code>.
        </p>
      </header>

      <nav className="breadcrumb" aria-label="Navegação">
        <button type="button" onClick={() => chooseRegion(null)} disabled={!region && !state}>
          Brasil
        </button>
        {regionName && (
          <>
            <span aria-hidden="true">›</span>
            <button type="button" onClick={() => chooseRegion(region)} disabled={!state}>
              {regionName}
            </button>
          </>
        )}
        {stateInfo && (
          <>
            <span aria-hidden="true">›</span>
            <span className="breadcrumb-current">{stateInfo.name}</span>
          </>
        )}
      </nav>

      <div className="layout">
        <aside className="controls">
          <fieldset className="control">
            <legend>Nível</legend>
            <div className="segmented">
              {LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  aria-pressed={level === l.value}
                  onClick={() => {
                    setLevel(l.value);
                    setSelected(null);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
            {level === "municipality" && !state && !region && (
              <small>Sem filtro, carrega os municípios do país inteiro (~1,7 MB).</small>
            )}
          </fieldset>

          <label className="control">
            <span>Região</span>
            <select value={region ?? ""} onChange={(e) => chooseRegion((e.target.value || null) as RegionKey | null)}>
              <option value="">Todas</option>
              {REGIONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="control">
            <span>Estado</span>
            <select value={state ?? ""} onChange={(e) => chooseState((e.target.value || null) as StateCode | null)}>
              <option value="">Todos{regionName ? ` do ${regionName}` : ""}</option>
              {STATES_BY_NAME.filter((s) => !region || s.region === region).map((s) => (
                <option key={s.uf} value={s.uf}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="control">
            <legend>Cores</legend>
            <div className="segmented">
              <button type="button" aria-pressed={colorMode === "region"} onClick={() => setColorMode("region")}>
                {level === "region" || (level === "municipality" && state) ? "Por região" : "Por estado"}
              </button>
              <button type="button" aria-pressed={colorMode === "single"} onClick={() => setColorMode("single")}>
                Única
              </button>
            </div>
          </fieldset>

          <label className="control">
            <span>Linhas por cima</span>
            <select value={borders} onChange={(e) => setBorders(e.target.value as Borders)}>
              <option value="none">Nenhuma</option>
              <option value="state">Divisas entre estados</option>
              <option value="region">Divisas entre regiões</option>
            </select>
          </label>

          <label className="check">
            <input type="checkbox" checked={showContext} onChange={(e) => setShowContext(e.target.checked)} />
            Mostrar o resto do país ao filtrar
          </label>
        </aside>

        <main className="map-card">
          {state && subregionColors.size > 0 && (
            <section className="subregions" aria-label="Filtrar por região">
              <h2>Filtrar por região</h2>
              <div className="chips">
                {[...subregionColors].map(([name, color]) => (
                  <button
                    key={name}
                    type="button"
                    className="chip"
                    aria-pressed={subregions.includes(name)}
                    onClick={() => toggleSubregion(name)}
                  >
                    <span className="chip-dot" style={{ backgroundColor: color }} aria-hidden="true" />
                    {name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <BrazilMap
            level={level}
            regions={region ? [region] : undefined}
            states={state ? [state] : undefined}
            areaFilter={level === "municipality" ? areaFilter : undefined}
            context={showContext ? "show" : "hide"}
            borders={borders}
            getFill={getFill}
            highlighted={selected ? String(selected.ibgeCode) : null}
            onClick={handleClick}
            tooltip={{ content: (area) => ({ subtitle: tooltipSubtitle(area) }), touch: "first-tap" }}
            loadingFallback={<span className="loading">Carregando municípios…</span>}
          />

          {selected && (
            <section className="details">
              <div className="details-header">
                <h2>
                  {selected.name} <span>{selected.uf}</span>
                </h2>
                <button type="button" onClick={() => setSelected(null)}>
                  Fechar
                </button>
              </div>
              <dl>
                <div>
                  <dt>Código IBGE</dt>
                  <dd>{selected.ibgeCode}</dd>
                </div>
                <div>
                  <dt>Área</dt>
                  <dd>{formatArea(selected.areaKm2)}</dd>
                </div>
                <div>
                  <dt>Região intermediária</dt>
                  <dd>{selected.intermediateRegion ?? "—"}</dd>
                </div>
                <div>
                  <dt>Região imediata</dt>
                  <dd>{selected.immediateRegion ?? "—"}</dd>
                </div>
              </dl>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
