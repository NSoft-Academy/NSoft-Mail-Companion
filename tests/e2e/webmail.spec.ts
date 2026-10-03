// Copyright © 2026 M Suthakaran, trading as NSoft Academy.
// Licensed under the Apache License, Version 2.0.
import { test, expect, chromium } from '@playwright/test';
test('optional live Roundcube mailbox login through customer hostname', async () => {
  test.skip(process.env.TEST_WEBMAIL !== 'true', 'Run with the isolated compose.test.yaml stack.');
  const browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP webmail.example.test 127.0.0.1'],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto('https://webmail.example.test:38443/');
  await expect(page.locator('input[name="_user"]')).toBeVisible();
  await page.locator('input[name="_user"]').fill('bob@example.test');
  await page.locator('input[name="_pass"]').fill('Integration-Password42');
  await page.locator('#rcmloginsubmit').click();
  await expect(page.locator('#messagelist')).toBeVisible({ timeout: 15000 });
  await context.close();
  await browser.close();
});
