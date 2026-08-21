/**
 * WebGPU boot-probe record for DevTools / Playwright / #216 chore gates.
 * Written on both success and failure; WebGL weather is not a rescue path.
 */

import type { RendererBackendPreference } from './RendererBackend';
import type { DeviceCapabilityMatrix } from './deviceCapabilities';

export type WebGpuProbeStage =
  | 'navigator'
  | 'adapter'
  | 'limits'
  | 'device'
  | 'canvas'
  | 'compute'
  | 'ok';

export type BrowserBrand = 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Other';

export interface WebGpuProbeAdapterInfo {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

export interface WebGpuProbeRecord {
  ok: boolean;
  stage: WebGpuProbeStage;
  reason: string;
  browserBrand: BrowserBrand;
  preference: RendererBackendPreference;
  /** True when URL/localStorage asked for webgl; GL weather is deferred this phase. */
  webglPreferenceDeferred: boolean;
  adapter?: WebGpuProbeAdapterInfo;
  capabilityMatrix?: DeviceCapabilityMatrix;
  updatedAt: number;
}

export function detectBrowserBrand(
  nav: Pick<Navigator, 'userAgent'> & {
    userAgentData?: { brands?: Array<{ brand: string; version: string }> };
  } = typeof navigator !== 'undefined' ? navigator : { userAgent: '' },
): BrowserBrand {
  const brands = nav.userAgentData?.brands;
  if (brands?.length) {
    const names = brands.map((b) => b.brand.toLowerCase());
    // Prefer Edge over Chromium when both appear in the brand list.
    if (names.some((n) => n.includes('microsoft edge') || n === 'edge')) return 'Edge';
    if (names.some((n) => n.includes('google chrome') || n === 'chrome')) return 'Chrome';
    if (names.some((n) => n.includes('firefox'))) return 'Firefox';
    if (names.some((n) => n.includes('safari'))) return 'Safari';
  }

  const ua = nav.userAgent || '';
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) return 'Chrome';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  return 'Other';
}

export function adapterInfoFromGpuAdapter(adapter: GPUAdapter): WebGpuProbeAdapterInfo {
  const info = (adapter as GPUAdapter & {
    info?: { vendor?: string; architecture?: string; device?: string; description?: string };
  }).info;
  return {
    vendor: info?.vendor || 'unknown',
    architecture: info?.architecture || 'unknown',
    device: info?.device || 'unknown',
    description: info?.description || 'unknown',
  };
}

export interface PublishWebGpuProbeOptions {
  ok: boolean;
  stage: WebGpuProbeStage;
  reason?: string;
  preference?: RendererBackendPreference;
  webglPreferenceDeferred?: boolean;
  adapter?: WebGpuProbeAdapterInfo;
  capabilityMatrix?: DeviceCapabilityMatrix;
  browserBrand?: BrowserBrand;
  now?: number;
}

/** Build a probe record and publish it to `window.webgpuProbe` when in a browser. */
export function publishWebGpuProbe(options: PublishWebGpuProbeOptions): WebGpuProbeRecord {
  const previous =
    typeof window !== 'undefined'
      ? (window as Window & { webgpuProbe?: WebGpuProbeRecord }).webgpuProbe
      : undefined;

  const record: WebGpuProbeRecord = {
    ok: options.ok,
    stage: options.stage,
    reason: options.reason ?? '',
    browserBrand: options.browserBrand ?? detectBrowserBrand(),
    preference: options.preference ?? previous?.preference ?? 'auto',
    webglPreferenceDeferred:
      options.webglPreferenceDeferred ?? previous?.webglPreferenceDeferred ?? false,
    adapter: options.adapter ?? previous?.adapter,
    capabilityMatrix: options.capabilityMatrix ?? previous?.capabilityMatrix,
    updatedAt: options.now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  };

  if (typeof window !== 'undefined') {
    (window as Window & { webgpuProbe?: WebGpuProbeRecord }).webgpuProbe = record;
  }
  return record;
}

/** #216 / chore gate: only share the Renderer device when the boot probe succeeded. */
export function isWebGpuProbeOk(
  win: { webgpuProbe?: WebGpuProbeRecord } | undefined = typeof window !== 'undefined' ? window : undefined,
): boolean {
  return win?.webgpuProbe?.ok === true;
}
