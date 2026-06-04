import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

const streetViewApiKeys: string[] = [];

jest.mock('./components/StreetView', () => {
  return function MockStreetView({ apiKey }: { apiKey: string }) {
    streetViewApiKeys.push(apiKey);
    return <div data-testid="mock-street-view" data-api-key={apiKey} />;
  };
});

jest.mock('./car', () => ({
  initCarMode: jest.fn(() => null),
  toggleCarMode: jest.fn(),
  disposeCarMode: jest.fn(),
}));

describe('App', () => {
  beforeEach(() => {
    streetViewApiKeys.length = 0;
    window.MAPS_API_KEY = '';
  });

  it('renders without crashing', () => {
    render(<App />);
  });

  it('renders the Street View mount point', () => {
    render(<App />);
    expect(screen.getByTestId('mock-street-view')).toBeInTheDocument();
  });

  it('initially shows welcome modal', () => {
    render(<App />);
    expect(screen.getByText('1ink.us Streetview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Exploring/i })).toBeInTheDocument();
  });

  it('shows a missing key error and picks up a late runtime key without reload', async () => {
    render(<App />);

    expect(screen.getByRole('alert')).toHaveTextContent('No Google Maps API key is configured');
    expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', '');

    window.MAPS_API_KEY = 'late-runtime-key';
    act(() => {
      window.dispatchEvent(new CustomEvent('maps-api-key-ready'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('mock-street-view')).toHaveAttribute('data-api-key', 'late-runtime-key');
    });
    expect(screen.queryByText(/No Google Maps API key is configured/i)).not.toBeInTheDocument();
    expect(streetViewApiKeys).toContain('');
    expect(streetViewApiKeys).toContain('late-runtime-key');
  });
});
