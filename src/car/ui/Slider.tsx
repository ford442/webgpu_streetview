import React, { useCallback, useRef } from 'react';
import { Icon } from './Icon';
import styles from './Slider.module.css';

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  icon?: string;
  color?: string;
  onChange: (v: number) => void;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  label,
  icon,
  color = 'var(--color-primary, #00D4FF)',
  onChange,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const percent = ((value - min) / (max - min)) * 100;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(Number(e.target.value));
    },
    [onChange]
  );

  return (
    <div className={styles.sliderContainer}>
      <label className={styles.labelRow}>
        {icon && <Icon path={icon} size={14} ariaLabel={label} />}
        <span>{label}</span>
        <span className={styles.value} style={{ color }}>{Math.round(value)}</span>
      </label>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={handleChange}
        aria-label={label}
        className={styles.sliderInput}
        style={{
          background: `linear-gradient(to right, ${color} ${percent}%, rgba(255,255,255,0.1) ${percent}%)`,
        }}
      />
    </div>
  );
};
