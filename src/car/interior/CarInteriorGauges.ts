import * as THREE from 'three';

export interface CarInteriorGaugeResult {
    speedometerNeedle: THREE.Mesh;
    tachometerNeedle: THREE.Mesh;
    digitalClockMesh?: THREE.Mesh;
    clockCanvas?: HTMLCanvasElement;
    clockCtx?: CanvasRenderingContext2D;
    clockUpdateInterval?: number;
}

export class CarInteriorGauges {
    static build(
        interiorGroup: THREE.Group,
        metalMaterial: THREE.MeshStandardMaterial,
        vehicleConfig: { accentColor: string },
        gpuProfile: { name: string },
        quality: 'high' | 'medium' | 'low'
    ): CarInteriorGaugeResult {
        const result = CarInteriorGauges.buildGauges(interiorGroup, metalMaterial);
        if (quality !== 'low') {
            const clock = CarInteriorGauges.buildDigitalClock(interiorGroup, vehicleConfig, gpuProfile);
            return {
                ...result,
                ...clock,
            };
        }
        return result;
    }

    private static buildGauges(
        interiorGroup: THREE.Group,
        metalMaterial: THREE.MeshStandardMaterial
    ): { speedometerNeedle: THREE.Mesh; tachometerNeedle: THREE.Mesh } {
        const buildDialCanvas = (size: number, emissiveColor: string, labelMax: number, unit: string): HTMLCanvasElement => {
            const c = document.createElement('canvas');
            c.width = size; c.height = size;
            const ctx = c.getContext('2d')!;

            const bg = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
            bg.addColorStop(0, '#222222');
            bg.addColorStop(1, '#0d0d0d');
            ctx.fillStyle = bg;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = emissiveColor;
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.45;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size/2 - 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            const startAngle = -Math.PI * 0.75;
            const sweepAngle = Math.PI * 1.5;
            const majorTicks = 6;
            const minorTicks = 30;
            for (let i = 0; i <= minorTicks; i++) {
                const a = startAngle + (i / minorTicks) * sweepAngle;
                const isMajor = i % (minorTicks / majorTicks) === 0;
                const inner = isMajor ? size/2 - 18 : size/2 - 11;
                const outer = size/2 - 6;
                ctx.strokeStyle = isMajor ? emissiveColor : 'rgba(255,255,255,0.35)';
                ctx.lineWidth = isMajor ? 2 : 1;
                ctx.beginPath();
                ctx.moveTo(size/2 + Math.cos(a) * inner, size/2 + Math.sin(a) * inner);
                ctx.lineTo(size/2 + Math.cos(a) * outer, size/2 + Math.sin(a) * outer);
                ctx.stroke();

                if (isMajor) {
                    const labelRadius = size/2 - 28;
                    const val = Math.round((i / minorTicks) * labelMax);
                    ctx.fillStyle = 'rgba(255,255,255,0.75)';
                    ctx.font = `bold ${Math.round(size * 0.10)}px "Arial Narrow", Arial, sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(String(val), size/2 + Math.cos(a) * labelRadius, size/2 + Math.sin(a) * labelRadius);
                }
            }

            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = `${Math.round(size * 0.09)}px "Arial Narrow", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(unit, size/2, size/2 + size * 0.28);

            ctx.fillStyle = '#1a1a1a';
            ctx.beginPath();
            ctx.arc(size/2, size/2, size * 0.08, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = emissiveColor;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.arc(size/2, size/2, size * 0.08, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1.0;

            return c;
        };

        const speedDialCanvas = buildDialCanvas(256, '#00dd88', 300, 'km/h');
        const speedTex = new THREE.CanvasTexture(speedDialCanvas);
        const speedoMat = new THREE.MeshStandardMaterial({
            map: speedTex,
            roughness: 0.7,
            emissive: new THREE.Color(0x004422),
            emissiveIntensity: 0.25,
            emissiveMap: speedTex,
        });
        const speedoGeo = new THREE.CircleGeometry(0.15, 32);
        const speedometer = new THREE.Mesh(speedoGeo, speedoMat);
        speedometer.position.set(-0.5, 0.95, -0.72);
        interiorGroup.add(speedometer);

        const needleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        const speedometerNeedle = new THREE.Mesh(needleGeo, metalMaterial);
        speedometerNeedle.position.set(-0.5, 0.98, -0.71);
        interiorGroup.add(speedometerNeedle);

        const tachoDialCanvas = buildDialCanvas(256, '#dd2200', 8, 'x1000');
        const tachoTex = new THREE.CanvasTexture(tachoDialCanvas);
        const tachoMat = new THREE.MeshStandardMaterial({
            map: tachoTex,
            roughness: 0.7,
            emissive: new THREE.Color(0x220000),
            emissiveIntensity: 0.25,
            emissiveMap: tachoTex,
        });
        const tachoGeo = new THREE.CircleGeometry(0.15, 32);
        const tachometer = new THREE.Mesh(tachoGeo, tachoMat);
        tachometer.position.set(-0.15, 0.95, -0.72);
        interiorGroup.add(tachometer);

        const tachoNeedleGeo = new THREE.BoxGeometry(0.008, 0.12, 0.008);
        const tachometerNeedle = new THREE.Mesh(tachoNeedleGeo, metalMaterial);
        tachometerNeedle.position.set(-0.15, 0.98, -0.71);
        interiorGroup.add(tachometerNeedle);

        return { speedometerNeedle, tachometerNeedle };
    }

    private static buildDigitalClock(
        interiorGroup: THREE.Group,
        vehicleConfig: { accentColor: string },
        gpuProfile: { name: string }
    ): { digitalClockMesh: THREE.Mesh; clockCanvas: HTMLCanvasElement; clockCtx: CanvasRenderingContext2D; clockUpdateInterval: number } {
        const clockCanvas = document.createElement('canvas');
        clockCanvas.width = 256;
        clockCanvas.height = 80;
        const clockCtx = clockCanvas.getContext('2d', { alpha: true })!;

        const clockTexture = new THREE.CanvasTexture(clockCanvas);
        clockTexture.anisotropy = gpuProfile.name === 'high' ? 8 : 4;
        clockTexture.generateMipmaps = true;

        const accentHex = parseInt(vehicleConfig.accentColor.replace('#', '0x'));
        const clockMaterial = new THREE.MeshStandardMaterial({
            map: clockTexture,
            emissive: new THREE.Color(accentHex),
            emissiveIntensity: 0.75,
            emissiveMap: clockTexture,
            roughness: 0.25,
            metalness: 0.15,
            transparent: true,
            opacity: 0.95,
            side: THREE.DoubleSide,
        });

        const clockGeo = new THREE.PlaneGeometry(0.22, 0.072);
        const digitalClockMesh = new THREE.Mesh(clockGeo, clockMaterial);
        digitalClockMesh.position.set(0.42, 0.91, -0.732);
        digitalClockMesh.rotation.set(-0.18, 0, 0);
        interiorGroup.add(digitalClockMesh);

        CarInteriorGauges.updateDigitalClock(clockCtx, clockCanvas, digitalClockMesh, vehicleConfig.accentColor);
        const clockUpdateInterval = window.setInterval(() => {
            CarInteriorGauges.updateDigitalClock(clockCtx, clockCanvas, digitalClockMesh, vehicleConfig.accentColor);
        }, 500);

        return { digitalClockMesh, clockCanvas, clockCtx, clockUpdateInterval };
    }

    static updateDigitalClock(
        ctx: CanvasRenderingContext2D,
        canvas: HTMLCanvasElement,
        mesh: THREE.Mesh,
        accentColor: string
    ): void {
        const W = canvas.width;
        const H = canvas.height;

        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, W, H);

        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 1;
        for (let x = 8; x < W; x += 6) {
            ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, H - 6); ctx.stroke();
        }
        for (let y = 8; y < H; y += 6) {
            ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(W - 6, y); ctx.stroke();
        }

        const bevel = ctx.createLinearGradient(0, 0, 0, H);
        bevel.addColorStop(0,    'rgba(255,255,255,0.12)');
        bevel.addColorStop(0.12, 'rgba(0,0,0,0.45)');
        bevel.addColorStop(0.88, 'rgba(0,0,0,0.45)');
        bevel.addColorStop(1,    'rgba(255,255,255,0.08)');
        ctx.fillStyle = bevel;
        ctx.fillRect(6, 6, W - 12, H - 12);

        const now = new Date();
        const hh = now.getHours().toString().padStart(2, '0');
        const mm = now.getMinutes().toString().padStart(2, '0');
        const colonVisible = (now.getSeconds() % 2) === 0;
        const timeString = colonVisible ? `${hh}:${mm}` : `${hh} ${mm}`;

        const color = accentColor || '#00ffcc';

        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.font = '700 46px "Courier New", "Consolas", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(timeString, W / 2 + 0.5, H / 2 + 1.5);

        ctx.shadowBlur = 0;
        ctx.fillText(timeString, W / 2, H / 2 + 1);

        ctx.strokeStyle = '#2a2a38';
        ctx.lineWidth = 3;
        ctx.strokeRect(3, 3, W - 6, H - 6);

        ctx.strokeStyle = '#555566';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(5, 5, W - 10, H - 10);

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(8, 8); ctx.lineTo(W - 8, 8); ctx.stroke();

        const clockMat = mesh.material as THREE.MeshStandardMaterial;
        if (clockMat.map) clockMat.map.needsUpdate = true;
    }

    static updateGaugeNeedles(
        speedometerNeedle: THREE.Mesh | null | undefined,
        tachometerNeedle: THREE.Mesh | null | undefined,
        speed: number,
        rpm: number
    ): void {
        if (speedometerNeedle) {
            const speedAngle = THREE.MathUtils.degToRad((speed / 100) * 300 - 150);
            speedometerNeedle.rotation.z = speedAngle;
        }
        if (tachometerNeedle) {
            const tachoAngle = THREE.MathUtils.degToRad((rpm / 8000) * 300 - 150);
            tachometerNeedle.rotation.z = tachoAngle;
        }
    }
}
