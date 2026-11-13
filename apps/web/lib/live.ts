"use client";
// Live numbers for previews: the vault (chain), the INR rate (the gateway's oracle) and its limits.
import { useEffect, useState } from "react";
import { credit, gateway } from "./chain";
import { GATEWAY_URL } from "./env";
import { useAsync } from "./useAsync";

/** Paise per USDC from the gateway's FX oracle; null while loading or if the backend is asleep. */
export function useLiveRate(): { ratePpu: number | null; sources: string[] } {
  const [r, setR] = useState<{ ratePpu: number | null; sources: string[] }>({ ratePpu: null, sources: [] });
  useEffect(() => {
    let live = true;
    fetch(`${GATEWAY_URL}/health`)
      .then((res) => res.json() as Promise<{ oracle?: { rate_ppu?: number; sources?: string[] } }>)
      .then((b) => {
        if (live && b.oracle?.rate_ppu) setR({ ratePpu: b.oracle.rate_ppu, sources: b.oracle.sources ?? [] });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return r;
}

export const useVault = () => useAsync(() => credit.vault(), []);
export const useGatewayLimits = () => useAsync(() => gateway.limits(), []);

/** A typical rate when the oracle can't be reached, clearly labelled as such where it is used. */
export const FALLBACK_RATE_PPU = 10_000;
