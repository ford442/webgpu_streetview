import AppBanners from '../../components/AppBanners';
import { SkipLink } from '../../hooks/useKeyboardShortcuts';
import type { MapsBootstrapState } from '../useMapsBootstrap';
import { OfflineStatusToast } from './OfflineStatusToast';
import { GeocodeDeniedToast } from './GeocodeDeniedToast';

interface ShellNoticesProps {
  maps: MapsBootstrapState;
  isConnected: boolean;
  isOnline: boolean;
}

/**
 * Global, always-mounted notice layer: skip link, Maps key/auth/scrape
 * banners, and the offline and geocode-denied toasts. Maps auth failure
 * shows as a banner (plus the loading-overlay error), never a viewport takeover.
 *
 * None of these depend on view mode or cinema state, so they sit above the
 * stage for the whole life of the shell.
 */
export function ShellNotices({ maps, isConnected, isOnline }: ShellNoticesProps) {
  return (
    <>
      <SkipLink targetId="main-content">Skip to main content</SkipLink>

      <AppBanners
        showMissingKeyBanner={maps.showMissingKeyBanner}
        setShowMissingKeyBanner={maps.setShowMissingKeyBanner}
        showAuthFailedBanner={maps.showAuthFailedBanner}
        setShowAuthFailedBanner={maps.setShowAuthFailedBanner}
        isRecoveringMapsAuth={maps.isRetryingMapsAuth}
        scrapeLost={maps.scraperHealth.everStable && maps.scraperHealth.status === 'lost'}
        scrapeLostDetail={maps.scraperHealth.lastErrorDetail}
      />

      <OfflineStatusToast visible={isConnected && !isOnline} />
      <GeocodeDeniedToast />
    </>
  );
}
