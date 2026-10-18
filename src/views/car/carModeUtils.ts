import type { ControlMode } from '../../hooks/useViewMode';

export function getModeDisplayName(mode: ControlMode): string {
  switch (mode) {
    case 'FREE_LOOK': return 'Free Look';
    case 'UI_INTERACT': return 'UI Mouse';
    case 'STEER': return 'Car Steer';
  }
}

export function getModeDescription(mode: ControlMode): string {
  switch (mode) {
    case 'FREE_LOOK':
      return '🖱️ Mouse = look around the cabin • car stays put • release RMB / F = steer • Tab = cursor';
    case 'UI_INTERACT':
      return '🖱️ Cursor only • click knobs/buttons • click the cabin to grab the mouse • Tab = back to driving';
    case 'STEER':
      return '🚗 Mouse X = steer • hold RMB / F = free look • W/S = drive • Q/E = snap ±45° • Tab/Esc = cursor';
  }
}
