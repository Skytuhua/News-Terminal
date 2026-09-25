import { test, expect } from '@playwright/test';
import { fixture } from './fixture';

test('fixture: the first successful feed load populates an empty reader immediately', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).__TEST_PATCH__({ articles: [] });
    window.dispatchEvent(new Event('data-changed'));
  });
  await expect(page.getByTestId('story-row')).toHaveCount(0);
  await page.evaluate(() => ((window as any).__TEST_ADD_STORY__ = true));
  await page.getByRole('button', { name: 'Refresh feeds' }).click();
  await expect(page.getByTestId('story-row')).toHaveCount(1);
  await expect(page.getByText('Newly arrived report', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '1 new story · Show latest' })).toHaveCount(0);
});
