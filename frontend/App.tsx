import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { OfflineIndicator } from "./src/components/OfflineIndicator";
import { AuthProvider } from "./src/hooks/useAuth";
import { registerServiceWorker, injectManifestLink } from "./src/pwa/register-sw";

export default function App() {
  useEffect(() => {
    registerServiceWorker();
    injectManifestLink();
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <OfflineIndicator />
        <View style={styles.container}>
          <Text>Open up App.tsx to start working on your app!</Text>
          <StatusBar style="auto" />
        </View>
      </AuthProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
});
