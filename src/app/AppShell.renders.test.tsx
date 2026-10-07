import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Count AppShell renders through a hook it calls exactly once per render.
const shellRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./useAppPanels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useAppPanels')>();
  return {
    ...actual,
    useAppPanels: () => {
      shellRenders.count += 1;
      return actual.useAppPanels();
    },
  };
});

// Heavy / WebGPU / Maps-bound children are irrelevant to the shell's own render count.
vi.mock('./shell/ConnectedChrome', () => ({ ConnectedChrome: () => null }));
vi.mock('./shell/CinemaLayer', () => ({ CinemaLayer: () => null }));
vi.mock('./shell/StreetViewStage', () => ({ StreetViewStage: () => null }));
vi.mock('./shell/ShellNotices', () => ({ ShellNotices: () => null }));
vi.mock('../components/WelcomeModal', () => ({ default: () => null }));
vi.mock('../components/BuildBadge', () => ({ default: () => null }));

import { AppProviders } from './AppProviders';
import { AppShell } from './AppShell';
import { povStore } from '../state/povStore';

describe('AppShell render isolation from hot POV state', () => {
  beforeEach(() => {
    shellRenders.count = 0;
    povStore.reset();
  });

  async function mountShell() {
    await act(async () => {
      render(
        <AppProviders>
          <AppShell />
        </AppProviders>,
      );
    });
    return shellRenders.count;
  }

  it('100 POV writes (heading/pitch/zoom/carHeading) cause 0 AppShell renders', async () => {
    const baseline = await mountShell();
    expect(baseline).toBeGreaterThan(0);

    act(() => {
      for (let i = 0; i < 100; i++) {
        povStore.setHeading((h) => h + 0.5);
        povStore.setPitch((p) => p + (i % 2 ? 0.1 : -0.1));
        povStore.setZoom((z) => z + 0.001);
        povStore.setCarHeading((c) => c + 0.2);
      }
    });

    expect(povStore.get().heading).toBeCloseTo(34 + 50, 5);
    expect(shellRenders.count).toBe(baseline);
  });

  it('a real head-look drag through CarInputHandler also leaves the shell untouched', async () => {
    await mountShell();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { default: CarInputHandler } = await import('../components/CarInputHandler');
    const { useStreetView } = await import('../hooks/useStreetView');
    const { useViewMode } = await import('../hooks/useViewMode');

    // A second consumer of the same contexts the shell reads — if POV leaked into
    // either context value, this probe (and the shell) would re-render per move.
    let probeRenders = 0;
    function Probe() {
      useStreetView();
      useViewMode();
      probeRenders += 1;
      return null;
    }
    const targetRef = { current: container };

    await act(async () => {
      render(
        <AppProviders>
          <Probe />
          <CarInputHandler targetRef={targetRef} />
        </AppProviders>,
      );
    });
    const probeBaseline = probeRenders;
    const baseline = shellRenders.count; // after mounting settles; the drag must add nothing
    const before = povStore.get().heading;

    act(() => {
      container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
      for (let i = 0; i < 100; i++) {
        const e = new MouseEvent('mousemove', { bubbles: true, buttons: 1 });
        Object.defineProperty(e, 'movementX', { value: 4 });
        Object.defineProperty(e, 'movementY', { value: 1 });
        window.dispatchEvent(e);
      }
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });

    expect(povStore.get().heading).not.toBe(before); // the drag really moved the view
    expect(probeRenders).toBe(probeBaseline);
    expect(shellRenders.count).toBe(baseline);
    container.remove();
  });
});
