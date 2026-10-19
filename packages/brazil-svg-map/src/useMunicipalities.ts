import { useEffect, useRef, useState } from "react";
import { loadMunicipalities, loadStateOutline, type Detail, type Municipality, type StateCode } from "./data";

type Loaded<T> = { value: T; loading: boolean; error: Error | null };

/**
 * Loads something per state (pass null to skip). `key` identifies the request; results of an
 * older request are never shown. Loaded states come from the cache, so switching back is instant.
 */
function useLoaded<T>(key: string, load: () => Promise<T>, empty: T): Loaded<T> {
  const [state, setState] = useState<Loaded<T> & { key: string }>({ key: "", value: empty, loading: false, error: null });
  // `key` captures everything `load` reads, so only a new key starts a new load
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    setState((current) => ({ ...current, key, loading: true, error: null }));
    loadRef
      .current()
      .then((value) => !cancelled && setState({ key, value, loading: false, error: null }))
      .catch((error: Error) => !cancelled && setState({ key, value: empty, loading: false, error }));
    return () => {
      cancelled = true;
    };
  }, [key, empty]);

  if (!key) return { value: empty, loading: false, error: null };
  if (state.key !== key) return { value: empty, loading: true, error: null };
  return state;
}

const NO_MUNICIPALITIES: Municipality[] = [];
const NO_OUTLINES: Partial<Record<StateCode, string>> = {};

const sortedKey = (ufs: StateCode[] | null) => (ufs ? [...ufs].sort().join(",") : "");
const ufsOf = (key: string) => key.split(",") as StateCode[];

export type MunicipalitiesState = {
  municipalities: Municipality[];
  loading: boolean;
  error: Error | null;
};

/** Municipalities of the given states (null skips loading), at the given level of detail. */
export function useMunicipalities(ufs: StateCode[] | null, detail: Detail = "overview"): MunicipalitiesState {
  const states = sortedKey(ufs);
  const key = states && `${detail}:${states}`;
  const { value, loading, error } = useLoaded(
    key,
    async () => (await Promise.all(ufsOf(states).map((uf) => loadMunicipalities(uf, detail)))).flat(),
    NO_MUNICIPALITIES,
  );
  return { municipalities: value, loading, error };
}

/** Outlines of the given states at their own scale (null skips loading), by UF. */
export function useStateOutlines(ufs: StateCode[] | null) {
  const key = sortedKey(ufs);
  const { value, loading } = useLoaded(
    key,
    async () => Object.fromEntries(await Promise.all(ufsOf(key).map(async (uf) => [uf, await loadStateOutline(uf)]))),
    NO_OUTLINES,
  );
  return { outlines: value as Partial<Record<StateCode, string>>, loading };
}
