import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getConfiguredSupabaseAnonKey, getConfiguredSupabaseUrl, isSignalingConfigured } from './supabaseConfig';
import type { SupabaseRealtimeClientLike } from './signalingClient';

export { isSignalingConfigured };

let cachedClient: SupabaseClient | null = null;
let cachedForUrl = '';

/**
 * Lazily create (and cache) the Supabase client used purely for signaling.
 * Returns null when no URL/key is configured — callers should surface that
 * as "shared sessions unavailable" rather than throwing.
 */
export function getSignalingRealtimeClient(): SupabaseRealtimeClientLike | null {
  if (!isSignalingConfigured()) return null;

  const url = getConfiguredSupabaseUrl();
  if (!cachedClient || cachedForUrl !== url) {
    cachedClient = createClient(url, getConfiguredSupabaseAnonKey(), {
      // Signaling only — no auth session, no Postgres/table access needed.
      auth: { persistSession: false },
    });
    cachedForUrl = url;
  }
  // The real RealtimeChannel/SupabaseClient surface is a strict superset of
  // the small duck-typed interface this module depends on (see
  // signalingClient.ts) — cast rather than hand-maintain a structural type
  // that mirrors every overload of the real SDK.
  return cachedClient as unknown as SupabaseRealtimeClientLike;
}
