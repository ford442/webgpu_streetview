import { describe, expect, it } from 'vitest';
import { DASH, dashClusterNotch } from './CarInteriorDashboardBuilder';
import { resolveGaugeLayout } from '../vehicleLayout';
import { VEHICLES } from '../VehicleManager';

describe('dashClusterNotch', () => {
  const layouts = [
    ['default', resolveGaugeLayout({})] as const,
    ...Object.entries(VEHICLES)
      .filter(([, c]) => c.hasGauges)
      .map(([id, c]) => [id, resolveGaugeLayout(c)] as const),
  ];

  it.each(layouts)('%s: opens the dash face around every dial', (_id, layout) => {
    const n = dashClusterNotch(layout);
    for (const dial of [layout.speed, layout.tacho]) {
      // The cluster sits behind the dash face, so it is only visible through the notch.
      expect(dial.z).toBeLessThan(DASH.face);
      expect(dial.x - layout.dialRadius).toBeGreaterThan(n.x0);
      expect(dial.x + layout.dialRadius).toBeLessThan(n.x1);
      expect(dial.y + layout.dialRadius).toBeLessThan(n.top);
    }
  });

  it.each(layouts)('%s: leaves the block a top rail and side walls', (_id, layout) => {
    const n = dashClusterNotch(layout);
    expect(n.top).toBeLessThan(DASH.top - 0.05);
    expect(n.x0).toBeGreaterThan(-DASH.halfW);
    expect(n.x1).toBeLessThan(DASH.halfW);
  });
});
