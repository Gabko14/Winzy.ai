import { api } from "./client";

export type ExportBundle = {
  exportedAt: string;
  services: Array<{
    service: string;
    data: Record<string, unknown>;
  }>;
};

export async function exportMyData(): Promise<ExportBundle> {
  return api.get<ExportBundle>("/auth/export");
}
