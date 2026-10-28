#pragma once
/**
 * streetview/geodesy.h
 * Internal geodesy shared across domains (graph_module.cpp's edge costs) and
 * the host tests. Not exported: the app's one-off distances are f64 TypeScript
 * (src/utils/navigation.ts); the wasm keeps the batch kernels.
 */

#include "streetview/abi.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Haversine great-circle distance between two WGS-84 points (R = 6371000 m).
 * @return Distance in metres.
 */
SW_NODISCARD double sw_haversine(double lat1, double lon1, double lat2, double lon2);

#ifdef __cplusplus
} // extern "C"
#endif
