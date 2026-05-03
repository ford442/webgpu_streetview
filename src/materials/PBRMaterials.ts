import * as THREE from 'three';

export type MaterialQuality = 'low' | 'medium' | 'high' | 'ultra';

export interface MaterialEffects {
    normalMaps: boolean;
    roughnessMaps: boolean;
    imperfections: boolean;
}

export interface QualityPreset {
    textureSize: number;
    effects: MaterialEffects;
}

export const QUALITY_PRESETS: Record<MaterialQuality, QualityPreset> = {
    low: {
        textureSize: 64,
        effects: { normalMaps: false, roughnessMaps: false, imperfections: false },
    },
    medium: {
        textureSize: 128,
        effects: { normalMaps: true, roughnessMaps: false, imperfections: false },
    },
    high: {
        textureSize: 256,
        effects: { normalMaps: true, roughnessMaps: true, imperfections: true },
    },
    ultra: {
        textureSize: 512,
        effects: { normalMaps: true, roughnessMaps: true, imperfections: true },
    },
};

export function createGlassMaterial(tintColor: string, darkness: number): THREE.MeshPhysicalMaterial {
    const color = new THREE.Color(tintColor).multiplyScalar(1 - darkness * 0.5);
    // transmission:0 and low opacity so the Three.js canvas stays mostly transparent —
    // this lets the WebGPU panorama canvas underneath show through the window openings.
    // Physical transmission (transmission:1) would render the Three.js scene background
    // (which is transparent/black) rather than the WebGPU panorama, making the glass opaque-black.
    return new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.08,
        depthWrite: false,
        envMapIntensity: 1.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1,
        side: THREE.DoubleSide,
    });
}

export class VehiclePBRMaterials {
    private textures: THREE.Texture[] = [];
    private materials: THREE.Material[] = [];
    private materialCache: Map<string, THREE.Material> = new Map();
    private defaultQuality: MaterialQuality;
    private effectOverrides: Partial<MaterialEffects> | null;

    constructor(defaultQuality: MaterialQuality = 'high', effectOverrides?: Partial<MaterialEffects>) {
        this.defaultQuality = defaultQuality;
        this.effectOverrides = effectOverrides ?? null;
    }

    setDefaultQuality(quality: MaterialQuality): void {
        this.defaultQuality = quality;
    }

    setEffectOverrides(overrides: Partial<MaterialEffects> | null): void {
        this.effectOverrides = overrides;
    }

    private getPreset(quality?: MaterialQuality): QualityPreset {
        const base = QUALITY_PRESETS[quality ?? this.defaultQuality];
        if (!this.effectOverrides) return base;
        return {
            textureSize: base.textureSize,
            effects: { ...base.effects, ...this.effectOverrides },
        };
    }

    private trackTexture(texture: THREE.CanvasTexture): THREE.CanvasTexture {
        this.textures.push(texture);
        return texture;
    }


    private getCacheKey(type: string, color: number | string | undefined, quality?: MaterialQuality): string {
        const qualityKey = quality ?? this.defaultQuality;
        const overrides = this.effectOverrides ? JSON.stringify(this.effectOverrides) : 'default';
        return `${type}_${color}_${qualityKey}_${overrides}`;
    }

    private trackMaterial<T extends THREE.Material>(material: T): T {
        this.materials.push(material);
        return material;
    }

