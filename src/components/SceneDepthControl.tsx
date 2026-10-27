import React from 'react';
import { getActiveQualityLevel, PRESETS } from '../config/visualPresets';
import {
    DEPTH_MODEL_LICENSE,
    DEPTH_MODEL_NAME,
    depthDownloadBytes,
    formatMegabytes,
} from '../renderer/depth/depthModel';
import { useSceneDepthStats } from '../renderer/depth/sceneDepthStatsStore';
import { sceneDepthStore, useSceneDepthOptIn } from '../state/sceneDepthStore';

const pill = (active: boolean, disabled: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid #2a4a6a',
    background: active ? 'rgba(79,195,247,0.25)' : 'rgba(255,255,255,0.06)',
    color: disabled ? '#777' : '#fff',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 12,
});

/**
 * "Scene depth" opt-in for the weather panel (#320): a monocular depth model
 * that makes fog, rain, depth of field and the hop dolly follow the street's
 * real shape. Opt-in because it downloads the model once; the size is on the
 * button, and the quality presets below High give it no weight at all.
 */
const SceneDepthControl: React.FC = () => {
    const enabled = useSceneDepthOptIn((s) => s.enabled);
    const state = useSceneDepthStats((s) => s.state);
    const reason = useSceneDepthStats((s) => s.reason);
    const variant = useSceneDepthStats((s) => s.variant);
    const fromCache = useSceneDepthStats((s) => s.fromCache);
    const downloaded = useSceneDepthStats((s) => s.downloadedBytes);
    const total = useSceneDepthStats((s) => s.downloadTotal);
    const inferenceMs = useSceneDepthStats((s) => s.inferenceMs);

    const quality = getActiveQualityLevel();
    const supported = PRESETS[quality].depthBlend > 0;
    const size = variant
        ? formatMegabytes(depthDownloadBytes(variant))
        : `~${formatMegabytes(depthDownloadBytes('q4f16'))}`;

    let line = '';
    if (!supported) {
        line = `Needs High or Ultra quality (now ${PRESETS[quality].name}).`;
    } else if (enabled) {
        if (state === 'loading') {
            line = total > 0
                ? `Downloading the depth model… ${Math.round((downloaded / total) * 100)}%`
                : 'Loading the depth model…';
        } else if (state === 'failed') {
            line = `Scene depth unavailable — ${reason ?? 'error'}. Effects use the horizon estimate.`;
        } else if (state === 'ready') {
            line = `Depth-aware fog, rain and focus${inferenceMs != null ? ` · ${Math.round(inferenceMs)} ms per map` : ''}`
                + `${fromCache ? ' · model cached' : ''}`;
        }
    }

    return (
        <div style={{ marginBottom: 18 }}>
            <button
                type="button"
                aria-pressed={enabled && supported}
                disabled={!supported}
                onClick={() => sceneDepthStore.setEnabled(!enabled)}
                style={pill(enabled && supported, !supported)}
                data-testid="scene-depth-toggle"
                title={`${DEPTH_MODEL_NAME} (${DEPTH_MODEL_LICENSE}) runs on your GPU; nothing leaves the browser.`}
            >
                🧊 Scene depth (downloads {size} once)
            </button>
            {line && (
                <div
                    role="status"
                    style={{ color: state === 'failed' ? '#ffb74d' : '#9ec9e2', fontSize: 12, marginTop: 6 }}
                >
                    {line}
                </div>
            )}
            {enabled && supported && (
                <div style={{ color: '#777', fontSize: 11, marginTop: 4 }}>
                    {DEPTH_MODEL_NAME} ({DEPTH_MODEL_LICENSE}) on your GPU — the frame never leaves the browser.
                </div>
            )}
        </div>
    );
};

export default SceneDepthControl;
