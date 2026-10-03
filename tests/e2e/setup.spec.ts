// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('private bootstrap fragment is removed, accessible responsive form and expiry correction', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({ status: 401, json: { success: false } }),
  );
  await page.route('**/api/v1/setup/claim', (r) =>
    r.fulfill({
      status: 409,
      json: {
        success: false,
        error: {
          message:
            'This setup link has expired or was already used. Run the installer again to resume.',
        },
      },
    }),
  );
  await page.goto('/setup#' + 'b'.repeat(64));
  await expect(page.getByRole('heading', { name: 'Create your administrator' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          fits: document.documentElement.scrollWidth <= window.innerWidth,
          overflowing: Array.from(document.querySelectorAll('body *'))
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
            .map(
              (element) =>
                `${element.tagName}.${element.className}: ${element.textContent?.slice(0, 80)}`,
            ),
        })),
      )
      .toEqual({ fits: true, overflowing: [] });
  }
  await page.getByLabel('Your name').fill('Setup Owner');
  await page.getByLabel('Administrator email').fill('owner@example.com');
  await page.getByLabel('Administrator password').fill('Long-Setup-Password42!');
  await page.getByRole('button', { name: 'Create administrator' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'expired' })).toContainText('expired');
});
test('saved setup resumes with actionable server blockers and failed-task retry', async ({
  page,
}) => {
  let retry = false;
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/retry')) retry = true;
    const data = path.endsWith('/auth/me')
      ? { id: 'owner', role: 'PLATFORM_ADMIN', mfaEnabled: true, csrfToken: 'fixture' }
      : path.endsWith('/setup/status')
        ? {
            setup: null,
            connections: [],
            tasks: [
              {
                id: 'fixture-task',
                operation: 'certificate',
                status: 'FAILED',
                lastError: 'Check DNS permissions, then retry.',
              },
            ],
            host: {
              available: true,
              method: 'native',
              checks: [
                {
                  name: 'reverse-dns',
                  passed: false,
                  detail: 'Your provider must configure reverse DNS.',
                },
              ],
              certificates: [],
              backupConfigured: false,
            },
          }
        : [];
    return r.fulfill({ json: { success: true, data } });
  });
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: '1. Check your server' })).toBeVisible();
  await expect(page.getByText('Your provider must configure reverse DNS.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  expect(retry).toBe(true);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          fits: document.documentElement.scrollWidth <= window.innerWidth,
          overflowing: Array.from(document.querySelectorAll('body *'))
            .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
            .map(
              (element) =>
                `${element.tagName}.${element.className}: ${element.textContent?.slice(0, 80)}`,
            ),
        })),
      )
      .toEqual({ fits: true, overflowing: [] });
  }
});
