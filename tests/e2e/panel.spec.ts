// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('accessible sign-in, responsive layouts, and failure state', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 401, json: { success: false, error: { message: 'Sign in' } } }),
  );
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: {
        success: false,
        error: { message: 'Email, password, or authenticator code is incorrect.' },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByLabel('Email address').fill('admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Wrong-Password42');
  await page.getByRole('button', { name: 'Sign in →' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'incorrect' })).toHaveText(/incorrect/);
});
test('empty workspace, navigation and mobile keyboard behaviour', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    const data = url.endsWith('/auth/me')
      ? {
          id: 'admin',
          name: 'Administrator',
          email: 'admin@example.com',
          role: 'PLATFORM_ADMIN',
          tenantId: null,
          csrfToken: 'test',
          mfaEnabled: true,
        }
      : url.endsWith('/overview')
        ? { domains: 0, mailboxes: 0, ready: 0, failedJobs: 0 }
        : [];
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your mail, at a glance.' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle navigation' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).not.toBeVisible();
});

test('failed provisioning can be retried from Activity', async ({ page }) => {
  let retried = false;
  await page.route('**/api/v1/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('/jobs/failed-job/retry')) retried = true;
    const data = url.endsWith('/auth/me')
      ? { id: 'admin', name: 'Admin', role: 'PLATFORM_ADMIN', csrfToken: 'test', mfaEnabled: true }
      : url.endsWith('/overview')
        ? { domains: 0, mailboxes: 0, ready: 0, failedJobs: 1 }
        : url.endsWith('/jobs')
          ? [
              {
                id: 'failed-job',
                kind: 'DOMAIN_PROVISION',
                status: retried ? 'PENDING' : 'FAILED',
                attempts: 5,
                lastError: 'PROVISIONING_FAILED',
              },
            ]
          : [];
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Retry job' }).click();
  await expect(page.getByText('PENDING', { exact: true })).toBeVisible();
  expect(retried).toBe(true);
});
