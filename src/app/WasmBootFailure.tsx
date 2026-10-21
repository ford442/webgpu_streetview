import React, { useEffect } from 'react';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { publishWebGpuProbe } from '../renderer/webgpuBootProbe';
import { WEBGPU_FAILURE_USER_MESSAGE } from '../utils/scraperHealth';

/**
 * What src/index.tsx renders instead of the app when the WASM numeric layer
 * does not load. The app cannot run without it — its geodesy/angle helpers
 * call `requireWasm()` from the first effect — so this is the whole page: the
 * same blocking overlay a failed renderer boot shows, and `webgpuProbe` at
 * stage `wasm`, exactly what `Renderer.init` reports for the same failure.
 */
export function WasmBootFailure({ reason }: { reason: string }): React.ReactElement {
  useEffect(() => {
    publishWebGpuProbe({ ok: false, stage: 'wasm', reason });
  }, [reason]);
  return (
    <LoadingOverlay
      isVisible
      message=""
      error={`${WEBGPU_FAILURE_USER_MESSAGE} (${reason})`}
      retryable
      onRetry={() => window.location.reload()}
    />
  );
}
