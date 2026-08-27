/**
 * Cinema clip sidecar — pano / look metadata next to a WebM.
 * Samples the host film set; never fetches Street View Static imagery.
 */

export interface CinemaSidecarSample {
  tMs: number;
  panoId?: string;
  imageDate?: string;
}

export interface CinemaSidecar {
  /** Road-only until the single-GPUDevice cabin composites glass + panorama. */
  capture: 'road-only';
  lookId: string | null;
  vehicleType: string | null;
  samples: CinemaSidecarSample[];
}

export interface CinemaSidecarSession {
  note(panoId?: string | null, imageDate?: string | null): void;
  toJSON(): CinemaSidecar;
}

export function createCinemaSidecarSession(meta: {
  lookId: string | null;
  vehicleType: string | null;
}): CinemaSidecarSession {
  const started = performance.now();
  const samples: CinemaSidecarSample[] = [];

  const note = (panoId?: string | null, imageDate?: string | null) => {
    const last = samples[samples.length - 1];
    const id = panoId ?? undefined;
    const date = imageDate ?? undefined;
    if (last && last.panoId === id && last.imageDate === date) return;
    samples.push({
      tMs: Math.round(performance.now() - started),
      ...(id ? { panoId: id } : {}),
      ...(date ? { imageDate: date } : {}),
    });
  };

  return {
    note,
    toJSON: () => ({
      capture: 'road-only',
      lookId: meta.lookId,
      vehicleType: meta.vehicleType,
      samples: samples.map((s) => ({ ...s })),
    }),
  };
}

export function downloadSidecarJson(sidecar: CinemaSidecar, baseName = 'streetview-clip'): void {
  const blob = new Blob([JSON.stringify(sidecar, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${baseName.replace(/[^a-z0-9-_ ]/gi, '_') || 'clip'}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