    private makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        return { canvas, ctx };
    }

    private wrapTexture(canvas: HTMLCanvasElement, repeatX: number = 1, repeatY: number = 1): THREE.CanvasTexture {
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        if (repeatX !== 1 || repeatY !== 1) {
            texture.repeat.set(repeatX, repeatY);
        }
        return this.trackTexture(texture);
    }

    private clamp(v: number, min: number = 0, max: number = 255): number {
        return Math.min(max, Math.max(min, v));
    }

    private extractRGB(color: number): { r: number; g: number; b: number } {
        return {
            r: (color >> 16) & 0xff,
            g: (color >> 8) & 0xff,
            b: color & 0xff,
        };
    }

    private normalFromHeight(data: Uint8ClampedArray, size: number, strength: number): ImageData {
        const result = new ImageData(size, size);
        const out = result.data;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const left = data[(y * size + ((x - 1 + size) % size)) * 4];
                const right = data[(y * size + ((x + 1) % size)) * 4];
                const up = data[(((y - 1 + size) % size) * size + x) * 4];
                const down = data[(((y + 1) % size) * size + x) * 4];
                const dx = (left - right) / 255 * strength;
                const dy = (up - down) / 255 * strength;
                const dz = 1.0;
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                out[i] = ((dx / len) * 0.5 + 0.5) * 255;
                out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
                out[i + 2] = ((dz / len) * 0.5 + 0.5) * 255;
                out[i + 3] = 255;
            }
        }
        return result;
    }

    private addFingerprints(data: Uint8ClampedArray, size: number, count: number): void {
        for (let s = 0; s < count; s++) {
            const cx = Math.random() * size;
            const cy = Math.random() * size;
            const rx = size * 0.04 + Math.random() * size * 0.08;
            const ry = size * 0.03 + Math.random() * size * 0.06;
            const angle = Math.random() * Math.PI;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            const reach = Math.max(rx, ry) + 2;
            const yMin = Math.max(0, Math.floor(cy - reach));
            const yMax = Math.min(size, Math.ceil(cy + reach));
            const xMin = Math.max(0, Math.floor(cx - reach));
            const xMax = Math.min(size, Math.ceil(cx + reach));
            for (let y = yMin; y < yMax; y++) {
                for (let x = xMin; x < xMax; x++) {
                    const dx = x - cx;
                    const dy = y - cy;
                    const rdx = dx * cosA + dy * sinA;
                    const rdy = -dx * sinA + dy * cosA;
                    const dist = (rdx * rdx) / (rx * rx) + (rdy * rdy) / (ry * ry);
                    if (dist < 1) {
                        const falloff = (1 - dist) * (1 - dist);
                        const idx = (y * size + x) * 4;
                        const bump = falloff * 50;
                        data[idx] = Math.min(255, data[idx] + bump);
                        data[idx + 1] = Math.min(255, data[idx + 1] + bump);
                        data[idx + 2] = Math.min(255, data[idx + 2] + bump);
                    }
                }
            }
        }
    }

    createLeatherMaterial(color: number = 0x8B4513, quality?: MaterialQuality): THREE.MeshPhysicalMaterial {
        const cacheKey = this.getCacheKey('leather', color, quality);
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey) as any;
        }

        const { textureSize: size, effects } = this.getPreset(quality);
        const { r, g, b } = this.extractRGB(color);

        const { canvas: colorCanvas, ctx: colorCtx } = this.makeCanvas(size);
        const colorImg = colorCtx.createImageData(size, size);
        for (let i = 0; i < colorImg.data.length; i += 4) {
            const noise = Math.random() * 30 - 15;
            colorImg.data[i] = this.clamp(r + noise);
            colorImg.data[i + 1] = this.clamp(g + noise * 0.8);
            colorImg.data[i + 2] = this.clamp(b + noise * 0.6);
            colorImg.data[i + 3] = 255;
        }
        colorCtx.putImageData(colorImg, 0, 0);

        const params: THREE.MeshPhysicalMaterialParameters = {
            map: this.wrapTexture(colorCanvas, 2, 2),
            roughness: 0.65,
            metalness: 0.05,
            clearcoat: 0.1,
            clearcoatRoughness: 0.8,
        };

        if (effects.normalMaps) {
            const { ctx: hCtx } = this.makeCanvas(size);
            const hImg = hCtx.createImageData(size, size);
            for (let i = 0; i < hImg.data.length; i += 4) {
                const v = Math.random() * 60 + 100;
                hImg.data[i] = v;
                hImg.data[i + 1] = v;
                hImg.data[i + 2] = v;
                hImg.data[i + 3] = 255;
            }
            const poreCount = Math.floor(size * size * 0.015);
            for (let p = 0; p < poreCount; p++) {
                const px = Math.floor(Math.random() * size);
                const py = Math.floor(Math.random() * size);
                const pr = Math.random() * 2 + 1;
                const rCeil = Math.ceil(pr);
                for (let dy = -rCeil; dy <= rCeil; dy++) {
                    for (let dx = -rCeil; dx <= rCeil; dx++) {
                        if (dx * dx + dy * dy <= pr * pr) {
                            const nx = (px + dx + size) % size;
                            const ny = (py + dy + size) % size;
                            const idx = (ny * size + nx) * 4;
                            const darken = (1 - Math.sqrt(dx * dx + dy * dy) / pr) * 50;
                            hImg.data[idx] = Math.max(0, hImg.data[idx] - darken);
                            hImg.data[idx + 1] = Math.max(0, hImg.data[idx + 1] - darken);
                            hImg.data[idx + 2] = Math.max(0, hImg.data[idx + 2] - darken);
                        }
                    }
                }
            }
            hCtx.putImageData(hImg, 0, 0);
            const normalData = this.normalFromHeight(hImg.data, size, 2.0);
            const { canvas: nCanvas, ctx: nCtx } = this.makeCanvas(size);
            nCtx.putImageData(normalData, 0, 0);
            params.normalMap = this.wrapTexture(nCanvas, 2, 2);
            params.normalScale = new THREE.Vector2(0.8, 0.8);
        }

        if (effects.roughnessMaps) {
            const { canvas: rCanvas, ctx: rCtx } = this.makeCanvas(size);
            const rImg = rCtx.createImageData(size, size);
            for (let i = 0; i < rImg.data.length; i += 4) {
                const v = Math.random() * 60 + 140;
                rImg.data[i] = v;
                rImg.data[i + 1] = v;
                rImg.data[i + 2] = v;
                rImg.data[i + 3] = 255;
            }
            rCtx.putImageData(rImg, 0, 0);
            params.roughnessMap = this.wrapTexture(rCanvas, 2, 2);
        }


        const material = new THREE.MeshPhysicalMaterial(params);
        this.materialCache.set(cacheKey, material);
        return this.trackMaterial(material);
    }

    createBrushedMetalMaterial(color: number = 0xcccccc, quality?: MaterialQuality): THREE.MeshPhysicalMaterial {
        const cacheKey = this.getCacheKey('metal', color, quality);
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey) as any;
        }

        const { textureSize: size, effects } = this.getPreset(quality);
        const { r, g, b } = this.extractRGB(color);

        const { canvas: colorCanvas, ctx: colorCtx } = this.makeCanvas(size);
        const colorImg = colorCtx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            const rowNoise = Math.random() * 20 - 10;
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const pixNoise = Math.random() * 8 - 4;
                colorImg.data[i] = this.clamp(r + rowNoise + pixNoise);
                colorImg.data[i + 1] = this.clamp(g + rowNoise + pixNoise);
                colorImg.data[i + 2] = this.clamp(b + rowNoise + pixNoise);
                colorImg.data[i + 3] = 255;
            }
        }
        colorCtx.putImageData(colorImg, 0, 0);

        const params: THREE.MeshPhysicalMaterialParameters = {
            map: this.wrapTexture(colorCanvas),
            roughness: 0.35,
            metalness: 0.9,
            clearcoat: 0.3,
            clearcoatRoughness: 0.4,
        };

        if (effects.normalMaps) {
            const { ctx: hCtx } = this.makeCanvas(size);
            const hImg = hCtx.createImageData(size, size);
            for (let y = 0; y < size; y++) {
                const baseH = 128 + Math.sin(y * 0.5) * 20 + Math.random() * 15;
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const v = this.clamp(baseH + Math.random() * 6);
                    hImg.data[i] = v;
                    hImg.data[i + 1] = v;
                    hImg.data[i + 2] = v;
                    hImg.data[i + 3] = 255;
                }
            }
            hCtx.putImageData(hImg, 0, 0);
            const normalData = this.normalFromHeight(hImg.data, size, 1.5);
            const { canvas: nCanvas, ctx: nCtx } = this.makeCanvas(size);
            nCtx.putImageData(normalData, 0, 0);
            params.normalMap = this.wrapTexture(nCanvas);
            params.normalScale = new THREE.Vector2(0.5, 0.5);
        }

        if (effects.roughnessMaps) {
            const { canvas: rCanvas, ctx: rCtx } = this.makeCanvas(size);
            const rImg = rCtx.createImageData(size, size);
            for (let y = 0; y < size; y++) {
                const rowVal = 70 + Math.random() * 30;
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const v = this.clamp(rowVal + Math.random() * 10);
                    rImg.data[i] = v;
                    rImg.data[i + 1] = v;
                    rImg.data[i + 2] = v;
                    rImg.data[i + 3] = 255;
                }
            }
            rCtx.putImageData(rImg, 0, 0);
            params.roughnessMap = this.wrapTexture(rCanvas);
        }


        const material = new THREE.MeshPhysicalMaterial(params);
        this.materialCache.set(cacheKey, material);
        return this.trackMaterial(material);
    }

    createGlassMaterial(tint: number = 0xffffff, quality?: MaterialQuality): THREE.MeshPhysicalMaterial {
        const { textureSize: size, effects } = this.getPreset(quality);

        const params: THREE.MeshPhysicalMaterialParameters = {
            color: tint,
            metalness: 0.0,
            roughness: 0.05,
            transmission: 0.9,
            thickness: 0.02,
            ior: 1.5,
            transparent: true,
            opacity: 0.3,
            envMapIntensity: 1.0,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
        };

        if (effects.imperfections) {
            const { canvas: rCanvas, ctx: rCtx } = this.makeCanvas(size);
            const rImg = rCtx.createImageData(size, size);
            for (let i = 0; i < rImg.data.length; i += 4) {
                rImg.data[i] = 8 + Math.random() * 4;
                rImg.data[i + 1] = 8 + Math.random() * 4;
                rImg.data[i + 2] = 8 + Math.random() * 4;
                rImg.data[i + 3] = 255;
            }
            this.addFingerprints(rImg.data, size, 3 + Math.floor(Math.random() * 4));
            rCtx.putImageData(rImg, 0, 0);
            params.roughnessMap = this.wrapTexture(rCanvas);
        }

        return this.trackMaterial(new THREE.MeshPhysicalMaterial(params));
    }

    createCarbonFiberMaterial(quality?: MaterialQuality): THREE.MeshPhysicalMaterial {
        const cacheKey = this.getCacheKey('carbon', undefined, quality);
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey) as any;
        }

        const { textureSize: size, effects } = this.getPreset(quality);
        const cellSize = Math.max(4, Math.floor(size / 16));

        const { canvas: colorCanvas, ctx: colorCtx } = this.makeCanvas(size);
        const colorImg = colorCtx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const i = (y * size + x) * 4;
                const cellX = Math.floor(x / cellSize);
                const cellY = Math.floor(y / cellSize);
                const pattern = (cellX + cellY) % 2 === 0;
                const fx = (x % cellSize) / cellSize;
                const fy = (y % cellSize) / cellSize;
                const grad = pattern
                    ? 0.8 + 0.2 * Math.sin(fx * Math.PI)
                    : 0.8 + 0.2 * Math.sin(fy * Math.PI);
                const base = pattern ? 55 : 30;
                const v = base * grad + Math.random() * 5;
                colorImg.data[i] = v;
                colorImg.data[i + 1] = v;
                colorImg.data[i + 2] = v + 3;
                colorImg.data[i + 3] = 255;
            }
        }
        colorCtx.putImageData(colorImg, 0, 0);

        const params: THREE.MeshPhysicalMaterialParameters = {
            map: this.wrapTexture(colorCanvas, 4, 4),
            roughness: 0.3,
            metalness: 0.4,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
        };

        if (effects.normalMaps) {
            const { ctx: hCtx } = this.makeCanvas(size);
            const hImg = hCtx.createImageData(size, size);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    const cellX = Math.floor(x / cellSize);
                    const cellY = Math.floor(y / cellSize);
                    const pattern = (cellX + cellY) % 2 === 0;
                    const fx = (x % cellSize) / cellSize;
                    const fy = (y % cellSize) / cellSize;
                    const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * cellSize;
                    const height = pattern ? 160 : 100;
                    const edgeBlend = Math.min(edge, 1) * 40;
                    const v = this.clamp(height - 40 + edgeBlend + Math.random() * 3);
                    hImg.data[i] = v;
                    hImg.data[i + 1] = v;
                    hImg.data[i + 2] = v;
                    hImg.data[i + 3] = 255;
                }
            }
            hCtx.putImageData(hImg, 0, 0);
            const normalData = this.normalFromHeight(hImg.data, size, 3.0);
            const { canvas: nCanvas, ctx: nCtx } = this.makeCanvas(size);
            nCtx.putImageData(normalData, 0, 0);
            params.normalMap = this.wrapTexture(nCanvas, 4, 4);
            params.normalScale = new THREE.Vector2(1.0, 1.0);
        }


        const material = new THREE.MeshPhysicalMaterial(params);
        this.materialCache.set(cacheKey, material);
        return this.trackMaterial(material);
    }

    createVelvetMaterial(color: number = 0x800020, quality?: MaterialQuality): THREE.MeshPhysicalMaterial {
        const cacheKey = this.getCacheKey('velvet', color, quality);
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey) as any;
        }

        const { textureSize: size, effects } = this.getPreset(quality);
        const { r, g, b } = this.extractRGB(color);

        const { canvas: colorCanvas, ctx: colorCtx } = this.makeCanvas(size);
        const colorImg = colorCtx.createImageData(size, size);
        for (let i = 0; i < colorImg.data.length; i += 4) {
            const noise = Math.random() * 15 - 7;
            colorImg.data[i] = this.clamp(r + noise);
            colorImg.data[i + 1] = this.clamp(g + noise);
            colorImg.data[i + 2] = this.clamp(b + noise);
            colorImg.data[i + 3] = 255;
        }
        colorCtx.putImageData(colorImg, 0, 0);

        const params: THREE.MeshPhysicalMaterialParameters = {
            map: this.wrapTexture(colorCanvas, 3, 3),
            roughness: 0.9,
            metalness: 0.0,
            sheen: 1.0,
            sheenRoughness: 0.5,
            sheenColor: new THREE.Color(color).multiplyScalar(1.5),
        };

        if (effects.roughnessMaps) {
            const { canvas: rCanvas, ctx: rCtx } = this.makeCanvas(size);
            const rImg = rCtx.createImageData(size, size);
            for (let i = 0; i < rImg.data.length; i += 4) {
                const v = this.clamp(200 + Math.random() * 40);
                rImg.data[i] = v;
                rImg.data[i + 1] = v;
                rImg.data[i + 2] = v;
                rImg.data[i + 3] = 255;
            }
            rCtx.putImageData(rImg, 0, 0);
            params.roughnessMap = this.wrapTexture(rCanvas, 3, 3);
        }


        const material = new THREE.MeshPhysicalMaterial(params);
        this.materialCache.set(cacheKey, material);
        return this.trackMaterial(material);
    }

    createCarPaintMaterial(color: number = 0xcc0000, quality?: MaterialQuality): THREE.MeshPhysicalMaterial {
        const cacheKey = this.getCacheKey('carpaint', color, quality);
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey) as any;
        }

        const { textureSize: size, effects } = this.getPreset(quality);

        const params: THREE.MeshPhysicalMaterialParameters = {
            color,
            roughness: 0.15,
            metalness: 0.5,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            envMapIntensity: 1.0,
        };

        if (effects.normalMaps) {
            const { ctx: hCtx } = this.makeCanvas(size);
            const hImg = hCtx.createImageData(size, size);
            for (let i = 0; i < hImg.data.length; i += 4) {
                const v = 128 + Math.random() * 8 - 4;
                hImg.data[i] = v;
                hImg.data[i + 1] = v;
                hImg.data[i + 2] = v;
                hImg.data[i + 3] = 255;
            }
            hCtx.putImageData(hImg, 0, 0);
            const normalData = this.normalFromHeight(hImg.data, size, 0.5);
            const { canvas: nCanvas, ctx: nCtx } = this.makeCanvas(size);
            nCtx.putImageData(normalData, 0, 0);
            params.normalMap = this.wrapTexture(nCanvas, 2, 2);
            params.normalScale = new THREE.Vector2(0.3, 0.3);
        }

        if (effects.imperfections) {
            const { canvas: rCanvas, ctx: rCtx } = this.makeCanvas(size);
            const rImg = rCtx.createImageData(size, size);
            for (let i = 0; i < rImg.data.length; i += 4) {
                const v = 30 + Math.random() * 15;
                rImg.data[i] = v;
                rImg.data[i + 1] = v;
                rImg.data[i + 2] = v;
                rImg.data[i + 3] = 255;
            }
            this.addFingerprints(rImg.data, size, 2);
            rCtx.putImageData(rImg, 0, 0);
            params.roughnessMap = this.wrapTexture(rCanvas, 2, 2);
        }


        const material = new THREE.MeshPhysicalMaterial(params);
        this.materialCache.set(cacheKey, material);
        return this.trackMaterial(material);
    }

    createDustOverlay(intensity: number = 0.3, quality?: MaterialQuality): THREE.MeshStandardMaterial {
        const cacheKey = this.getCacheKey('dust', intensity, quality);
        if (this.materialCache.has(cacheKey)) {
            return this.materialCache.get(cacheKey) as any;
        }

        const { textureSize: size } = this.getPreset(quality);

        const { canvas: alphaCanvas, ctx: alphaCtx } = this.makeCanvas(size);
        const alphaImg = alphaCtx.createImageData(size, size);
        for (let i = 0; i < alphaImg.data.length; i += 4) {
            const hasDust = Math.random() < intensity * 0.5;
            const v = hasDust ? Math.floor(30 + Math.random() * 70) : 0;
            alphaImg.data[i] = v;
            alphaImg.data[i + 1] = v;
            alphaImg.data[i + 2] = v;
            alphaImg.data[i + 3] = 255;
        }
        for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
                const i = (y * size + x) * 4;
                if (alphaImg.data[i] === 0) {
                    let neighborDust = 0;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const ni = ((y + dy) * size + (x + dx)) * 4;
                            if (alphaImg.data[ni] > 0) neighborDust++;
                        }
                    }
                    if (neighborDust >= 2 && Math.random() < 0.4) {
                        const spread = Math.floor(20 + Math.random() * 40);
                        alphaImg.data[i] = spread;
                        alphaImg.data[i + 1] = spread;
                        alphaImg.data[i + 2] = spread;
                    }
                }
            }
        }
        alphaCtx.putImageData(alphaImg, 0, 0);


        const material = new THREE.MeshStandardMaterial({
            color: 0xd4c8b8,
            alphaMap: this.wrapTexture(alphaCanvas, 3, 3),
            transparent: true,
            roughness: 1.0,
            metalness: 0.0,
            depthWrite: false,
        });
        this.materialCache.set(cacheKey, material);
        return this.trackMaterial(material);
    }

    dispose(): void {
        this.materialCache.clear();
        const disposed = new Set<number>();
        for (const texture of this.textures) {
            texture.dispose();
            disposed.add(texture.id);
        }
        this.textures = [];
        for (const material of this.materials) {
            const mat = material as unknown as Record<string, unknown>;
            for (const prop of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
                const tex = mat[prop];
                if (tex instanceof THREE.Texture && !disposed.has(tex.id)) {
                    tex.dispose();
                    disposed.add(tex.id);
                }
                if (tex) {
                    mat[prop] = null;
                }
            }
            material.dispose();
        }
        this.materials = [];
    }
}
