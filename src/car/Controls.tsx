// Barrel export – all UI primitives now live in src/car/ui/
// This file preserves backward compatibility for existing imports.

import {
  IconButton,
  Slider,
  ToggleGroup,
  AudioVisualizer,
  ControlPanel,
  ButtonRow,
  Divider,
  injectSliderStyles,
  ThemeProvider,
  useTheme,
} from './ui';

export {
  IconButton,
  Slider,
  ToggleGroup,
  AudioVisualizer,
  ControlPanel,
  ButtonRow,
  Divider,
  injectSliderStyles,
  ThemeProvider,
  useTheme,
};

export type {
  IconButtonProps,
  SliderProps,
  ToggleGroupProps,
  AudioVisualizerProps,
  ControlPanelProps,
  ButtonRowProps,
  ThemeName,
} from './ui';

export {
  GPS_ICON,
  RADIO_ICON,
  ROOF_ICON,
  WIPER_ICON,
  HEADLIGHT_ICON,
  HIGHBEAM_ICON,
  DOME_ICON,
  SNOW_ICON,
  RAIN_ICON,
  WIND_ICON,
  VEHICLE_ICON,
  TINT_ICON,
  VOLUME_ICON,
  POWER_ICON,
  FAN_ICON,
  TEMP_ICON,
  REAR_MIRROR_ICON,
} from './ui/icons';

const controlsUI = {
  IconButton,
  Slider,
  ToggleGroup,
  AudioVisualizer,
  ControlPanel,
  ButtonRow,
  Divider,
  injectSliderStyles,
};

export default controlsUI;
