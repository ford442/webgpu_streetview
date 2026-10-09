// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import HistoricalTimeline, { type HistoricalTimelineProps } from './HistoricalTimeline';
import type { HistoricalPanoEntry } from '../utils/historicalImagery';

const e = (panoId: string, imageDate: string): HistoricalPanoEntry => ({
  panoId, imageDate, lat: 0, lng: 0, copyright: null,
});

function renderPanel(over: Partial<HistoricalTimelineProps> = {}) {
  const props: HistoricalTimelineProps = {
    isOpen: true,
    onClose: vi.fn(),
    entries: [e('old', '2011-07'), e('now', '2023-04')],
    isLoading: false,
    error: null,
    hasTimeline: true,
    currentIndex: 1,
    isTransitioning: false,
    onSelectDate: vi.fn(),
    ...over,
  };
  render(<HistoricalTimeline {...props} />);
  return props;
}

describe('HistoricalTimeline year strip', () => {
  it('renders one chip per capture and hops on click', () => {
    const props = renderPanel();
    expect(screen.getByRole('button', { name: 'Travel to Apr 2023' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Travel to Jul 2011' }));
    expect(props.onSelectDate).toHaveBeenCalledWith(props.entries[0]);
  });

  it('does not hop to the year already on screen or while a hop is in flight', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Travel to Apr 2023' }));
    expect(props.onSelectDate).not.toHaveBeenCalled();

    const busy = renderPanel({ isTransitioning: true });
    expect(screen.getAllByRole('button', { name: 'Travel to Jul 2011' }).at(-1)).toBeDisabled();
    expect(busy.onSelectDate).not.toHaveBeenCalled();
  });

  it('shows honest single-capture copy instead of a fake strip', () => {
    renderPanel({ entries: [e('only', '2019-05')], hasTimeline: false, currentIndex: 0 });
    expect(screen.getByTestId('historical-empty')).toHaveTextContent('Google only published one capture here (May 2019)');
    expect(screen.queryByRole('group', { name: 'Capture years' })).toBeNull();
  });

  it('offers compare against other years and labels stills road-only', () => {
    const onCompare = vi.fn();
    const props = renderPanel({ onCompare });
    fireEvent.click(screen.getByRole('button', { name: 'Compare with Jul 2011' }));
    expect(onCompare).toHaveBeenCalledWith(props.entries[0]);
    expect(screen.getByText(/road view only/)).toBeInTheDocument();
  });

  it('shows the compare scope it is given (cabin included when composited)', () => {
    renderPanel({ onCompare: vi.fn(), compareScopeLabel: 'Compare stills include the cabin, as drawn in the frame.' });
    expect(screen.getByText(/include the cabin/)).toBeInTheDocument();
    expect(screen.queryByText(/road view only/)).toBeNull();
  });

  it('keeps pointer and key events off the scene', () => {
    const outer = vi.fn();
    const { container } = render(
      <div onMouseDown={outer} onKeyDown={outer}>
        <HistoricalTimeline
          isOpen onClose={vi.fn()} entries={[e('a', '2011-01'), e('b', '2020-01')]}
          isLoading={false} error={null} hasTimeline currentIndex={1}
          isTransitioning={false} onSelectDate={vi.fn()}
        />
      </div>,
    );
    const chip = container.querySelector('button[aria-pressed]')!;
    fireEvent.mouseDown(chip);
    fireEvent.keyDown(chip, { key: 'ArrowLeft' });
    expect(outer).not.toHaveBeenCalled();
  });
});
