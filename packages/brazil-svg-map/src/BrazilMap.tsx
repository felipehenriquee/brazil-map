import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  COUNTRY_OUTLINE,
  REGION_BORDERS,
  REGIONS,
  STATE_BORDERS,
  STATES,
  VIEW_BOX,
  type BBox,
  type Detail,
  type Municipality,
  type Region,
  type RegionKey,
  type State,
  type StateCode,
} from "./data";
import { useMunicipalities, useStateOutlines } from "./useMunicipalities";

export type MapLevel = "region" | "state" | "municipality";

/** What the map draws and passes to every callback. `id` is the region key, the UF or the IBGE code. */
export type MapArea =
  | { level: "region"; id: RegionKey; name: string; region: Region }
  | { level: "state"; id: StateCode; name: string; state: State }
  | { level: "municipality"; id: string; name: string; municipality: Municipality };

export type TooltipContent = {
  image?: string | null;
  /** defaults to the area name */
  title?: ReactNode;
  subtitle?: ReactNode;
};

export type TooltipConfig = {
  /** What the default tooltip shows. Return null to show nothing for that area. */
  content?: (area: MapArea) => TooltipContent | null | undefined;
  /** width in px (default 220) */
  width?: number;
  /** distance in px between the cursor and the tooltip (default 16) */
  cursorOffset?: number;
  /** "cursor" follows the mouse; "anchored" sits below the area (default "cursor") */
  placement?: "cursor" | "anchored";
  /** ms before showing (default 0) */
  delay?: number;
  className?: string;
  /** touch screens: "hide" (default) or "first-tap" (1st tap shows, 2nd clicks) */
  touch?: "hide" | "first-tap";
};

export type BrazilMapProps = {
  /** what each shape is: regions (5), states (27) or municipalities (5,571). Default "state". */
  level?: MapLevel;
  /** only these regions (and their states/municipalities) */
  regions?: RegionKey[];
  /** only these states (takes precedence over `regions`) */
  states?: StateCode[];
  /**
   * finer filter on the areas of the current level (e.g. municipalities of one intermediate region);
   * areas it rejects are treated like those outside `regions`/`states`. Keep it memoized.
   */
  areaFilter?: (area: MapArea) => boolean;
  /**
   * the rest of the country when filtering: "show" (default) a muted silhouette without lines,
   * "states" the other states (or regions) muted with their borders, "hide" nothing
   */
  context?: "show" | "states" | "hide";
  /** fit the view to the filtered area (default true) */
  zoomToFilter?: boolean;
  /** duration in ms of the zoom when the view changes (default 600; 0 jumps). Skipped with prefers-reduced-motion. */
  zoomDuration?: number;
  /** extra lines drawn on top; default "state" at municipality level, otherwise "none" */
  borders?: "none" | "state" | "region";
  /**
   * level of detail of states and municipalities: "overview" is simplified at country scale,
   * "detail" at each state's scale. Default "auto": detail when `regions`/`states` zoom the map in.
   */
  detail?: "auto" | Detail;
  /** fill color of each area; return undefined for the default */
  getFill?: (area: MapArea) => string | null | undefined;
  /** same as getFill as an { id: color } object (serializable, for Server Components) */
  fills?: Partial<Record<string, string>>;
  /** fill of areas without a color (default var(--bm-area-fill)) */
  defaultFill?: string;
  getClassName?: (area: MapArea) => string | null | undefined;
  /** id highlighted from outside the map (e.g. while hovering a list) */
  highlighted?: string | null;
  /** turns each area into a link */
  getHref?: (area: MapArea) => string | null | undefined;
  /** click (also Enter/Space); with getHref, call event.preventDefault() to navigate on your own */
  onClick?: (area: MapArea, event: MouseEvent<Element> | KeyboardEvent<Element>) => void;
  /** mouse entered (area) or left (null) an area */
  onHover?: (area: MapArea | null, event: MouseEvent<Element> | null) => void;
  tooltip?: boolean | TooltipConfig;
  renderTooltip?: (area: MapArea) => ReactNode;
  /** country outline (default true) */
  showOutline?: boolean;
  /** shown over the map while municipalities are loading */
  loadingFallback?: ReactNode;
  /** accessible label (default "Mapa do Brasil") */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

type Anchor = { type: "cursor"; x: number; y: number } | { type: "element"; element: Element };

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function classNames(...names: (string | null | undefined | false)[]) {
  return names.filter(Boolean).join(" ");
}

function isKeyboardFocus(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true; // browsers without :focus-visible
  }
}

