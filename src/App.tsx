import React, { useState, useRef, useEffect, useCallback } from 'react';
import WebGPUCanvas from './components/WebGPUCanvas';
import StreetView from './components/StreetView';
import InputHandler from './components/InputHandler';
import { Renderer } from './renderer/Renderer';
import { RenderMode } from './renderer/types';
import { findBestLink } from './utils/navigation';
import MiniMap from './components/MiniMap';
import WelcomeModal from './components/WelcomeModal';
import './style.css';

// Constants for cruise mode timing
const TRANSITION_DELAY_MS = 1500; // Time to wait for panorama tiles to load after a position change
const CRUISE_INTERVAL_MS = 3000;  // Time between automatic hops in cruise mode

function App() {
    const [mode] = useState<RenderMode>('streetview');
    const [zoom, setZoom] = useState(1.0);
    const [effectiveZoom, setEffectiveZoom] = useState(1.0);
    const [webGPUAvailable, setWebGPUAvailable] = useState<boolean | null>(null); // null = checking, true = available, false = not available

    // Welcome Modal state
    const [showWelcome, setShowWelcome] = useState(true);

    // POV state
    const [heading, setHeading] = useState(34);
    const [pitch, setPitch] = useState(10);

    // Map UI state
    const [isMapOpen