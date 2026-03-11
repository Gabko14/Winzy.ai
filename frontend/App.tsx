import { useEffect } from "react";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { AuthProvider } from "./src/hooks/useAuth";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { registerServiceWorker, injectManifestLink } from "./src/pwa/register-sw";

export default function App() {
  useEffect(() => {
    registerServiceWorker();
    injectManifestLink();
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ErrorBoundary>
  );
}
