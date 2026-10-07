import { MapsCallBudget, getMapsCallBudget, resetMapsCallBudgetForTests } from './callBudget';
import { PlaceSearchBudget } from '../../search/placeSearchBudget';

describe('MapsCallBudget', () => {
  afterEach(() => resetMapsCallBudgetForTests());

  it('counts by kind and by source, and refuses past the cap', () => {
    const meter = new MapsCallBudget({ panorama: 2 });
    expect(meter.tryConsume('panorama', 'route-resnap')).toBe(true);
    expect(meter.tryConsume('panorama', 'teleport-prefetch')).toBe(true);
    expect(meter.tryConsume('panorama', 'route-resnap')).toBe(false);
    const stats = meter.getStats();
    expect(stats.byKind.panorama).toEqual({ used: 2, cap: 2, remaining: 0, blocked: 1 });
    expect(stats.bySource).toEqual({ 'route-resnap': 1, 'teleport-prefetch': 1 });
    expect(stats.total).toBe(2);
  });

  it('Google Directions is capped at zero until it is deliberately enabled', () => {
    expect(new MapsCallBudget().tryConsume('directions', 'directions')).toBe(false);
  });

  it('counts place-search calls without capping them (their own budget caps)', () => {
    resetMapsCallBudgetForTests();
    const places = new PlaceSearchBudget();
    places.recordSuccess('autocomplete');
    places.recordError('geocode');
    const stats = getMapsCallBudget().getStats();
    expect(stats.byKind.placeSearch).toMatchObject({ used: 2, cap: null, remaining: null });
    expect(stats.bySource).toMatchObject({ autocomplete: 1, geocode: 1 });
  });
});
