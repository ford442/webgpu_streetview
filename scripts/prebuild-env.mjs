/**
 * Writes REACT_APP_BUILD_* (and VITE_BUILD_* aliases) into .env.local before Vite build.
 * Also warns if the Maps API key looks like a placeholder.
 */
import { execSync } from 'child_process';
import fs from 'fs';

const key = process.env.REACT_APP_MAPS_API_KEY || process.env.VITE_MAPS_API_KEY || '';
const isBad = !key || /placeholder|your_|replace|example/i.test(key);
if (isBad) {
  console.warn('\n⚠️  WARNING: REACT_APP_MAPS_API_KEY / VITE_MAPS_API_KEY is missing or looks like a placeholder.');
  console.warn(
    '   The production bundle will contain a non-working key.\n' +
      '   For live deploys, either:\n' +
      '     1. export REACT_APP_MAPS_API_KEY=... (or VITE_MAPS_API_KEY=...) before npm run build, OR\n' +
      '     2. Run with MAPS_API_KEY=... python deploy.py (it can override at deploy time).\n',
  );
} else {
  console.log(
    `✅ Maps API key present at build time (length ${key.length}). Remember to also set referrer restrictions for all target hosts (test.1ink.us, go.1ink.us, localhost).`,
  );
}

const hash = execSync('git rev-parse --short HEAD').toString().trim();
const ts = `${new Date().toISOString().replace('T', ' ').substring(0, 16)} UTC`;

let e = fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8') : '';
e = e
  .replace(/^REACT_APP_BUILD_VERSION=.*$/m, '')
  .replace(/^REACT_APP_BUILD_TIME=.*$/m, '')
  .replace(/^VITE_BUILD_VERSION=.*$/m, '')
  .replace(/^VITE_BUILD_TIME=.*$/m, '')
  .trim();

const block = [
  `REACT_APP_BUILD_VERSION=${hash}`,
  `REACT_APP_BUILD_TIME=${ts}`,
  `VITE_BUILD_VERSION=${hash}`,
  `VITE_BUILD_TIME=${ts}`,
].join('\n');

fs.writeFileSync('.env.local', `${e ? `${e}\n` : ''}${block}\n`);
console.log(`Build: ${hash} @ ${ts}`);
