import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { AuthProvider, useAuth } from "./src/hooks/useAuth";
import { useQueryFocusManager } from "./src/hooks/useQueryFocusManager";
import { useReminderTimezoneSync } from "./src/hooks/useReminderTimezoneSync";
import { useAppBadgeSync } from "./src/hooks/useAppBadgeSync";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { registerServiceWorker, injectManifestLink } from "./src/pwa/register-sw";
import { startNotificationClickCapture } from "./src/pwa/notificationClicks";

// Capture SW notification clicks + ?notif= before React mounts (warm/cold race).
startNotificationClickCapture();

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
  const auth = useAuth();
  const authenticated = auth.status === "authenticated";
  useReminderTimezoneSync(authenticated);
  useAppBadgeSync(authenticated);
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
