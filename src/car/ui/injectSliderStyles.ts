/**
 * Injects global CSS for range input pseudo-elements.
 * Safe to call multiple times — only inserts once.
 */
export const injectSliderStyles = (): void => {
  const styleId = 'car-controls-slider-styles';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      background: transparent;
    }
    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--color-primary, #00D4FF);
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.9);
      cursor: pointer;
      transition: all 0.2s ease;
      margin-top: -6px;
    }
    input[type="range"]::-webkit-slider-thumb:hover {
      transform: scale(1.1);
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.7);
    }
    input[type="range"]::-webkit-slider-thumb:active {
      box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.2), 0 0 15px rgba(0, 212, 255, 0.7);
    }
    input[type="range"]::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--color-primary, #00D4FF);
      box-shadow: 0 0 10px rgba(0, 212, 255, 0.5);
      border: 2px solid rgba(255, 255, 255, 0.9);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    input[type="range"]::-moz-range-thumb:hover {
      transform: scale(1.1);
      box-shadow: 0 0 15px rgba(0, 212, 255, 0.7);
    }
    input[type="range"]::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 2px;
    }
    input[type="range"]::-moz-range-track {
      height: 4px;
      border-radius: 2px;
    }
    input[type="range"]:focus {
      outline: none;
    }
    input[type="range"]:focus::-webkit-slider-thumb {
      box-shadow: 0 0 0 4px rgba(0, 212, 255, 0.2), 0 0 15px rgba(0, 212, 255, 0.7);
    }
  `;
  document.head.appendChild(style);
};
