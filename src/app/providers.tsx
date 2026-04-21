"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  // useState guards against a new QueryClient on every render
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Live dashboard: refetch every 30 seconds while the tab is open
            refetchInterval: 30_000,
            // Also refetch when the user comes back to the tab
            refetchOnWindowFocus: true,
            // Keep showing previous data while a refetch is happening
            staleTime: 20_000,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
