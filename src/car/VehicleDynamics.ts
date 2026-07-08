/**
 * VehicleDynamics — lightweight speed/RPM/gear simulation for the dashboard.
 *
 * Street View movement is discrete (panorama hops), so real velocity has to be
 * inferred: each hop reports its GPS distance and the model converts sustained
 * hopping (manual driving or cruise mode) into a smooth speed that coasts back
 * down when movement stops. RPM follows speed through a simple gearbox with
 * shift drops and a throttle flare while accelerating.
 */

export interface VehicleTelemetry {
    /** Vehicle speed in km/h */
    speedKmh: number;
    /** Engine RPM */
    rpm: number;
    /** Gear indicator: P, R, 1-3, D */
    gear: string;
    /** True while the model is actively accelerating toward a higher speed */
    accelerating: boolean;
}

const IDLE_RPM = 850;
const MAX_SPEED_KMH = 160;
const ACCEL_KMH_PER_S = 22;
const BRAKE_KMH_PER_S = 30;
const COAST_KMH_PER_S = 9;
/** Target speed starts bleeding off this long after the last movement input (s). */
const COAST_DELAY_S = 2.4;
/** Upshift speeds (km/h); the band above the last entry is top gear. */
const SHIFT_POINTS = [0, 20, 40, 65, 95];

export class VehicleDynamics {
    private speed = 0;
    private targetSpeed = 0;
    private rpm = IDLE_RPM;
    /** Simulation seconds since the last movement input. */
    private sinceMove = Infinity;
    private reversing = false;

    /**
     * Report a panorama hop of `distanceMeters`. Repeated hops (cruise mode,
     * held W) sustain the target speed; a lone hop gives a short surge.
     */
    public notePanoHop(distanceMeters: number): void {
        if (!(distanceMeters > 0) || distanceMeters > 300) return;
        // A typical hop is ~10 m every ~1.5 s in cruise → reads as ~25-40 km/h.
        const estimate = Math.min(MAX_SPEED_KMH * 0.6, 14 + distanceMeters * 2.2);
        this.targetSpeed = Math.max(this.targetSpeed, estimate);
        this.reversing = false;
        this.sinceMove = 0;
    }

    /** Report a W/S thrust input. */
    public noteThrust(direction: 'forward' | 'backward'): void {
        if (direction === 'forward') {
            this.targetSpeed = Math.max(this.targetSpeed, 30);
            this.reversing = false;
        } else {
            this.targetSpeed = Math.max(this.targetSpeed, 12);
            this.reversing = this.speed < 20;
        }
        this.sinceMove = 0;
    }

    /** Immediately kill all motion (e.g. entering free-look). */
    public stop(): void {
        this.targetSpeed = 0;
        this.reversing = false;
    }

    /** Advance the simulation by dt seconds and return current telemetry. */
    public update(dt: number): VehicleTelemetry {
        const clamped = Math.min(Math.max(dt, 0), 0.1);

        this.sinceMove += clamped;
        if (this.sinceMove > COAST_DELAY_S) {
            this.targetSpeed = Math.max(0, this.targetSpeed - COAST_KMH_PER_S * clamped);
        }

        const diff = this.targetSpeed - this.speed;
        const accelerating = diff > 1.5;
        const rate = diff > 0 ? ACCEL_KMH_PER_S : -BRAKE_KMH_PER_S;
        if (Math.abs(diff) <= Math.abs(rate) * clamped) {
            this.speed = this.targetSpeed;
        } else {
            this.speed += rate * clamped;
        }

        // Gearbox: find the band, run RPM up within it, drop on shift.
        let gearNum = 1;
        while (gearNum < SHIFT_POINTS.length && this.speed > SHIFT_POINTS[gearNum]) gearNum++;
        const lo = SHIFT_POINTS[gearNum - 1];
        const hi = gearNum < SHIFT_POINTS.length ? SHIFT_POINTS[gearNum] : MAX_SPEED_KMH;
        const bandFrac = Math.min(1, (this.speed - lo) / (hi - lo));
        const targetRpm = this.speed < 0.5
            ? IDLE_RPM
            : 1200 + bandFrac * 3200 + (accelerating ? 700 : 0);
        this.rpm += (targetRpm - this.rpm) * Math.min(1, clamped * 4.5);

        let gear: string;
        if (this.speed < 0.5 && this.targetSpeed < 0.5) gear = 'P';
        else if (this.reversing) gear = 'R';
        else gear = gearNum <= 3 ? String(gearNum) : 'D';

        return { speedKmh: this.speed, rpm: this.rpm, gear, accelerating };
    }
}
