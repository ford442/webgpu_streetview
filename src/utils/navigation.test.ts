import { findBestLink } from './navigation';

describe('findBestLink', () => {
    const links: google.maps.StreetViewLink[] = [
        { heading: 0, pano: 'north', description: '' },
        { heading: 90, pano: 'east', description: '' },
        { heading: 180, pano: 'south', description: '' },
        { heading: 270, pano: 'west', description: '' },
    ];

    it('returns null for empty links', () => {
        expect(findBestLink([], 0, 'forward')).toBeNull();
    });

    it('finds forward link correctly', () => {
        const result = findBestLink(links, 0, 'forward');
        expect(result?.pano).toBe('north');
    });

    it('finds backward link correctly', () => {
        const result = findBestLink(links, 0, 'backward');
        expect(result?.pano).toBe('south');
    });

    it('finds left link correctly', () => {
        const result = findBestLink(links, 0, 'left');
        expect(result?.pano).toBe('west');
    });

    it('finds right link correctly', () => {
        const result = findBestLink(links, 0, 'right');
        expect(result?.pano).toBe('east');
    });

    it('returns null if no link is within 45 degrees', () => {
        const limitedLinks: google.maps.StreetViewLink[] = [
            { heading: 180, pano: 'south', description: '' },
        ];
        const result = findBestLink(limitedLinks, 0, 'forward');
        expect(result).toBeNull();
    });

    it('handles heading near 360/0 boundary', () => {
        const boundaryLinks: google.maps.StreetViewLink[] = [
            { heading: 355, pano: 'near-north', description: '' },
        ];
        const result = findBestLink(boundaryLinks, 0, 'forward');
        expect(result?.pano).toBe('near-north');
    });
});
