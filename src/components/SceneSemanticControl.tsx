import React from 'react';
import { getActiveQualityLevel, PRESETS } from '../config/visualPresets';
import { formatMegabytes, SEMANTIC_MODEL_BYTES, SEMANTIC_MODEL_LICENSE, SEMANTIC_MODEL_NAME, useSceneSemanticStats } from '../renderer';
import { sceneSemanticStore, useSceneSemanticOptIn, useSceneDepthOptIn } from '../state';

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
 * "Scene understanding" opt-in for the weather panel (#352): a street
 * segmenter beside scene depth, so rain spares the sky, only the road gets
 * wet, snow settles on the ground, the sky itself changes with the weather
 * and night lights windows and the road. It shares the depth pipeline, so it
 * needs scene depth on; the download size is on the button.
 */
const SceneSemanticControl: React.FC = () => {
    const enabled = useSceneSemanticOptIn((s) => s.enabled);
    const depthOn = useSceneDepthOptIn((s) => s.enabled);
    const state = useSceneSemanticStats((s) => s.state);
    const reason = useSceneSemanticStats((s) => s.reason);
    const fromCache = useSceneSemanticStats((s) => s.fromCache);
    const downloaded = useSceneSemanticStats((s) => s.downloadedBytes);
    const total = useSceneSemanticStats((s) => s.downloadTotal);
    const inferenceMs = useSceneSemanticStats((s) => s.inferenceMs);

    const quality = getActiveQualityLevel();
    const supported = PRESETS[quality].semanticBlend > 0;
    const usable = supported && depthOn;

    let line = '';
    if (!supported) {
        line = `Needs High or Ultra quality (now ${PRESETS[quality].name}).`;
    } else if (enabled && !depthOn) {
        line = 'Needs scene depth on — it runs in the same pipeline.';
    } else if (enabled) {
        if (state === 'loading') {
            line = total > 0
                ? `Downloading the street model… ${Math.round((downloaded / total) * 100)}%`
                : 'Loading the street model…';
        } else if (state === 'failed') {
            line = `Scene understanding unavailable — ${reason ?? 'error'}. Effects keep their usual look.`;
        } else if (state === 'ready') {
            line = `Sky, road and buildings told apart${inferenceMs != null ? ` · ${Math.round(inferenceMs)} ms per map` : ''}`
                + `${fromCache ? ' · model cached' : ''}`;
        }
    }

    return (
        <div style={{ marginBottom: 18 }}>
            <button
                type="button"
                aria-pressed={enabled && usable}
                disabled={!supported}
                onClick={() => sceneSemanticStore.setEnabled(!enabled)}
                style={pill(enabled && usable, !supported)}
                data-testid="scene-semantic-toggle"
                title={`${SEMANTIC_MODEL_NAME} (${SEMANTIC_MODEL_LICENSE}) runs on your GPU; nothing leaves the browser.`}
            >
                🏙️ Scene understanding (downloads {formatMegabytes(SEMANTIC_MODEL_BYTES)} once)
            </button>
            {line && (
                <div
                    role="status"
                    style={{ color: state === 'failed' || (enabled && !depthOn) ? '#ffb74d' : '#9ec9e2', fontSize: 12, marginTop: 6 }}
                >
                    {line}
                </div>
            )}
        </div>
    );
};

export default SceneSemanticControl;
