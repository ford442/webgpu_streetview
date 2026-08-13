import './types/cesium';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './offline/serviceWorkerRegistration';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

registerServiceWorker({
  onSuccess: () => console.log('[Offline] App shell cached for offline use.'),
  onUpdate: () => console.log('[Offline] New app shell available — reload to update.'),
});
