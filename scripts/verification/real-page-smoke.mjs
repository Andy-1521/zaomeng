import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const baseUrl = process.env.REAL_SMOKE_BASE_URL || 'http://127.0.0.1:5000';

function findChromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH;
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

async function main() {
  const executablePath = findChromiumExecutable();
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
  });

  try {
    await page.goto(`${baseUrl}/home`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
    await page.goto(`${baseUrl}/profile`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});

    const unexpectedErrors = errors.filter((error) => !error.includes('status of 401'));
    console.log(JSON.stringify({
      ok: unexpectedErrors.length === 0 && failedRequests.length === 0,
      pages: ['/home', '/profile'],
      consoleErrors: errors.length,
      unexpectedConsoleErrors: unexpectedErrors.length,
      failedRequests: failedRequests.length,
      firstUnexpectedErrors: unexpectedErrors.slice(0, 5),
      firstFailedRequests: failedRequests.slice(0, 5),
    }, null, 2));

    if (unexpectedErrors.length > 0 || failedRequests.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
