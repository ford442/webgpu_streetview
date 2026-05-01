import React from 'react';

export interface IconProps {
  path: string;
  size?: number;
  fill?: string;
  stroke?: string;
  ariaLabel?: string;
}

export const Icon: React.FC<IconProps> = ({
  path,
  size = 24,
  fill = 'currentColor',
  stroke,
  ariaLabel,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke}
    aria-label={ariaLabel}
    role={ariaLabel ? 'img' : undefined}
  >
    <path d={path} />
  </svg>
);
