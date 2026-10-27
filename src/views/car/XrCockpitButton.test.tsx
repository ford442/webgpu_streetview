// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { detectXrSupport, resetXrSupportForTests, xrSupport } from '../../xr/xrSupport';
import { XrCockpitButton, xrButtonView } from './XrCockpitButton';

afterEach(() => resetXrSupportForTests());

describe('Enter VR button (#331)', () => {
    it('is hidden without WebXR (or with ?xr=off), and before boot has looked', () => {
        expect(xrButtonView(null, true, false, null).hidden).toBe(true);
        expect(xrButtonView(xrSupport('no-webxr'), true, false, null).hidden).toBe(true);
        expect(xrButtonView(xrSupport('off'), true, false, null).hidden).toBe(true);
    });

    it('says why it cannot enter instead of doing nothing', () => {
        const binding = xrButtonView(xrSupport('no-webgpu-binding'), true, false, null);
        expect(binding).toMatchObject({ hidden: false, disabled: true });
        expect(binding.reason).toMatch(/Needs WebGPU-XR/);
        expect(xrButtonView(xrSupport('no-immersive-vr'), true, false, null).reason).toMatch(/No VR headset/);
        expect(xrButtonView(xrSupport('available'), false, false, null).reason).toMatch(/WebGPU renderer/);
    });

    it('enters when available and exits while presenting', () => {
        expect(xrButtonView(xrSupport('available'), true, false, null)).toMatchObject({ disabled: false, label: 'Enter VR' });
        expect(xrButtonView(xrSupport('available'), true, true, null)).toMatchObject({ disabled: false, label: 'Exit VR' });
        expect(xrButtonView(xrSupport('available'), true, false, 'denied').reason).toBe('denied');
    });

    it('renders the reason next to a disabled button', async () => {
        await detectXrSupport({ xr: { isSessionSupported: async () => true }, hasBinding: false, off: false });
        render(<XrCockpitButton device={{} as GPUDevice} pressAlongRay={undefined} />);
        const button = screen.getByRole('button', { name: 'Enter VR' });
        expect(button).toHaveProperty('disabled', true);
        expect(screen.getByRole('note').textContent).toMatch(/webxr-webgpu-binding/);
    });

    it('renders nothing on a browser without WebXR', async () => {
        await detectXrSupport({ xr: undefined, hasBinding: false, off: false });
        const { container } = render(<XrCockpitButton device={{} as GPUDevice} pressAlongRay={undefined} />);
        expect(container.innerHTML).toBe('');
    });
});
