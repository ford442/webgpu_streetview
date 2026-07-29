export type ImageExportFormat = 'png' | 'jpeg' | 'webp';

export const FORMAT_MIME: Record<ImageExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

const FORMAT_QUALITY: Partial<Record<ImageExportFormat, number>> = {
  jpeg: 0.9,
  webp: 0.85,
};

export function formatExtension(format: ImageExportFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export function dataUrlToImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image from data URL'));
    img.src = dataUrl;
  });
}

/** Re-encodes a captured (PNG) data URL into another image format via an offscreen canvas. */
export async function convertDataUrlFormat(
  dataUrl: string,
  format: ImageExportFormat,
): Promise<Blob> {
  if (format === 'png' && dataUrl.startsWith('data:image/png')) {
    return (await fetch(dataUrl)).blob();
  }

  const img = await dataUrlToImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to acquire 2D context for image export');

  if (format !== 'png') {
    // JPEG/WebP don't preserve transparency the way PNG does; flatten onto black.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      FORMAT_MIME[format],
      FORMAT_QUALITY[format],
    );
  });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
    reader.readAsDataURL(blob);
  });
}
