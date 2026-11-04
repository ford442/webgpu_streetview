/**
 * The seven classes the semantic layer labels (#352), collapsed from the
 * model's 19 Cityscapes classes by the table in `semanticModel.manifest.json`
 * — the same table `scripts/fetch-models.mjs` bakes into the model's class
 * head, so channel k of the model output *is* class k here.
 *
 * In the `rg8unorm` map, R holds `id + 1` (0 = unlabelled: the 1×1 fallback,
 * or no map yet) and G the class probability. The WGSL `CLASS_*` constants in
 * both weather shaders must match (`semanticClasses.test.ts` reads them).
 */
import { classes } from './semanticModel.manifest.json';

export const SemanticClass = {
    sky: 0,
    road: 1,
    sidewalk: 2,
    building: 3,
    vegetation: 4,
    vehicle: 5,
    person: 6,
} as const;

export type SemanticClassName = keyof typeof SemanticClass;

export const SEMANTIC_CLASS_COUNT = 7;

/** Class names in id order, from the manifest. */
export const SEMANTIC_CLASS_NAMES: readonly SemanticClassName[] = classes.map(
    (c) => c.name as SemanticClassName,
);

/** Source (Cityscapes) labels behind each class, in id order. */
export const SEMANTIC_CLASS_SOURCES: readonly (readonly string[])[] = classes.map((c) => c.from);

/** The `rg8unorm` texel format of the semantic map. */
export const SEMANTIC_MAP_FORMAT: GPUTextureFormat = 'rg8unorm';
