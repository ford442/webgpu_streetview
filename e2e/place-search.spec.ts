import { test, expect } from '@playwright/test';
import { dismissWelcome, getUncaught, gotoApp } from './helpers';

test.describe('place search shell', () => {
  test('welcome and connected chrome expose destination search with nearby off', async ({ page }) => {
    const placesHits: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/maps\.googleapis\.com\/maps\/api\/place/i.test(url) || /PlacesService| AutocompleteService/i.test(url)) {
        placesHits.push(url);
      }
    });

    await gotoApp(page);

    const welcomeSearch = page.getByRole('combobox', { name: /Search a destination/i });
    await expect(welcomeSearch).toBeVisible();
    await expect(page.getByLabel(/Show nearby places/i)).not.toBeChecked();

    await dismissWelcome(page);

    await expect(page.getByTestId('place-search').first()).toBeVisible();
    await expect(page.getByLabel(/Show nearby places/i).first()).not.toBeChecked();
    await expect(page.getByPlaceholder(/Place, lat, lng, or pano id/i).first()).toBeVisible();

    expect(placesHits).toEqual([]);
    expect(getUncaught(page)).toEqual([]);
  });
});