function unionBBox(boxes: BBox[]): BBox {
  return boxes.reduce<BBox>(
    (acc, b) => [Math.min(acc[0], b[0]), Math.min(acc[1], b[1]), Math.max(acc[2], b[2]), Math.max(acc[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function viewBoxFor(box: BBox) {
  const pad = Math.max(box[2] - box[0], box[3] - box[1]) * 0.04;
  return [box[0] - pad, box[1] - pad, box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2].map((n) => Math.round(n * 10) / 10).join(" ");
}

function areaPath(area: MapArea) {
  return area.level === "region" ? area.region.d : area.level === "state" ? area.state.d : area.municipality.d;
}

function areaBBox(area: MapArea) {
  return area.level === "region" ? area.region.bbox : area.level === "state" ? area.state.bbox : area.municipality.bbox;
}

function parseViewBox(viewBox: string) {
  return viewBox.split(/[\s,]+/).map(Number);
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** center moves linearly, size changes geometrically: a zoom feels evenly paced at any scale */
function interpolateViewBox(from: number[], to: number[], t: number) {
  const w = from[2] * (to[2] / from[2]) ** t;
  const h = from[3] * (to[3] / from[3]) ** t;
  const cx = from[0] + from[2] / 2 + (to[0] + to[2] / 2 - from[0] - from[2] / 2) * t;
  const cy = from[1] + from[3] / 2 + (to[1] + to[3] / 2 - from[1] - from[3] / 2) * t;
  return [cx - w / 2, cy - h / 2, w, h].map((n) => Math.round(n * 100) / 100).join(" ");
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type AreaShapeProps = {
  id: string;
  d: string;
  name: string;
  fill?: string;
  className: string;
  highlighted: boolean;
  href?: string;
  interactive: boolean;
  nativeTitle: boolean;
};

// memoized: hovering re-renders only the two areas whose `highlighted` flag changed
const AreaShape = memo(function AreaShape({ id, d, name, fill, className, highlighted, href, interactive, nativeTitle }: AreaShapeProps) {
  const path = (
    <path
      className={className}
      d={d}
      fillRule="evenodd"
      data-highlighted={highlighted || undefined}
      style={fill ? { fill } : undefined}
    />
  );
  const title = nativeTitle ? <title>{name}</title> : null;
  if (href) {
    return (
      <a href={href} data-area={id} aria-label={name} className="bm-target">
        {title}
        {path}
      </a>
    );
  }
  if (interactive) {
    return (
      <g data-area={id} role="button" tabIndex={0} aria-label={name} className="bm-target">
        {title}
        {path}
      </g>
    );
  }
  return (
    <g data-area={id}>
      {title}
      {path}
    </g>
  );
});

export function BrazilMap({
  level = "state",
  regions,
  states,
  areaFilter,
  context = "show",
  zoomToFilter = true,
  zoomDuration = 600,
  borders,
  detail = "auto",
  getFill,
  fills,
  defaultFill,
  getClassName,
  highlighted,
  getHref,
  onClick,
  onHover,
  tooltip,
  renderTooltip,
  showOutline = true,
  loadingFallback,
  title = "Mapa do Brasil",
  className,
  style,
}: BrazilMapProps) {
  const config: TooltipConfig = typeof tooltip === "object" ? tooltip : {};
  const hasTooltip = Boolean(tooltip || renderTooltip);
  const width = config.width ?? 220;
  const offset = config.cursorOffset ?? 16;
  const placement = config.placement ?? "cursor";
  const touch = config.touch ?? "hide";
  const lineMode = borders ?? (level === "municipality" ? "state" : "none");

  // ---- filter: which states are "in" ----
  const regionsKey = regions?.join(",") ?? "";
  const statesKey = states?.join(",") ?? "";
  const filteredStates = useMemo<State[] | null>(() => {
    if (statesKey) return STATES.filter((s) => statesKey.split(",").includes(s.uf));
    if (regionsKey) return STATES.filter((s) => regionsKey.split(",").includes(s.region));
    return null;
  }, [statesKey, regionsKey]);

  // ---- level of detail: zoomed into states, each one is drawn at its own scale ----
  const detailMode: Detail = detail === "auto" ? (filteredStates ? "detail" : "overview") : detail;
  const shownStates = filteredStates ?? STATES;
  const { municipalities, loading: loadingMunicipalities } = useMunicipalities(
    level === "municipality" ? shownStates.map((s) => s.uf) : null,
    detailMode,
  );
  const { outlines, loading: loadingOutlines } = useStateOutlines(
    detailMode === "detail" && level !== "region" ? shownStates.map((s) => s.uf) : null,
  );
  const loading = loadingMunicipalities || (level === "municipality" && loadingOutlines);

  // ---- areas of the current level ----
  const allAreas = useMemo<MapArea[]>(() => {
    if (level === "region") {
      const keys = filteredStates ? new Set(filteredStates.map((s) => s.region)) : null;
      return REGIONS.filter((r) => !keys || keys.has(r.key)).map((r) => ({ level: "region", id: r.key, name: r.name, region: r }));
    }
    if (level === "state") {
      // the detailed outline replaces the overview shape once it has loaded
      return shownStates.map((s) => ({ level: "state", id: s.uf, name: s.name, state: outlines[s.uf] ? { ...s, d: outlines[s.uf]! } : s }));
    }
    return municipalities
      .filter((m) => !m.water)
      .map((m) => ({ level: "municipality", id: String(m.ibgeCode), name: m.name, municipality: m }));
  }, [level, filteredStates, shownStates, municipalities, outlines]);
  const areas = useMemo(() => (areaFilter ? allAreas.filter(areaFilter) : allAreas), [allAreas, areaFilter]);
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const water = level === "municipality" ? municipalities.filter((m) => m.water) : [];

  // ---- context (muted, not interactive) ----
  // "show": the rest of the country as one silhouette, without any lines;
  // "states": the other states (or regions) with their borders, as before
  const contextShapes = useMemo(() => {
    if (context === "hide") return [];
    const shapes: { id: string; d: string }[] = [];
    if (context === "states") {
      if (level === "region") {
        const shown = new Set(areas.map((a) => a.id));
        shapes.push(...REGIONS.filter((r) => !shown.has(r.key)).map((r) => ({ id: r.key, d: r.d })));
      } else {
        // states outside the filter, plus the filtered ones while their municipalities load
        const inFilter = new Set((filteredStates ?? STATES).map((s) => s.uf));
        const outside = STATES.filter((s) => !inFilter.has(s.uf) || (level === "municipality" && loading));
        shapes.push(...outside.map((s) => ({ id: s.uf, d: s.d })));
      }
    }
    // areas rejected by areaFilter belong to the filtered states, so they keep their lines
    if (areas !== allAreas) {
      const shown = new Set(areas.map((a) => a.id));
      for (const a of allAreas) if (!shown.has(a.id)) shapes.push({ id: a.id, d: areaPath(a) });
    }
    return shapes;
  }, [context, level, areas, allAreas, filteredStates, loading]);
  const showSilhouette =
    context === "show" && (Boolean(filteredStates) || areas !== allAreas || (level === "municipality" && loading));

  // border lines are clipped to the filtered states, so they never cross the context
  const clipId = `bm-clip-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  // ---- view ----
  const viewBox = useMemo(() => {
    if (!zoomToFilter) return VIEW_BOX;
    if (areas.length > 0 && areas.length < allAreas.length) return viewBoxFor(unionBBox(areas.map(areaBBox)));
    if (!filteredStates) return VIEW_BOX;
    const boxes = level === "region" ? REGIONS.filter((r) => filteredStates.some((s) => s.region === r.key)).map((r) => r.bbox) : filteredStates.map((s) => s.bbox);
    return viewBoxFor(unionBBox(boxes));
  }, [zoomToFilter, filteredStates, level, areas, allAreas]);

  // React renders the target viewBox; right after the commit (before paint) it is reset to what was on
  // screen and animated from there, setting the attribute directly so no frame re-renders the areas
  const svgRef = useRef<SVGSVGElement>(null);
  const shownViewBoxRef = useRef(viewBox);
  useIsomorphicLayoutEffect(() => {
    const svg = svgRef.current;
    const from = shownViewBoxRef.current;
    if (!svg || from === viewBox) return;
    if (zoomDuration <= 0 || prefersReducedMotion()) {
      shownViewBoxRef.current = viewBox;
      return;
    }
    const fromBox = parseViewBox(from);
    const toBox = parseViewBox(viewBox);
    svg.setAttribute("viewBox", from);
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / zoomDuration);
      const box = t === 1 ? viewBox : interpolateViewBox(fromBox, toBox, easeInOutCubic(t));
      shownViewBoxRef.current = box;
      svg.setAttribute("viewBox", box);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    // a new target mid-zoom continues from the current box
    return () => cancelAnimationFrame(frame);
  }, [viewBox, zoomDuration]);

  // ---- hover, tooltip ----
  const [hovered, setHovered] = useState<string | null>(null);
  const [tooltipId, setTooltipId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointerRef = useRef<string>("mouse");

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // areas can disappear when the level or filter changes
  const hoveredArea = hovered ? areaById.get(hovered) : undefined;
  const tooltipArea = tooltipId ? areaById.get(tooltipId) : undefined;

  function position() {
    const container = containerRef.current;
    const box = tooltipRef.current;
    const anchor = anchorRef.current;
    if (!container || !box || !anchor) return;
    const area = container.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let x: number;
    let y: number;
    if (anchor.type === "cursor") {
      x = anchor.x - area.left + offset;
      y = anchor.y - area.top + offset;
      if (x + w > area.width) x -= w + offset * 2;
      if (y + h > area.height) y -= h + offset * 2;
    } else {
      const target = anchor.element.getBoundingClientRect();
      x = target.left + target.width / 2 - area.left - w / 2;
      y = target.bottom - area.top + offset / 2;
      if (y + h > area.height) y = target.top - area.top - h - offset / 2;
    }
    x = Math.min(Math.max(x, 0), Math.max(area.width - w, 0));
    y = Math.max(y, 0);
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  useIsomorphicLayoutEffect(position, [tooltipId]);

  function showTooltip(id: string, anchor: Anchor, immediate = false) {
    if (!hasTooltip) return;
    anchorRef.current = anchor;
    clearTimeout(timerRef.current);
    if (immediate || !config.delay) setTooltipId(id);
    else timerRef.current = setTimeout(() => setTooltipId(id), config.delay);
  }

  function hideTooltip() {
    clearTimeout(timerRef.current);
    setTooltipId(null);
  }

  // events are delegated from the <svg>: each area only carries data-area
  const areaElement = (target: EventTarget | null) => (target as Element | null)?.closest?.("[data-area]") ?? null;
  const areaOf = (element: Element | null) => (element ? areaById.get(element.getAttribute("data-area")!) : undefined);

  function handleMouseOver(event: MouseEvent<SVGSVGElement>) {
    if (pointerRef.current === "touch") return; // emulated mouse events after a tap
    const element = areaElement(event.target);
    const area = areaOf(element);
    if (!element || !area || area.id === hovered) return;
    setHovered(area.id);
    onHover?.(area, event);
    showTooltip(
      area.id,
      placement === "cursor" ? { type: "cursor", x: event.clientX, y: event.clientY } : { type: "element", element },
    );
  }

  function handleMouseOut(event: MouseEvent<SVGSVGElement>) {
    if (pointerRef.current === "touch") return;
    const from = areaElement(event.target);
    if (!from || from === areaElement(event.relatedTarget)) return;
    // entering another area is handled by mouseover
    if (areaOf(areaElement(event.relatedTarget))) return;
    setHovered(null);
    onHover?.(null, event);
    hideTooltip();
  }

  function activate(event: MouseEvent<Element> | KeyboardEvent<Element>, element: Element, area: MapArea) {
    if (pointerRef.current === "touch" && hasTooltip && touch === "first-tap" && tooltipId !== area.id) {
      event.preventDefault();
      setHovered(area.id);
      showTooltip(area.id, { type: "element", element }, true);
      return;
    }
    onClick?.(area, event);
  }

  function handleClick(event: MouseEvent<SVGSVGElement>) {
    const element = areaElement(event.target);
    const area = areaOf(element);
    if (element && area) activate(event, element, area);
    else if (pointerRef.current === "touch") {
      setHovered(null);
      hideTooltip();
    }
  }

  function handleKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const element = areaElement(event.target);
    const area = areaOf(element);
    // links already activate on Enter
    if (!element || !area || element.tagName.toLowerCase() === "a") return;
    event.preventDefault();
    onClick?.(area, event);
  }

  function handleFocus(event: FocusEvent<SVGSVGElement>) {
    const element = areaElement(event.target);
    const area = areaOf(element);
    // only keyboard focus: a tap focuses the area right before its click, and opening the tooltip
    // here would turn that first tap into the "second tap" of touch: "first-tap"
    if (!element || !area || !isKeyboardFocus(event.target as Element)) return;
    setHovered(area.id);
    showTooltip(area.id, { type: "element", element }, true);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    pointerRef.current = event.pointerType;
    if (event.pointerType === "mouse" && placement === "cursor" && anchorRef.current?.type === "cursor") {
      anchorRef.current = { type: "cursor", x: event.clientX, y: event.clientY };
      position();
    }
  }

  // ---- tooltip content ----
  let content: ReactNode = null;
  if (tooltipArea) {
    if (renderTooltip) {
      content = renderTooltip(tooltipArea);
    } else {
      const data = config.content ? config.content(tooltipArea) : {};
      if (data) {
        content = (
          <>
            {data.image && <img key={data.image} src={data.image} alt="" className="bm-tooltip-image" />}
            <div className="bm-tooltip-body">
              <strong className="bm-tooltip-title">{data.title ?? tooltipArea.name}</strong>
              {data.subtitle && <span className="bm-tooltip-subtitle">{data.subtitle}</span>}
            </div>
          </>
        );
      }
    }
  }
  const tooltipVisible = content !== null && content !== undefined && content !== false;
  const hiddenOnTouch = touch === "hide" && pointerRef.current === "touch";
  const interactive = Boolean(onClick) || touch === "first-tap";
  // detailed municipalities get their states' detailed outlines on top, standing in for the state lines
  const detailedOutlines = level === "municipality" && detailMode === "detail" && !loading ? Object.values(outlines) : [];
  // where a detailed edge runs outside its overview neighbor there would be a sliver of background;
  // the overview shapes of the same states, drawn underneath in the context color, fill it
  const underlay =
    context !== "hide" && detailMode === "detail" && level !== "region" && filteredStates ? filteredStates : [];
  // the overview coastline would run beside the detailed one, so it is left out in detail mode
  const showCountryOutline = showOutline && detailMode === "overview" && (!filteredStates || context !== "hide");
  const borderLines =
    lineMode === "region" ? REGION_BORDERS : lineMode === "state" && detailedOutlines.length === 0 ? STATE_BORDERS : null;

  return (
    <div
      ref={containerRef}
      className={classNames("bm-map", className)}
      style={style}
      data-level={level}
      onPointerMove={handlePointerMove}
      onPointerDown={(event) => (pointerRef.current = event.pointerType)}
    >
      <svg
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        aria-label={title}
        aria-busy={loading || undefined}
        className="bm-svg"
        onMouseOver={handleMouseOver}
        onMouseOut={handleMouseOut}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => {
          setHovered(null);
          hideTooltip();
        }}
      >
        {showSilhouette && <path className="bm-silhouette" d={COUNTRY_OUTLINE} fillRule="evenodd" aria-hidden="true" />}
        {filteredStates && borderLines && (
          <clipPath id={clipId}>
            {filteredStates.map((s) => (
              <path key={s.uf} d={s.d} fillRule="evenodd" />
            ))}
          </clipPath>
        )}
        {contextShapes.length > 0 && (
          <g className="bm-context" aria-hidden="true">
            {contextShapes.map((s) => (
              <path key={s.id} d={s.d} fillRule="evenodd" />
            ))}
          </g>
        )}
        {underlay.length > 0 && (
          <g className="bm-underlay" aria-hidden="true">
            {underlay.map((s) => (
              <path key={s.uf} d={s.d} fillRule="evenodd" />
            ))}
          </g>
        )}
        <g className="bm-areas">
          {areas.map((area) => {
            const isHighlighted = area.id === hovered || area.id === highlighted;
            const fill = isHighlighted ? undefined : (getFill?.(area) ?? fills?.[area.id] ?? defaultFill ?? undefined);
            const d = areaPath(area);
            return (
              <AreaShape
                key={area.id}
                id={area.id}
                d={d}
                name={area.name}
                fill={fill}
                className={classNames("bm-area", getClassName?.(area))}
                highlighted={isHighlighted}
                href={getHref?.(area) ?? undefined}
                interactive={interactive}
                nativeTitle={!hasTooltip}
              />
            );
          })}
        </g>
        {water.length > 0 && (
          <g className="bm-water" aria-hidden="true">
            {water.map((w) => (
              <path key={w.ibgeCode} d={w.d} />
            ))}
          </g>
        )}
        {borderLines && (
          <path
            className={`bm-borders bm-borders-${lineMode}`}
            d={borderLines}
            clipPath={filteredStates ? `url(#${clipId})` : undefined}
          />
        )}
        {detailedOutlines.length > 0 && (
          <g className="bm-state-outlines" aria-hidden="true">
            {detailedOutlines.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
        )}
        {showCountryOutline && <path className="bm-outline" d={COUNTRY_OUTLINE} />}
      </svg>

      {loading && loadingFallback && <div className="bm-loading">{loadingFallback}</div>}

      {hasTooltip && (
        <div
          ref={tooltipRef}
          className={classNames("bm-tooltip", config.className)}
          data-visible={(tooltipVisible && !hiddenOnTouch && hoveredArea !== undefined) || undefined}
          style={{ "--bm-tooltip-width": `${width}px` } as CSSProperties}
          aria-hidden="true"
        >
          {content}
        </div>
      )}
    </div>
  );
}
