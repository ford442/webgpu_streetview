import { describe, expect, it } from 'vitest';
import {
  CANVAS_TAKEOVER_AREA_RATIO,
  CANVAS_TAKEOVER_CONFIRM_MS,
  createTakeoverState,
  selectLargestCanvas,
  selectSourceCanvas,
} from '../streetViewCanvasSelect';

const MIN_EDGE = 256;

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

function container(...canvases: HTMLCanvasElement[]): HTMLElement {
  const div = document.createElement('div');
  canvases.forEach((c) => div.appendChild(c));
  document.body.appendChild(div);
  return div;
}

describe('selectLargestCanvas', () => {
  it('returns nothing for an empty container', () => {
    expect(selectLargestCanvas(container())).toEqual({
      best: null,
      canvasCount: 0,
      selectedArea: 0,
    });
  });

  it('picks the largest by area and reports the count', () => {
    const small = canvas(782, 1110);
    const big = canvas(2331, 1110);
    const result = selectLargestCanvas(container(small, big));
    expect(result.best).toBe(big);
    expect(result.canvasCount).toBe(2);
    expect(result.selectedArea).toBe(2331 * 1110);
  });
});

describe('selectSourceCanvas hysteresis', () => {
  it('falls back to the largest when nothing is promoted yet', () => {
    const big = canvas(2331, 1110);
    expect(selectSourceCanvas(container(canvas(782, 1110), big), null, MIN_EDGE).best).toBe(big);
  });

  it('keeps the promoted canvas when a rival is merely larger', () => {
    // The live flap: Maps inserts a wider canvas mid-hop. 2331×1110 is only
    // ~1.13× the 2062×1110 we are scraping, so the scrape must not move.
    const active = canvas(2062, 1110);
    const rival = canvas(2331, 1110);
    const result = selectSourceCanvas(container(active, rival), active, MIN_EDGE);
    expect(result.best).toBe(active);
    expect(result.selectedArea).toBe(2062 * 1110);
    expect(result.canvasCount).toBe(2);
  });

  it('keeps the promoted canvas when the rival is the smaller one', () => {
    const active = canvas(2331, 1110);
    const rival = canvas(782, 1110);
    expect(selectSourceCanvas(container(active, rival), active, MIN_EDGE).best).toBe(active);
  });

  it('hands over when a rival clears the takeover margin', () => {
    const active = canvas(800, 600);
    const rival = canvas(Math.ceil(800 * CANVAS_TAKEOVER_AREA_RATIO) + 1, 600);
    expect(selectSourceCanvas(container(active, rival), active, MIN_EDGE).best).toBe(rival);
  });

  it('hands over when the promoted canvas is detached', () => {
    const active = canvas(2331, 1110);
    const rival = canvas(782, 1110);
    const div = container(rival);
    expect(active.isConnected).toBe(false);
    expect(selectSourceCanvas(div, active, MIN_EDGE).best).toBe(rival);
  });

  it('hands over when the promoted canvas collapses below the minimum edge', () => {
    const active = canvas(2331, 1110);
    const rival = canvas(782, 1110);
    const div = container(active, rival);
    active.width = 0;
    active.height = 0;
    expect(selectSourceCanvas(div, active, MIN_EDGE).best).toBe(rival);
  });

  it('hands over when the promoted canvas belongs to another container', () => {
    const active = canvas(2331, 1110);
    container(active);
    const rival = canvas(782, 1110);
    expect(selectSourceCanvas(container(rival), active, MIN_EDGE).best).toBe(rival);
  });
});

describe('selectSourceCanvas takeover confirmation', () => {
  it('ignores a narrower sibling during the car-mode flap', () => {
    const active = canvas(2560, 1323);
    const rival = canvas(1011, 1323);
    const takeover = createTakeoverState();
    expect(selectSourceCanvas(container(active, rival), active, MIN_EDGE, takeover, 0).best).toBe(active);
    expect(takeover.rival).toBeNull();
  });

  it('holds a ~2.5× rival until it has won for the whole confirm window', () => {
    const active = canvas(1011, 1323);
    const rival = canvas(2560, 1323);
    const div = container(active, rival);
    const takeover = createTakeoverState();

    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, 0).best).toBe(active);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, CANVAS_TAKEOVER_CONFIRM_MS - 50).best).toBe(active);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, CANVAS_TAKEOVER_CONFIRM_MS).best).toBe(rival);
    expect(takeover.rival).toBeNull();
  });

  it('restarts the window when the rival flips back mid-flap', () => {
    const active = canvas(1011, 1323);
    const rival = canvas(2560, 1323);
    const div = container(active, rival);
    const takeover = createTakeoverState();

    selectSourceCanvas(div, active, MIN_EDGE, takeover, 0);
    // The flap: the rival drops back to the promoted size for a poll.
    rival.width = 1011;
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, 100).best).toBe(active);
    expect(takeover.rival).toBeNull();
    rival.width = 2560;
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, 200).best).toBe(active);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, CANVAS_TAKEOVER_CONFIRM_MS + 100).best).toBe(active);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, CANVAS_TAKEOVER_CONFIRM_MS + 200).best).toBe(rival);
  });

  it('restarts the window when a different rival takes the lead', () => {
    const active = canvas(800, 600);
    const first = canvas(2000, 600);
    const second = canvas(2400, 600);
    const div = container(active, first);
    const takeover = createTakeoverState();

    selectSourceCanvas(div, active, MIN_EDGE, takeover, 0);
    div.appendChild(second);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, 500).best).toBe(active);
    expect(takeover.rival).toBe(second);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, CANVAS_TAKEOVER_CONFIRM_MS + 100).best).toBe(active);
    expect(selectSourceCanvas(div, active, MIN_EDGE, takeover, CANVAS_TAKEOVER_CONFIRM_MS + 500).best).toBe(second);
  });

  it('still re-acquires immediately when the promoted canvas is detached or degenerate', () => {
    const takeover = createTakeoverState();
    const rival = canvas(782, 1110);

    const detached = canvas(2331, 1110);
    expect(selectSourceCanvas(container(rival), detached, MIN_EDGE, takeover, 0).best).toBe(rival);

    const collapsed = canvas(2331, 1110);
    const other = canvas(782, 1110);
    const div = container(collapsed, other);
    collapsed.width = 0;
    expect(selectSourceCanvas(div, collapsed, MIN_EDGE, takeover, 0).best).toBe(other);

    const foreign = canvas(2331, 1110);
    container(foreign);
    const local = canvas(782, 1110);
    expect(selectSourceCanvas(container(local), foreign, MIN_EDGE, takeover, 0).best).toBe(local);
  });
});
