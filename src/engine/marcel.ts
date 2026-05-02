// Marcel projection model. STUB for Phase 1.
//
// The Marcel projection (Tom Tango, ported here for fantasy basketball) is
// a 5/4/3-weighted blend of the last three seasons regressed toward a
// league mean, with an age-curve adjustment. Phase 1 ships with ESPN's
// kona_player_info projections (already per-game) via projectionSource.ts.
// Phase 1.5 will replace the source with a Marcel-derived ProjectionSource
// that consumes NBA gamelogs.
//
// This file exists so callers can import a stable name and so the Phase
// 1.5 swap is a one-file change.

import type { ProjectionSource } from "../shared/types";

export function createMarcelProjectionSource(): ProjectionSource {
  throw new Error(
    "Marcel projection source not implemented. " +
      "Phase 1 uses createEspnProjectionSource. Marcel is scheduled for Phase 1.5.",
  );
}
