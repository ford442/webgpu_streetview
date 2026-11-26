import React, { useEffect } from 'react';
import { LoadingOverlay } from '../components/LoadingOverlay';
import { publishWebGpuProbe } from '../renderer';
import { WEBGPU_FAILURE_USER_MESSAGE, WEBGPU_RECOVERY_HINT } from '../debug/scraperHealth';

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
      errorTitle="The app could not start"
      errorHint={WEBGPU_RECOVERY_HINT}
      retryLabel="Reload"
      retryable
      onRetry={() => window.location.reload()}
    />
  );
}
