declare module 'piexifjs' {
  export interface ExifIFDDict {
    UserComment: number;
    DateTimeOriginal: number;
  }

  export interface GPSIFDDict {
    GPSLatitudeRef: number;
    GPSLatitude: number;
    GPSLongitudeRef: number;
    GPSLongitude: number;
    GPSImgDirectionRef: number;
    GPSImgDirection: number;
  }

  export const ExifIFD: ExifIFDDict;
  export const GPSIFD: GPSIFDDict;

  export type ExifRational = [number, number];

  export interface ExifDict {
    '0th'?: Record<number, unknown>;
    Exif?: Record<number, unknown>;
    GPS?: Record<number, unknown>;
    '1st'?: Record<number, unknown>;
    thumbnail?: string | null;
  }

  export function dump(exifDict: ExifDict): string;
  export function insert(exifBytes: string, jpegDataUrl: string): string;
  export function load(jpegDataUrl: string): ExifDict;
  export function remove(jpegDataUrl: string): string;
}
