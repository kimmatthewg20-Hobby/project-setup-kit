// Playwright (project-setup v3.5): e2e checks written by /deliver live in e2e/. Uses fake test data only.
import { defineConfig, devices } from '@playwright/test'

// Test logins (dev test account) come from these files when present, so a plain `npx playwright test` works.
// Claude never reads or prints them; in the cloud the same names come from the environment variables.
for (const file of ['.env.local', '.env.test.local']) { try { process.loadEnvFile(file) } catch {} }

const PORT = Number(process.env.PORT ?? 3000)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  // Fail fast: a click on a missing or disabled element fails in 10 s with a clear message, not after the whole test timeout.
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', actionTimeout: 10_000, navigationTimeout: 20_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: process.env.CI ? 'npm run build && npm run start' : 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
