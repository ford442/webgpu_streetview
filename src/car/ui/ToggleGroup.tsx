import React, { memo } from 'react';
import { BaseButton } from './Button';
import { Icon } from './Icon';

export interface ToggleOption {
  value: string;
  icon: string;
  label: string;
}

export interface ToggleGroupProps {
  options: ToggleOption[];
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}

export const ToggleGroup: React.FC<ToggleGroupProps> = memo(
  ({ options, value, onChange, ariaLabel }) => {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          gap: 4,
          padding: 4,
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
        }}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <BaseButton
              key={opt.value}
              onClick={() => onChange(opt.value)}
              active={selected}
              size="sm"
              aria-checked={selected}
              role="radio"
            >
              <Icon path={opt.icon} size={18} ariaLabel={opt.label} />
              <span style={{ fontSize: 11 }}>{opt.label}</span>
            </BaseButton>
          );
        })}
      </div>
    );
  }
);
