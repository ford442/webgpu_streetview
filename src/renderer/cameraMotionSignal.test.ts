import {
    publishCameraSpeed,
    getCameraSpeedNormalized,
    resetCameraSpeed,
    MOTION_SIGNAL_MAX_KMH,
    MOTION_SIGNAL_STALE_MS,
} from './cameraMotionSignal';

describe('cameraMotionSignal', () => {
    beforeEach(() => resetCameraSpeed());

    it('reads zero before anything is published', () => {
        expect(getCameraSpeedNormalized()).toBe(0);
    });

    it('normalizes published speed against the max', () => {
        publishCameraSpeed(MOTION_SIGNAL_MAX_KMH / 2, 1000);
        expect(getCameraSpeedNormalized(1000)).toBeCloseTo(0.5);
    });

    it('clamps above the max', () => {
        publishCameraSpeed(MOTION_SIGNAL_MAX_KMH * 3, 1000);
        expect(getCameraSpeedNormalized(1000)).toBe(1);
    });

    it('decays to zero once the publisher goes quiet', () => {
        publishCameraSpeed(MOTION_SIGNAL_MAX_KMH, 1000);
        expect(getCameraSpeedNormalized(1000 + MOTION_SIGNAL_STALE_MS - 1)).toBe(1);
        expect(getCameraSpeedNormalized(1000 + MOTION_SIGNAL_STALE_MS + 1)).toBe(0);
    });

    it('ignores negative and non-finite speeds', () => {
        publishCameraSpeed(-40, 1000);
        expect(getCameraSpeedNormalized(1000)).toBe(0);
        publishCameraSpeed(Number.NaN, 1000);
        expect(getCameraSpeedNormalized(1000)).toBe(0);
    });

    it('resets immediately on request', () => {
        publishCameraSpeed(MOTION_SIGNAL_MAX_KMH, 1000);
        resetCameraSpeed();
        expect(getCameraSpeedNormalized(1000)).toBe(0);
    });
});
