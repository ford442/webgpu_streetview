import './style.css';
import { AppProviders, AppShell, warnIfMissingInitialMapsKey } from './app';

warnIfMissingInitialMapsKey();

function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}

export default App;
