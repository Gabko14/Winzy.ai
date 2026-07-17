import React from "react";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react-native";
import type { RenderOptions } from "@testing-library/react-native";

// Flush Query notifications synchronously so act()/waitFor see updates immediately.
notifyManager.setScheduler((cb) => {
  cb();
});

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function createQueryWrapper(client?: QueryClient) {
  const queryClient = client ?? createTestQueryClient();
  return function QueryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

export function renderWithQueryClient(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper"> & { queryClient?: QueryClient },
) {
  const { queryClient, ...renderOptions } = options ?? {};
  const client = queryClient ?? createTestQueryClient();
  return {
    ...render(ui, {
      ...renderOptions,
      wrapper: createQueryWrapper(client),
    }),
    queryClient: client,
  };
}

export function renderHookWithQueryClient<TResult, TProps = unknown>(
  hook: (props: TProps) => TResult,
  options?: { queryClient?: QueryClient; initialProps?: TProps },
) {
  const client = options?.queryClient ?? createTestQueryClient();
  return {
    ...renderHook(hook, {
      wrapper: createQueryWrapper(client),
      initialProps: options?.initialProps as TProps,
    }),
    queryClient: client,
  };
}
