/**
 * ICE server resolution for WebRTC shared sessions.
 *
 * STUN is always included. TURN is optional — supply via build-time env
 * (REACT_APP_TURN_URL / REACT_APP_TURN_USERNAME / REACT_APP_TURN_CREDENTIAL)
 * or runtime window.TURN_* in public/config.js. Never commit credentials.
 */

const DEFAULT_STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

declare global {
  interface Window {
    TURN_URL?: string;
    TURN_USERNAME?: string;
    TURN_CREDENTIAL?: string;
  }
}

function readEnv(key: string): string {
  const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[key];
  if (vite?.trim()) return vite.trim();
  const react = (process.env as Record<string, string | undefined>)[key];
  return react?.trim() || '';
}

function buildTurnServer(): RTCIceServer | null {
  const urls =
    readEnv('VITE_TURN_URL') ||
    readEnv('REACT_APP_TURN_URL') ||
    (typeof window !== 'undefined' ? window.TURN_URL?.trim() : '') ||
    '';
  if (!urls) return null;

  const username =
    readEnv('VITE_TURN_USERNAME') ||
    readEnv('REACT_APP_TURN_USERNAME') ||
    (typeof window !== 'undefined' ? window.TURN_USERNAME?.trim() : '') ||
    undefined;
  const credential =
    readEnv('VITE_TURN_CREDENTIAL') ||
    readEnv('REACT_APP_TURN_CREDENTIAL') ||
    (typeof window !== 'undefined' ? window.TURN_CREDENTIAL?.trim() : '') ||
    undefined;

  const server: RTCIceServer = { urls };
  if (username) server.username = username;
  if (credential) server.credential = credential;
  return server;
}

/** Resolved ICE servers: STUN + optional TURN when configured. */
export function resolveIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [DEFAULT_STUN];
  const turn = buildTurnServer();
  if (turn) servers.push(turn);
  return servers;
}

/** True when a TURN URL is configured (credentials may still be empty for open relays). */
export function hasTurnConfigured(): boolean {
  return buildTurnServer() !== null;
}
