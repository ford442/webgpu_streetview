import type { ControlMode } from '../../hooks/useViewMode';

export function getModeDisplayName(mode: ControlMode): string {
  switch (mode) {
    case 'freeLook': return 'Free Look';
    case 'uiMouse': return 'UI Mouse';
    case 'carSteer': return 'Car Steer';
  }
}

export function getModeDescription(mode: ControlMode): string {
  switch (mode) {
    case 'freeLook':
      return '🖱️ Click-drag = look around • A/D = turn head • Car stays put • Click wheel = steer';
    case 'uiMouse':
      return '🖱️ Dashboard controls • Click cabin knobs/buttons • Right-drag = steer • H = switch mode';
    case 'carSteer':
      return '🚗 Click-drag X = steer car • drag Y = look up/down • W/S = drive • Q/E = snap ±45°';
  }
}
