import { describe, expect, it } from 'vitest';
import { getVehicleConfig, isValidVehicleType, VEHICLES } from '../VehicleManager';
import { CORTIANICS_ACCENT } from '../variants/CortianicsMode';

describe('cortianics vehicle', () => {
  it('is a registered vehicle type with luxury sport layout', () => {
    expect(isValidVehicleType('cortianics')).toBe(true);
    const cfg = getVehicleConfig('cortianics');
    expect(cfg.name).toBe('Cortianics GT');
    expect(cfg.seatCount).toBe(4);
    expect(cfg.hasRoof).toBe(true);
    expect(cfg.hasGauges).toBe(true);
    expect(cfg.accentColor).toBe(CORTIANICS_ACCENT);
    expect(cfg.dashboardLayout).toBe('luxury');
    expect(VEHICLES.cortianics.features).toContain('Panoramic glass roof');
    expect(VEHICLES.cortianics.features).toContain('Red night ambient strip');
  });
});
