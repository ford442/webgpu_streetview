import piexif from 'piexifjs';
import { embedExifGps } from './exifGps';

// Minimal valid 1x1 JPEG, used as a fixture since jsdom has no real canvas encoder.
const MINIMAL_JPEG_DATA_URL =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICAkKDQ8MCgsOCwkIDBEUDA4PEBAQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';

describe('embedExifGps', () => {
    it('embeds GPS latitude/longitude readable back via piexif.load', () => {
        const result = embedExifGps(MINIMAL_JPEG_DATA_URL, {
            lat: 37.7749,
            lng: -122.4194,
            heading: 45,
            pitch: -10,
            zoom: 1.5,
            panoId: 'pano-abc',
            timestamp: '2026-07-29T12:34:56.000Z',
        });

        expect(result.startsWith('data:image/jpeg;base64,')).toBe(true);

        const exif = piexif.load(result);
        const gps = exif.GPS!;
        expect(gps[piexif.GPSIFD.GPSLatitudeRef]).toBe('N');
        expect(gps[piexif.GPSIFD.GPSLongitudeRef]).toBe('W');

        const [[latDeg], [latMin], [latSecNum, latSecDen]] = gps[piexif.GPSIFD.GPSLatitude] as [
            [number, number],
            [number, number],
            [number, number],
        ];
        expect(latDeg).toBe(37);
        expect(latMin).toBe(46);
        expect(latSecNum / latSecDen).toBeCloseTo(29.64, 0);
    });

    it('flips the ref letters for southern/western hemispheres', () => {
        const result = embedExifGps(MINIMAL_JPEG_DATA_URL, {
            lat: -33.8688,
            lng: 151.2093,
            heading: 0,
            pitch: 0,
            zoom: 1,
            timestamp: '2026-01-01T00:00:00.000Z',
        });
        const exif = piexif.load(result);
        const gps = exif.GPS!;
        expect(gps[piexif.GPSIFD.GPSLatitudeRef]).toBe('S');
        expect(gps[piexif.GPSIFD.GPSLongitudeRef]).toBe('E');
    });

    it('embeds heading/pitch/zoom/panoId as JSON in UserComment', () => {
        const result = embedExifGps(MINIMAL_JPEG_DATA_URL, {
            lat: 0,
            lng: 0,
            heading: 123.4,
            pitch: 5.6,
            zoom: 2,
            panoId: 'pano-xyz',
            timestamp: '2026-01-01T00:00:00.000Z',
            buildVersion: '1.2.3',
        });
        const exif = piexif.load(result);
        const rawComment = exif.Exif![piexif.ExifIFD.UserComment] as string;
        // Strip the 8-byte "ASCII\0\0\0" character-code prefix required by the EXIF spec.
        const json = rawComment.slice(8);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual({
            heading: 123.4,
            pitch: 5.6,
            zoom: 2,
            panoId: 'pano-xyz',
            buildVersion: '1.2.3',
            imageDate: null,
            lookId: null,
            vehicleType: null,
        });
    });

    it('round-trips imageDate, lookId, and vehicleType in UserComment', () => {
        const result = embedExifGps(MINIMAL_JPEG_DATA_URL, {
            lat: 0,
            lng: 0,
            heading: 10,
            pitch: 1,
            zoom: 1,
            panoId: 'tokyo-alley',
            timestamp: '2026-01-01T00:00:00.000Z',
            imageDate: '2012-06',
            lookId: 'noir',
            vehicleType: 'convertible',
        });
        const exif = piexif.load(result);
        const rawComment = exif.Exif![piexif.ExifIFD.UserComment] as string;
        const parsed = JSON.parse(rawComment.slice(8));
        expect(parsed).toMatchObject({
            panoId: 'tokyo-alley',
            imageDate: '2012-06',
            lookId: 'noir',
            vehicleType: 'convertible',
        });
    });

    it('formats DateTimeOriginal per the EXIF spec (YYYY:MM:DD HH:MM:SS)', () => {
        const result = embedExifGps(MINIMAL_JPEG_DATA_URL, {
            lat: 0,
            lng: 0,
            heading: 0,
            pitch: 0,
            zoom: 1,
            timestamp: '2026-07-29T12:34:56.000Z',
        });
        const exif = piexif.load(result);
        const dateTime = exif.Exif![piexif.ExifIFD.DateTimeOriginal] as string;
        expect(dateTime).toMatch(/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/);
    });
});
