import { useCallback } from 'react';
import { useBookmarks } from '../hooks/useBookmarks';
import type { ConnectedChromeBookmarks } from './shell/ConnectedChrome';

/**
 * Bookmarks bag for the chrome, with the "bookmark where I'm standing"
 * capture folded in.
 *
 * `useBookmarks` stores plain lat/lng/heading/pitch records; only the shell
 * knows the live panorama, so the position read lives here rather than in the
 * storage hook.
 */
export function useAppBookmarks(
  panorama: google.maps.StreetViewPanorama | null,
  heading: number,
  pitch: number,
): ConnectedChromeBookmarks {
  const {
    bookmarks,
    addBookmark,
    removeBookmark,
    isSyncing: isBookmarkSyncing,
    syncError: bookmarkSyncError,
    loadCloudBookmarks,
    saveBookmarkToCloud,
    removeCloudBookmark,
    syncAllToCloud,
  } = useBookmarks();

  const handleAddBookmark = useCallback(
    (name: string) => {
      if (!panorama) return;
      const position = panorama.getPosition();
      if (!position) return;
      addBookmark({
        name,
        lat: position.lat(),
        lng: position.lng(),
        heading,
        pitch,
      });
    },
    [panorama, addBookmark, heading, pitch],
  );

  return {
    bookmarks,
    handleAddBookmark,
    removeBookmark,
    isBookmarkSyncing,
    bookmarkSyncError,
    loadCloudBookmarks,
    saveBookmarkToCloud,
    removeCloudBookmark,
    syncAllToCloud,
  };
}
