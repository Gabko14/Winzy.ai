import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { AuthProvider } from "./src/hooks/useAuth";
import { useQueryFocusManager } from "./src/hooks/useQueryFocusManager";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { registerServiceWorker, injectManifestLink } from "./src/pwa/register-sw";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}

function AppProviders({ children }: { children: React.ReactNode }) {
  useQueryFocusManager();
  return <>{children}</>;
}

export default function App() {
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    registerServiceWorker();
    injectManifestLink();
  }, []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <AppProviders>
            <RootNavigator />
          </AppProviders>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
