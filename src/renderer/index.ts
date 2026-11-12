/**
 * Public entry of `src/renderer/`: what higher layers (car, ui) may import.
 * Everything else in the folder is internal — `scripts/check-architecture.mjs` (dependency-cruiser rule
 * `only-through-entry`) fails a deeper import. Keep it a pure re-export list: no logic, no side effects.
 */
export { getAutoExposureStatus, nextAutoExposureEnabled } from './autoExposure';
export type { AutoExposureEvent, AutoExposureStatus } from './autoExposure';
export { needsCabinOverlayLatch } from './cabinComposite';
export type { CabinOverlayLayout, CabinOverlaySource } from './cabinComposite';
export { publishCabinOverlaySource } from './cabinOverlayRegistry';
export { getCabinStereoRequest } from './cabinStereoRequest';
export type { CabinStereoRequest } from './cabinStereoRequest';
export { publishCameraSpeed } from './cameraMotionSignal';
export { isCinematicQuality, prefersReducedMotion } from './cinematicCameraFx';
export { createStreetViewRenderer } from './createStreetViewRenderer';
export { DEPTH_MODEL_LICENSE, DEPTH_MODEL_NAME, depthDownloadBytes, formatMegabytes } from './depth/depthModel';
export { useSceneDepthStats } from './depth/sceneDepthStatsStore';
export type { SceneDepthStats } from './depth/sceneDepthStatsStore';
export type { AdapterCapabilitySummary } from './deviceCapabilities';
export { clampTextureSize } from './deviceInit';
export { DeviceLossRecovery } from './deviceLossRecovery';
export { FrameDriver } from './frameDriver';
export { mapsCanvasSource } from './frameSource/mapsCanvasSource';
export type { FrameSourceStats } from './frameSource/mapsCanvasSource';
export { getGpuChoresStats } from './gpuChores/gpuChoresStatsStore';
export type { GpuChoresBreadcrumbs, GpuChoresStats } from './gpuChores/gpuChoresStatsStore';
export { exposureHintFromMeanLuma } from './gpuChores/lumaMath';
export { makePickerThumbDataUrl } from './gpuChores/pickerThumb';
export { getGpuPassTimings, setGpuPassTimingsWanted } from './gpuPassTimingStore';
export type { GpuPassTimings } from './gpuPassTimingStore';
export { estimateTextureBytes } from './gpuTextureBytes';
export { HISTORICAL_WIPE_DURATION_MS, isReducedMotionRequested, resolveHistoricalReveal, wipeDirectionForHop, wipeProgressAt } from './historicalWipe';
export type { HistoricalReveal } from './historicalWipe';
export { fetchLookLutVolume } from './lut';
export { perfStore, useFrameRateStats } from './perfStore';
export type { FrameRateStats } from './perfStore';
export { releaseGlContext } from './releaseGlContext';
export { getAdapterPowerPreferencePolicy, retryWebGpuBackend, wantsGpuFeatureDump } from './RendererBackend';
export type { RendererDebugHandle, StreetViewRenderer } from './RendererBackend';
export { getAppliedRenderScale } from './renderScale';
export type { AppliedRenderScale } from './renderScale';
export { frameTailScheduler } from './reproject/frameTail';
export { clearLateLatchStats, getLateLatchStats } from './reproject/presentTail';
export type { LateLatchStats } from './reproject/presentTail';
export { getRoadFrameSource } from './roadFrameRegistry';
export type { RoadHdrFrame } from './roadFrameRegistry';
export { useSceneSemanticStats } from './semantic/sceneSemanticStatsStore';
export type { SceneSemanticStats } from './semantic/sceneSemanticStatsStore';
export { SEMANTIC_MODEL_BYTES, SEMANTIC_MODEL_LICENSE, SEMANTIC_MODEL_NAME } from './semantic/semanticModel';
export type { RendererBackendType } from './types';
export { NoiseTileFeeder, getNoiseTilePreference } from './weatherNoiseTile';
export { ParticleSeedFeeder, getParticleSeedPreference } from './weatherParticleSeeds';
export { WEBGL2_FALLBACK_ACTIVE_MESSAGE, WEBGPU_REQUIRED_MESSAGE } from './webgl2FallbackMessages';
export { isWebGpuProbeOk, publishWebGpuProbe } from './webgpuBootProbe';
export type { WebGpuProbeRecord } from './webgpuBootProbe';
export { getXrPresentedFrames, isXrPresenting } from './xrPresentFrame';
