import { defineConfig, devices } from "@playwright/test";
import path from "path";

const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL ?? "http://localhost:8081";
const authFile = path.join(__dirname, ".auth", "user.json");

export default defineConfig({
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: undefined,
  reporter: isCI
    ? [["html", { open: "never" }], ["github"]]
    : [["html", { open: "on-failure" }]],

  use: {
    baseURL,
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

  webServer: {
    command: "cd ../frontend && npx expo start --web --port 8081",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
