import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { WasmBootFailure } from './app/WasmBootFailure';
import { registerServiceWorker } from './offline/serviceWorkerRegistration';
import { loadBootWasm } from './renderer/bootWasm';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// The WASM numeric layer is the only implementation of every kernel, and the
// geodesy/angle helpers run synchronously from the first effect on
// (`requireWasm()`), so the app renders only once the binary has loaded. A
// failed load renders the hard-fail overlay instead, with `webgpuProbe` at
// stage `wasm` — the same report `Renderer.init` makes when it awaits it.
loadBootWasm().then(
  () => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  },
  (error: unknown) => {
    console.error('[wasm]', error);
    root.render(<WasmBootFailure reason={error instanceof Error ? error.message : String(error)} />);
  },
);

registerServiceWorker({
  onSuccess: () => console.log('[Offline] App shell cached for offline use.'),
  onUpdate: () => console.log('[Offline] New app shell available — reload to update.'),
});
