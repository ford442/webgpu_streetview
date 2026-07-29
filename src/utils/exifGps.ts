import piexif from 'piexifjs';

export interface ExifGpsOptions {
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  zoom: number;
  panoId?: string;
  timestamp: string;
  buildVersion?: string;
}

type Dms = [[number, number], [number, number], [number, number]];

function toDMS(value: number): Dms {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 100);
  return [[deg, 1], [min, 1], [sec, 100]];
}

function toExifDateTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** EXIF UserComment (tag 0x9286) requires an 8-byte character-code prefix before the text. */
function encodeUserComment(comment: string): string {
  return `ASCII\0\0\0${comment}`;
}

/**
 * Embeds GPS coordinates and app metadata (heading/pitch/zoom/panoId) into a JPEG data URL.
 * Returns a new data URL; the input must already be JPEG-encoded (piexifjs operates on JPEG only).
 */
export function embedExifGps(jpegDataUrl: string, options: ExifGpsOptions): string {
  const { lat, lng, heading, pitch, zoom, panoId, timestamp, buildVersion } = options;
  const normalizedHeading = ((heading % 360) + 360) % 360;

  const userComment = encodeUserComment(
    JSON.stringify({ heading, pitch, zoom, panoId: panoId ?? null, buildVersion: buildVersion ?? null }),
  );

  const exifDict = {
    '0th': {},
    Exif: {
      [piexif.ExifIFD.UserComment]: userComment,
      [piexif.ExifIFD.DateTimeOriginal]: toExifDateTime(timestamp),
    },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: lat >= 0 ? 'N' : 'S',
      [piexif.GPSIFD.GPSLatitude]: toDMS(lat),
      [piexif.GPSIFD.GPSLongitudeRef]: lng >= 0 ? 'E' : 'W',
      [piexif.GPSIFD.GPSLongitude]: toDMS(lng),
      [piexif.GPSIFD.GPSImgDirectionRef]: 'T',
      [piexif.GPSIFD.GPSImgDirection]: [Math.round(normalizedHeading * 100), 100],
    },
  };

  const exifBytes = piexif.dump(exifDict);
  return piexif.insert(exifBytes, jpegDataUrl);
}
