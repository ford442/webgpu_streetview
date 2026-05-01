import React, { createContext, useContext } from 'react';

export type ThemeName = 'dark' | 'neon' | 'clinical' | 'light';

export const themeVariables: Record<ThemeName, Record<string, string>> = {
  dark: {
    '--color-primary': '#00D4FF',
    '--color-bg': 'rgba(15,20,25,0.6)',
    '--color-bg-solid': '#0F1419',
    '--color-text': 'rgba(255,255,255,0.9)',
    '--color-muted': 'rgba(255,255,255,0.6)',
    '--color-border': 'rgba(255,255,255,0.1)',
    '--color-accent': '#00D4FF',
  },
  neon: {
    '--color-primary': '#00D4FF',
    '--color-bg': 'rgba(0,12,20,0.55)',
    '--color-bg-solid': '#0A0A1A',
    '--color-text': 'rgba(255,255,255,0.95)',
    '--color-muted': 'rgba(255,255,255,0.7)',
    '--color-border': 'rgba(0,212,255,0.2)',
    '--color-accent': '#FF3864',
  },
  clinical: {
    '--color-primary': '#0A0A0A',
    '--color-bg': 'rgba(245,245,245,0.85)',
    '--color-bg-solid': '#F5F5F5',
    '--color-text': 'rgba(0,0,0,0.9)',
    '--color-muted': 'rgba(0,0,0,0.6)',
    '--color-border': 'rgba(0,0,0,0.1)',
    '--color-accent': '#00D4FF',
  },
  light: {
    '--color-primary': '#0A0A0A',
    '--color-bg': 'rgba(240,240,240,0.9)',
    '--color-bg-solid': '#FFFFFF',
    '--color-text': 'rgba(0,0,0,0.9)',
    '--color-muted': 'rgba(0,0,0,0.6)',
    '--color-border': 'rgba(0,0,0,0.1)',
    '--color-accent': '#00D4FF',
  },
};

export const ThemeContext = createContext<ThemeName>('dark');

export const ThemeProvider: React.FC<{
  theme: ThemeName;
  children: React.ReactNode;
}> = ({ theme, children }) => {
  const vars = themeVariables[theme];
  const style = Object.entries(vars).reduce<React.CSSProperties>((acc, [k, v]) => {
    (acc as any)[k] = v;
    return acc;
  }, {});
  return (
    <ThemeContext.Provider value={theme}>
      <div style={style}>{children}</div>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
