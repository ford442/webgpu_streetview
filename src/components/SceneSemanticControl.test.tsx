// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SceneSemanticControl from './SceneSemanticControl';
import { sceneSemanticStore } from '../state/sceneSemanticStore';
import { sceneDepthStore } from '../state/sceneDepthStore';
import { resetSceneSemanticStats, setSceneSemanticStats } from '../renderer/semantic/sceneSemanticStatsStore';

function atQuality(quality: string) {
    window.history.replaceState(null, '', `/?quality=${quality}`);
}

beforeEach(() => {
    localStorage.clear();
    sceneSemanticStore.resetForTests();
    sceneDepthStore.resetForTests({ enabled: true, fromUrl: false });
    resetSceneSemanticStats();
    atQuality('high');
});

afterEach(() => {
    window.history.replaceState(null, '', '/');
});

describe('Scene understanding toggle', () => {
    it('is off by default and names the one-time download', () => {
        render(<SceneSemanticControl />);
        const toggle = screen.getByTestId('scene-semantic-toggle');
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(toggle.textContent).toMatch(/downloads \d+ MB once/);
    });

    it('persists the opt-in and shows progress, then ready', () => {
        render(<SceneSemanticControl />);
        fireEvent.click(screen.getByTestId('scene-semantic-toggle'));
        expect(sceneSemanticStore.get().enabled).toBe(true);
        expect(localStorage.getItem('streetview.sceneSemantic')).toBe('1');
        act(() => setSceneSemanticStats({ state: 'loading', downloadedBytes: 50, downloadTotal: 100 }));
        expect(screen.getByRole('status').textContent).toMatch(/50%/);
        act(() => setSceneSemanticStats({ state: 'ready', inferenceMs: 31 }));
        expect(screen.getByRole('status').textContent).toMatch(/31 ms per map/);
    });

    it('says it needs scene depth when depth is off', () => {
        sceneDepthStore.resetForTests({ enabled: false, fromUrl: false });
        sceneSemanticStore.resetForTests({ enabled: true, fromUrl: false });
        render(<SceneSemanticControl />);
        expect(screen.getByRole('status').textContent).toMatch(/Needs scene depth on/);
        expect(screen.getByTestId('scene-semantic-toggle')).toHaveAttribute('aria-pressed', 'false');
    });

    it('is disabled below High quality', () => {
        atQuality('medium');
        render(<SceneSemanticControl />);
        expect(screen.getByTestId('scene-semantic-toggle')).toBeDisabled();
        expect(screen.getByRole('status').textContent).toMatch(/Needs High or Ultra/);
    });
});
