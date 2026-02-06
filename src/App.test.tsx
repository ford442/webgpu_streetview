import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
  });

  it('renders WebGPU canvas container', () => {
    render(<App />);
    expect(screen.getByTestId('webgpu-canvas-container')).toBeInTheDocument();
  });

  it('initially shows welcome modal', () => {
    render(<App />);
    expect(screen.getByText('1ink.us Streetview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Exploring/i })).toBeInTheDocument();
  });
});