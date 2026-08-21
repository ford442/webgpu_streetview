import type { CesiumViewer } from '../../types/cesium';

/** Street-level height used on enter start / exit descend (meters). */
export const GLOBE_STREET_ALTITUDE_M = 120;
/** Orbit height after the enter fly (meters). */
export const GLOBE_ORBIT_ALTITUDE_M = 1_800_000;
/** Orbital Drop destination height before teleport (meters). */
export const GLOBE_DROP_ALTITUDE_M = 250;

export const GLOBE_ENTER_DURATION_S = 3.5;
export const GLOBE_EXIT_DURATION_S = 2.2;
export const GLOBE_DROP_DURATION_S = 2.5;

export interface GlobeCameraPose {
  lat: number;
  lng: number;
  heading: number;
}

export function globeStreetOrientation(headingDeg: number, pitchDeg: number) {
  return {
    heading: Cesium.Math.toRadians(headingDeg),
    pitch: Cesium.Math.toRadians(pitchDeg),
    roll: 0,
  };
}

export function setGlobeStreetView(
  viewer: CesiumViewer,
  pose: GlobeCameraPose,
  pitchDeg = -15,
): void {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(pose.lng, pose.lat, GLOBE_STREET_ALTITUDE_M),
    orientation: globeStreetOrientation(pose.heading, pitchDeg),
  });
}

export function flyGlobeEnterOrbit(
  viewer: CesiumViewer,
  pose: GlobeCameraPose,
  onComplete: () => void,
): void {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(pose.lng, pose.lat, GLOBE_ORBIT_ALTITUDE_M),
    orientation: globeStreetOrientation(pose.heading, -90),
    duration: GLOBE_ENTER_DURATION_S,
    complete: onComplete,
  });
}

export function flyGlobeExitDescend(
  viewer: CesiumViewer,
  pose: GlobeCameraPose,
  onComplete: () => void,
): void {
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(pose.lng, pose.lat, GLOBE_STREET_ALTITUDE_M),
    orientation: globeStreetOrientation(pose.heading, -30),
    duration: GLOBE_EXIT_DURATION_S,
    complete: onComplete,
  });
}

export function flyGlobeOrbitalDrop(
  viewer: CesiumViewer | null,
  lat: number,
  lng: number,
  heading: number,
  onComplete: () => void,
): void {
  if (!viewer || viewer.isDestroyed()) {
    onComplete();
    return;
  }
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lng, lat, GLOBE_DROP_ALTITUDE_M),
    orientation: globeStreetOrientation(heading, -35),
    duration: GLOBE_DROP_DURATION_S,
    complete: onComplete,
  });
}

const STREETVIEW_SNAP_RADIUS_M = 50;

/**
 * Snap to the nearest Street View pano, then Orbital Drop + teleport.
 * If the service is missing, drop at the clicked coordinates.
 */
export function requestOrbitalDrop(opts: {
  viewer: CesiumViewer | null;
  heading: number;
  lat: number;
  lng: number;
  svService: google.maps.StreetViewService | null;
  onTeleport: (lat: number, lng: number) => void;
  onNoStreetView: () => void;
}): void {
  const flyThenTeleport = (tLat: number, tLng: number) => {
    flyGlobeOrbitalDrop(opts.viewer, tLat, tLng, opts.heading, () => {
      opts.onTeleport(tLat, tLng);
    });
  };

  const svc = opts.svService;
  if (!svc) {
    flyThenTeleport(opts.lat, opts.lng);
    return;
  }

  svc.getPanorama(
    { location: { lat: opts.lat, lng: opts.lng }, radius: STREETVIEW_SNAP_RADIUS_M },
    (data, status) => {
      if (status === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
        flyThenTeleport(data.location.latLng.lat(), data.location.latLng.lng());
      } else {
        opts.onNoStreetView();
      }
    },
  );
}
