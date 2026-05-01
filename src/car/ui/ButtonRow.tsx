import React from 'react';

export interface ButtonRowProps {
  children: React.ReactNode;
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
  gap?: number;
}

export const ButtonRow: React.FC<ButtonRowProps> = ({
  children,
  justify = 'flex-start',
  gap = 8,
}) => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: justify,
      gap: `${gap}px`,
    }}
  >
    {children}
  </div>
);
