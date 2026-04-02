const STORAGE_API_BASE = process.env.REACT_APP_STORAGE_API_URL || 'https://storage.noahcohn.com';

export interface CloudLocation {
    id: string;
    name: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom: number;
    description?: string;
    tags?: string[];
    date?: string;
    type?: string;
    filename?: string;
}

export interface SaveLocationRequest {
    name: string;
    lat: number;
    lng: number;
    heading: number;
    pitch: number;
    zoom?: number;
    description?: string;
    tags?: string[];
}

class StorageApiError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = 'StorageApiError';
    }
}

async function handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const text = await response.text().catch(() => 'Unknown error');
        throw new StorageApiError(
            `Storage API error ${response.status}: ${text}`,
            response.status
        );
    }
    return response.json() as Promise<T>;
}

export async function fetchCloudLocations(): Promise<CloudLocation[]> {
    const response = await fetch(`${STORAGE_API_BASE}/api/locations`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
    });
    return handleResponse<CloudLocation[]>(response);
}

export async function saveLocationToCloud(payload: SaveLocationRequest): Promise<{ success: boolean; id: string; location: CloudLocation }> {
    const response = await fetch(`${STORAGE_API_BASE}/api/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
    });
    return handleResponse<{ success: boolean; id: string; location: CloudLocation }>(response);
}

export async function deleteLocationFromCloud(locationId: string): Promise<{ success: boolean; id: string; deleted: boolean }> {
    const response = await fetch(`${STORAGE_API_BASE}/api/locations/${encodeURIComponent(locationId)}`, {
        method: 'DELETE',
        headers: { 'Accept': 'application/json' },
    });
    return handleResponse<{ success: boolean; id: string; deleted: boolean }>(response);
}

export async function updateLocationInCloud(locationId: string, payload: SaveLocationRequest): Promise<{ success: boolean; id: string; location: CloudLocation }> {
    const response = await fetch(`${STORAGE_API_BASE}/api/locations/${encodeURIComponent(locationId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
    });
    return handleResponse<{ success: boolean; id: string; location: CloudLocation }>(response);
}
