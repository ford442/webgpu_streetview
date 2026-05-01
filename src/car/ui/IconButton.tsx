import React, { memo } from 'react';
import { BaseButton } from './Button';
import { Icon } from './Icon';

export interface IconButtonProps {
  icon: string;
  label?: string;
  active?: boolean;
  activeColor?: string;
  size?: 'sm' | 'md' | 'lg';
  ariaLabel: string;
  onClick: () => void;
  disabled?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = memo(
  ({
    icon,
    label,
    active = false,
    size = 'md',
    ariaLabel,
    onClick,
    disabled = false,
  }) => {
    const iconSize = size === 'sm' ? 20 : size === 'lg' ? 32 : 24;
    return (
      <BaseButton
        onClick={onClick}
        active={active}
        size={size}
        aria-label={ariaLabel}
        aria-pressed={active}
        disabled={disabled}
      >
        <Icon path={icon} size={iconSize} ariaLabel={ariaLabel} />
        {label && <span>{label}</span>}
      </BaseButton>
    );
  }
);
