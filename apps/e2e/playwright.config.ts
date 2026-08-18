import { defineConfig, devices } from '@playwright/test';

const serverEnvironment = {
  CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:5173',
  PORT: '3000',
};

const rateLimitServerEnvironment = {
  CORS_ALLOWED_ORIGIN: 'http://127.0.0.1:5174',
  PORT: '3001',
};

const serverOutput = {
  stderr: 'pipe' as const,
  stdout: 'pipe' as const,
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      ...serverOutput,
      command: 'pnpm --filter @chat-app/api dev',
      cwd: '../..',
      env: serverEnvironment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      wait: { stdout: /Nest application successfully started/ },
    },
    {
      ...serverOutput,
      command: 'pnpm --filter @chat-app/web dev --port 5173',
      cwd: '../..',
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:3000',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://127.0.0.1:5173',
    },
    {
      ...serverOutput,
      command: 'pnpm --filter @chat-app/api dev',
      cwd: '../..',
      env: rateLimitServerEnvironment,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      wait: { stdout: /Nest application successfully started/ },
    },
    {
      ...serverOutput,
      command: 'pnpm --filter @chat-app/web dev --port 5174',
      cwd: '../..',
      env: {
        VITE_API_BASE_URL: 'http://127.0.0.1:3001',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: 'http://127.0.0.1:5174',
    },
  ],
});
