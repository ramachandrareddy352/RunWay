"use client";
import { useCallback, useEffect, useState } from "react";

/** Runs `fn` when `deps` change; `reload()` re-runs it (after a transaction). */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | undefined; error: unknown; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  // The caller lists the dependencies, like useEffect.
  const run = useCallback(fn, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setLoading(true);
    run()
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (live) setError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [run, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}
