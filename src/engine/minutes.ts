// Minutes / role projection. STUB for Phase 1.
//
// The intended Phase 1.5 implementation:
//   - Pull last-30-day minutes per player from gamelogs.
//   - Weight against season minutes (recency bias).
//   - Adjust for confirmed injuries on the player's team (opportunity boost).
// Output: a per-player minutes projection that the Marcel source uses to
// scale per-36 stats into per-game.
//
// Phase 1 ESPN projections are already per-game so we don't need this yet.

export function projectMinutes(): never {
  throw new Error(
    "Minutes model not implemented. " +
      "Phase 1 uses ESPN per-game projections directly. Minutes/role projection lands in Phase 1.5.",
  );
}
