import React from 'react';
import { useViewMode } from '../hooks/useViewMode';
import FreeLookView from './FreeLookView';
import CarModeView from './CarModeView';

interface MainViewProps {
  mapsApiKey: string;
}

/**
 * MainView - Routes between FreeLookView and CarModeView based on current view mode.
 * 
 * This is the main content component that renders the appropriate view based on
 * the user's selected mode from useViewMode context.
 */
const MainView: React.FC<MainViewProps> = ({ mapsApiKey }) => {
  const { viewMode } = useViewMode();
  
  return (
    <>
      {viewMode === 'freelook' && <FreeLookView mapsApiKey={mapsApiKey} />}
      {viewMode === 'car' && <CarModeView mapsApiKey={mapsApiKey} />}
    </>
  );
};

export default MainView;
