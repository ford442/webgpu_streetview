/**
 * Cortianics GT cabin — visual spec derived from the two reference interiors:
 *
 * 1. Rear cabin (day / storm): charcoal perforated leather, gold contrast
 *    stitch, gold crest on the headrests, floating landscape HUD, panoramic
 *    glass roof, carbon A-pillars.
 * 2. Front cockpit (night): red instrument cluster + dash ambient strip,
 *    Y-spoke wheel, dark Alcantara / leather with red stitch accents.
 *
 * Geometry is still procedural (same sockets as the sedan) so the existing
 * animator, wipers, mirrors, and rear-view feed keep working. The extra
 * meshes live in `CarInteriorBuilder.buildCortianicsFeatures()`.
 */

export const CORTIANICS_ACCENT = '#C9A227';
export const CORTIANICS_NIGHT_STRIP = '#DC201C';

export const CORTIANICS_REFERENCE = {
  rearCabin: 'images/vehicles/cortianics/rear-cabin.jpg',
  nightCockpit: 'images/vehicles/cortianics/night-cockpit.jpg',
} as const;
