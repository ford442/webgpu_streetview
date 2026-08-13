import { describe, expect, it } from 'vitest';
import { PlaceSearchBudget, PLACE_SEARCH_DEFAULTS } from './placeSearchBudget';

describe('PlaceSearchBudget', () => {
  it('blocks nearby until the opt-in toggle is on', () => {
    const budget = new PlaceSearchBudget();
    expect(budget.allow('nearby')).toEqual({ ok: false, reason: 'nearby-off' });
    expect(budget.getStats().blockedSkips).toBe(1);
    expect(budget.getStats().networkRequests).toBe(0);

    budget.setNearbyEnabled(true);
    expect(budget.allow('nearby')).toEqual({ ok: true });
  });

  it('allows autocomplete without nearby opt-in', () => {
    const budget = new PlaceSearchBudget();
    expect(budget.allow('autocomplete')).toEqual({ ok: true });
  });

  it('enforces a hard session ceiling', () => {
    const budget = new PlaceSearchBudget({ maxSessionRequests: 2 });
    expect(budget.allow('geocode').ok).toBe(true);
    budget.recordSuccess('geocode');
    expect(budget.allow('geocode').ok).toBe(true);
    budget.recordSuccess('geocode');
    expect(budget.allow('geocode')).toEqual({ ok: false, reason: 'budget-exhausted' });
    expect(budget.getStats().budgetRemaining).toBe(0);
  });

  it('kill switch is permanent for the instance', () => {
    const budget = new PlaceSearchBudget();
    budget.setNearbyEnabled(true);
    budget.kill();
    expect(budget.allow('autocomplete')).toEqual({ ok: false, reason: 'killed' });
    expect(budget.allow('nearby')).toEqual({ ok: false, reason: 'killed' });
    expect(budget.getStats().killed).toBe(true);
  });

  it('throttles nearby batches but can skip intra-batch throttle', () => {
    let now = 1000;
    const budget = new PlaceSearchBudget({
      nearbyMinIntervalMs: 4000,
      now: () => now,
    });
    budget.setNearbyEnabled(true);
    expect(budget.allow('nearby').ok).toBe(true);
    budget.recordSuccess('nearby');
    expect(budget.allow('nearby')).toEqual({ ok: false, reason: 'throttled' });
    expect(budget.allow('nearby', { skipThrottle: true }).ok).toBe(true);
    now += PLACE_SEARCH_DEFAULTS.nearbyMinIntervalMs;
    expect(budget.allow('nearby').ok).toBe(true);
  });

  it('trips error backoff after consecutive failures', () => {
    const budget = new PlaceSearchBudget({ maxConsecutiveErrors: 2 });
    budget.recordError('autocomplete');
    budget.recordError('autocomplete');
    expect(budget.allow('autocomplete')).toEqual({ ok: false, reason: 'error-backoff' });
  });
});
