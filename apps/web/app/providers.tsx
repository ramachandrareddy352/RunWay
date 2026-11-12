"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { API_URL, GATEWAY_URL, UNDERWRITER_URL } from "../lib/env";
import { WalletProvider } from "../lib/wallet";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <WalletProvider>{children}</WalletProvider>
    </QueryClientProvider>
  );
}
