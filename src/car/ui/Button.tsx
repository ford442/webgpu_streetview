import React from 'react';
import styles from './Button.module.css';

export interface BaseButtonProps {
  active?: boolean;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
  'aria-checked'?: boolean;
  role?: string;
}

export const BaseButton: React.FC<BaseButtonProps> = ({
  active = false,
  size = 'md',
  disabled = false,
  children,
  onClick,
  ...ariaProps
}) => {
  const sizeClass = size === 'sm' ? styles.sizeSm : size === 'lg' ? styles.sizeLg : styles.sizeMd;
  return (
    <button
      className={`${styles.baseButton} ${sizeClass} ${active ? styles.active : ''}`}
      onClick={onClick}
      disabled={disabled}
      {...ariaProps}
    >
      {children}
    </button>
  );
};
