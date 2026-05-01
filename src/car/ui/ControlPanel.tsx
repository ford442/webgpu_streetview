import React from 'react';
import styles from './ControlPanel.module.css';

export interface ControlPanelProps {
  children: React.ReactNode;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
  children,
  title,
  className,
  style,
}) => (
  <div className={`${styles.panel} ${className ?? ''}`} style={style}>
    {title && <h3 className={styles.title}>{title}</h3>}
    {children}
  </div>
);
