// @vitest-environment jsdom
/**
 * Under <StrictMode> React runs the init effect setup → cleanup → setup. An
 * "already initialized" guard that survived the cleanup made the second setup
 * return early while the first setup's `isMounted = false` dropped the Maps
 * load, so with a key at mount Street View never initialized in `npm start`.
 */
import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeWindowProperty } from '../debug/globals';

const maps = vi.hoisted(() => ({ load: vi.fn(() => Promise.resolve()) }));
vi.mock('../services/maps/loader', () => ({
    loadMapsApi: maps.load,
    removeFailedBootstrap: vi.fn(),
}));

import StreetView from './StreetView';

const panoramaCtor = vi.fn();

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    panoramaCtor.mockClear();
    maps.load.mockClear();
    class Panorama {
        constructor() {
            panoramaCtor();
        }
        addListener() {
            return { remove() {} };
        }
        getStatus() {
            return 'OK';
        }
    }
    writeWindowProperty('google', {
        maps: {
            Map: class {
                setStreetView() {}
            },
            StreetViewPanorama: Panorama,
            StreetViewStatus: { OK: 'OK' },
        },
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    writeWindowProperty('google', undefined);
});

describe('StreetView under StrictMode', () => {
    it('initializes the panorama exactly once when a key is present at mount', async () => {
        const statuses: string[] = [];
        const { unmount } = render(
            <StrictMode>
                <StreetView apiKey="test-key" onCanvasReady={() => undefined} onStatusChange={(s) => statuses.push(s)} />
            </StrictMode>,
        );
        await waitFor(() => expect(panoramaCtor).toHaveBeenCalledTimes(1));
        expect(statuses).toContain('loading-panorama');
        unmount();
    });

    it('still initializes once without StrictMode', async () => {
        const { unmount } = render(<StreetView apiKey="test-key" onCanvasReady={() => undefined} />);
        await waitFor(() => expect(panoramaCtor).toHaveBeenCalledTimes(1));
        unmount();
    });
});
