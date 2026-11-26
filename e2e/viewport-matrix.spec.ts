import { test, expect, type Page } from '@playwright/test';
import { dismissWelcome, gotoApp, hasMapsKey } from './helpers';

/**
 * Viewport matrix (#385): the release's screen sizes × the key screens.
 *
 * Every cell asserts no horizontal overflow (`scrollWidth <= innerWidth`, on <html> and
 * <body> — `body { overflow: hidden }` hides an overflow, it does not remove it), that every
 * visible element stays inside the viewport horizontally, and that the HUD's buttons are at
 * least 44 px tall. With `SV_VIEWPORT_SHOTS=<dir>` each cell is also saved as a PNG for
 * the release report.
 */
const VIEWPORTS = [
  { name: 'desktop-1920', width: 1920, height: 1080 },
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 720 },
  { name: 'ipad-portrait', width: 820, height: 1180, touch: true },
  { name: 'ipad-landscape', width: 1180, height: 820, touch: true },
  { name: 'iphone-390', width: 390, height: 844, touch: true, mobile: true },
  { name: 'android-360', width: 360, height: 800, touch: true, mobile: true },
] as const;

const SHOTS_DIR = process.env.SV_VIEWPORT_SHOTS;

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR) await page.screenshot({ path: `${SHOTS_DIR}/${name}.png` });
}

async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const m = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      // Zero-size and visually-hidden (sr-only, 1×1 px) elements are not layout.
      if (r.width <= 1 || r.height <= 1) continue;
      if (r.right > vw + 1 || r.left < -1) {
        offenders.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
    }
    return {
      vw,
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders: offenders.slice(0, 10),
    };
  });
  expect(m.html, `${where}: <html> scrollWidth`).toBeLessThanOrEqual(m.vw);
  expect(m.body, `${where}: <body> scrollWidth`).toBeLessThanOrEqual(m.vw);
  expect(m.offenders, `${where}: elements outside the viewport`).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: 'touch' in vp ? vp.touch : false,
      isMobile: 'mobile' in vp ? vp.mobile : false,
    });

    test('welcome dialog fits and scrolls instead of clipping', async ({ page }) => {
      await gotoApp(page);
      const dialog = page.getByRole('dialog', { name: /1ink\.us Streetview/i });
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expectNoOverflow(page, 'welcome');

      // The title is never under the banner stack, and Start is reachable.
      const title = page.locator('#welcome-title');
      const banner = await page.getByTestId('banner-stack').boundingBox();
      const titleBox = await title.boundingBox();
      expect(titleBox).not.toBeNull();
      if (banner && banner.height > 0) expect(titleBox!.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
      const start = page.getByRole('button', { name: /Start Exploring/i });
      await start.scrollIntoViewIfNeeded();
      await expect(start).toBeInViewport();
      await shot(page, `${vp.name}-welcome`);
    });

    test('HUD: toolbar reachable, no overflow, 44px targets', async ({ page }) => {
      await gotoApp(page);
      await dismissWelcome(page);
      const toolbar = page.getByTestId('app-toolbar');
      await expect(toolbar).toBeVisible({ timeout: 20_000 });
      await expectNoOverflow(page, 'hud');

      const menu = toolbar.locator('.app-toolbar__menu-toggle');
      if (await menu.isVisible()) {
        await shot(page, `${vp.name}-hud`);
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
      }

      // Every action button is reachable: in view once scrolled to, and inside the viewport.
      const buttons = toolbar.locator('.app-toolbar__actions > button');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(5);
      for (let i = 0; i < count; i++) {
        const b = buttons.nth(i);
        await b.scrollIntoViewIfNeeded();
        await expect(b).toBeInViewport();
        const box = await b.boundingBox();
        expect(box!.height, `toolbar button ${i} height`).toBeGreaterThanOrEqual(44);
      }
      await expectNoOverflow(page, 'hud-menu');
      await shot(page, `${vp.name}-hud${(await menu.isVisible()) ? '-menu' : ''}`);
    });

    for (const name of ['Trip', 'Offline', 'Bookmarks', 'History', 'Weather']) {
      test(`${name} panel (empty state) opens without overflow`, async ({ page }) => {
        await gotoApp(page);
        await dismissWelcome(page);
        const toolbar = page.getByTestId('app-toolbar');
        await expect(toolbar).toBeVisible({ timeout: 20_000 });
        const menu = toolbar.locator('.app-toolbar__menu-toggle');
        if (await menu.isVisible()) await menu.click();
        const button = toolbar.locator('.app-toolbar__actions > button', { hasText: new RegExp(`^\\W*${name}$`, 'i') });
        await button.scrollIntoViewIfNeeded();
        await button.click();
        // The phone menu closes on a pick, so the panel is not under it.
        if (await menu.isVisible()) await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await page.waitForTimeout(300);
        await expectNoOverflow(page, `panel ${name}`);
        await shot(page, `${vp.name}-panel-${name.toLowerCase()}`);
      });
    }

    test('missing-key error card is designed, fits, and keeps input off the canvas', async ({ page }) => {
      test.skip(hasMapsKey, 'a Maps key is configured — the missing-key card is not shown');
      await gotoApp(page);
      await dismissWelcome(page);
      const card = page.getByTestId('error-card');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByRole('heading')).toHaveText(/not set up/i);
      await expect(card.getByRole('button', { name: /Check again/i })).toBeVisible();
      await expectNoOverflow(page, 'error');

      // Not covered by the toolbar on any width.
      const cardBox = (await card.boundingBox())!;
      const tb = page.getByTestId('app-toolbar').locator('.app-toolbar__actions');
      if (await tb.isVisible()) {
        const tbBox = (await tb.boundingBox())!;
        const overlapX = Math.min(cardBox.x + cardBox.width, tbBox.x + tbBox.width) - Math.max(cardBox.x, tbBox.x);
        const overlapY = Math.min(cardBox.y + cardBox.height, tbBox.y + tbBox.height) - Math.max(cardBox.y, tbBox.y);
        expect(overlapX > 0 && overlapY > 0, 'toolbar overlaps the error card').toBe(false);
      }

      // Input isolation: a press on the card never reaches a document-level listener.
      await page.evaluate(() => {
        (window as unknown as { __leaked: number }).__leaked = 0;
        document.addEventListener('mousedown', () => {
          (window as unknown as { __leaked: number }).__leaked++;
        });
      });
      await card.click({ position: { x: 10, y: 10 } });
      expect(await page.evaluate(() => (window as unknown as { __leaked: number }).__leaked)).toBe(0);
      await shot(page, `${vp.name}-error-missing-key`);
    });
  });
}
