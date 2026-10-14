// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SceneDepthControl from './SceneDepthControl';
import { sceneDepthStore } from '../state/sceneDepthStore';
import { resetSceneDepthStats, setSceneDepthStats } from '../renderer/depth/sceneDepthStatsStore';

function atQuality(quality: string) {
    window.history.replaceState(null, '', `/?quality=${quality}`);
}

beforeEach(() => {
    localStorage.clear();
    sceneDepthStore.resetForTests();
    resetSceneDepthStats();
    atQuality('high');
});

afterEach(() => {
    window.history.replaceState(null, '', '/');
});

describe('Scene depth toggle', () => {
    it('is off by default and names the one-time download', () => {
        render(<SceneDepthControl />);
        const toggle = screen.getByTestId('scene-depth-toggle');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(toggle.textContent).toMatch(/downloads ~\d+ MB once/);
    });

    it('opting in persists and flips the store the render loop reads', () => {
        render(<SceneDepthControl />);
        fireEvent.click(screen.getByTestId('scene-depth-toggle'));
        expect(sceneDepthStore.get().enabled).toBe(true);
        expect(localStorage.getItem('streetview.sceneDepth')).toBe('1');
        expect(screen.getByTestId('scene-depth-toggle')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText(/Apache-2\.0/)).toBeInTheDocument();
    });

    it('?depth=on wins at boot, and the panel can still turn it off', () => {
        window.history.replaceState(null, '', '/?quality=ultra&depth=on');
        sceneDepthStore.resetForTests();
        render(<SceneDepthControl />);
        expect(screen.getByTestId('scene-depth-toggle')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('scene-depth-toggle'));
        expect(sceneDepthStore.get().enabled).toBe(false);
    });

    it('is disabled below High quality, where the preset gives depth no weight', () => {
        atQuality('medium');
        render(<SceneDepthControl />);
        expect(screen.getByTestId('scene-depth-toggle')).toBeDisabled();
        expect(screen.getByRole('status').textContent).toMatch(/High or Ultra/);
    });

    it('shows download progress, then readiness, or an honest failure', () => {
        sceneDepthStore.setEnabled(true);
        render(<SceneDepthControl />);
        act(() => setSceneDepthStats({ state: 'loading', downloadedBytes: 5e6, downloadTotal: 20e6 }));
        expect(screen.getByRole('status').textContent).toMatch(/25%/);
        act(() => setSceneDepthStats({ state: 'ready', variant: 'q4f16', inferenceMs: 41.6, fromCache: true }));
        expect(screen.getByRole('status').textContent).toMatch(/42 ms per map · model cached/);
        expect(screen.getByTestId('scene-depth-toggle').textContent).not.toMatch(/~/);
        act(() => setSceneDepthStats({ state: 'failed', reason: 'scene-depth model not deployed (HTTP 404)' }));
        expect(screen.getByRole('status').textContent).toMatch(/unavailable — scene-depth model not deployed/);
    });
});
