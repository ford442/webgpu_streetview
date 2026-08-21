import { expect, type Page } from '@playwright/test';

export const hasMapsKey = Boolean(
  process.env.REACT_APP_MAPS_API_KEY &&
    !/placeholder|your_|replace|example/i.test(process.env.REACT_APP_MAPS_API_KEY),
);

export async function dismissWelcome(page: Page): Promise<void> {
  const start = page.getByRole('button', { name: /Start Exploring/i });
  if (await start.isVisible({ timeout: 5000 }).catch(() => false)) {
    await start.click();
    await expect(page.getByRole('dialog', { name: /1ink\.us Streetview/i })).toHaveCount(0, {
      timeout: 10_000,
    });
    return;
  }
  await page.keyboard.press('Escape').catch(() => undefined);
}

export async function gotoApp(page: Page, path = '/'): Promise<void> {
  const uncaught: string[] = [];
  page.on('pageerror', (err) => uncaught.push(String(err)));
  (page as Page & { __uncaught?: string[] }).__uncaught = uncaught;

  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('#root', { timeout: 30_000 });
}

export function getUncaught(page: Page): string[] {
  return (page as Page & { __uncaught?: string[] }).__uncaught ?? [];
}

export async function openBookmarkPanel(page: Page): Promise<void> {
  const panelTitle = page.getByRole('heading', { name: /Bookmarks/i });
  if (await panelTitle.isVisible().catch(() => false)) return;
  await page.getByRole('button', { name: /Bookmarks/i }).click();
  await expect(panelTitle).toBeVisible();
}

declare global {
  interface Window {
    __STREETVIEW_PROBE__?: {
      getTimeline: () => Array<{
        armedAt: number;
        firstStableAt: number | null;
        releasedAt: number | null;
        holdDurationMs: number | null;
      }>;
      getWarnings: () => Array<{ at: number; message: string }>;
      clear: () => void;
      enablePixelWatch: () => void;
    };
    rendererType?: 'webgpu' | 'webgl';
    usingWebGPU?: boolean;
    usingWebGL?: boolean;
    webgpuProbe?: {
      ok: boolean;
      stage: string;
      reason: string;
      browserBrand: string;
      webglPreferenceDeferred?: boolean;
    };
  }
}
