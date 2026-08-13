import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import LooksPanel from './LooksPanel';
import { lookPackToEnvPatch, LOOK_PACKS } from '../config/lookPacks';

describe('LooksPanel', () => {
  const state = lookPackToEnvPatch(LOOK_PACKS.clear);

  it('returns null when closed', () => {
    const { container } = render(
      <LooksPanel
        isOpen={false}
        onClose={() => {}}
        activeLookId={null}
        state={state}
        onApplyLook={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('applies a named look on click', () => {
    const onApplyLook = vi.fn();
    render(
      <LooksPanel
        isOpen
        onClose={() => {}}
        activeLookId={null}
        state={state}
        onApplyLook={onApplyLook}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Noir/i }));
    expect(onApplyLook).toHaveBeenCalledWith('noir');
  });

  it('copies a look URL and notes reduced motion', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <LooksPanel
        isOpen
        onClose={() => {}}
        activeLookId="noir"
        state={lookPackToEnvPatch(LOOK_PACKS.noir)}
        onApplyLook={() => {}}
        reducedMotion
      />,
    );

    expect(screen.getByText(/Reduced motion/i)).toBeInTheDocument();
    expect(screen.getByText(/Before:/i)).toBeInTheDocument();
    expect(screen.getByText(/After:/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Copy look as URL/i }));
    await screen.findByRole('status');
    expect(writeText).toHaveBeenCalled();
    const copied = String(writeText.mock.calls[0]![0]);
    expect(copied).toContain('look=noir');
  });

  it('stops mouse and keyboard events from reaching the panorama handlers', () => {
    const bubble = vi.fn();
    render(
      <div onMouseDown={bubble} onKeyDown={bubble}>
        <LooksPanel
          isOpen
          onClose={() => {}}
          activeLookId={null}
          state={state}
          onApplyLook={() => {}}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog', { name: /Looks/i }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: /Looks/i }), { key: 'a' });
    expect(bubble).not.toHaveBeenCalled();
  });
});
