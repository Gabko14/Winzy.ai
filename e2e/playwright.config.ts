import { defineConfig, devices } from "@playwright/test";
import path from "path";

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL ?? "http://localhost:8081";
const authFile = path.join(__dirname, ".auth", "user.json");

export default defineConfig({
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 4 : undefined,
  reporter: isCI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["html", { open: "on-failure" }]],

  use: {
    baseURL,
    testIdAttribute: "data-testid",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: "setup",
      testDir: "./fixtures",
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: "chromium",
      testDir: "./tests",
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      dependencies: ["setup"],
    },
  ],

  webServer: isCI
    ? {
        command: "npx serve ../frontend/dist -l 8081 -s",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 10_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : {
        command: "cd ../frontend && npx expo start --web --port 8081",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 60_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
