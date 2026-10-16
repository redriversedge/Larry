// Value above replacement, in games.
// docs/RANKINGS_V3_AND_LIVE_DRAFT_SPEC.md A3.
//
// Pure, per CLAUDE.md.
//
// The old preseason board measured a player against an AVERAGE STARTER and
// then applied a soft discount for expected absences. Both halves are
// wrong in the same direction.
//
// What a missed game actually costs you is not the player's production, it
// is the difference between the player and whoever you stream in their
// place. That is the replacement-level player: the best person still on
// the waiver wire, which in a 12-team league with 13 roster spots is about
// the 157th-best player. A star who plays 55 games is worth 55 games of
// (star minus waiver), not 55/82 of a season of (star minus average
// starter).
//
// Measured on the reviewer's reconstruction, swapping to this form was
// worth +0.018 season rho in 2024-25 and +0.013 in 2025-26 on its own.
//
// It also fixes a real sign problem. A player below replacement gets a
// NEGATIVE season value, which is correct and which the old multiplicative
// discount could not express: scaling a negative by a fraction raises it.

export interface SeasonValueInput {
  id: number;
  // Sum of capped per-game category z, exactly as the shipped board
  // computes it. Not a per-game rate; a per-game VALUE.
  rateValue: number;
  // Games the player is expected to actually play (src/engine/durability).
  expectedGP: number;
  // ESPN's projection for this player is a data error rather than a
  // forecast; leave their games alone. See PRESEASON_SUSPECT_GP.
  suspect?: boolean;
}

// A full season, used only to keep seasonValue on roughly the same scale
// as rateValue so the displayed number stays familiar.
const SEASON_GAMES = 82;

// The replacement player's per-game value: the rateValue of the player
// ranked one past the last rostered spot. In a 12-team league with 13
// roster spots that is the 157th-best player by rate.
export function replacementLevel(rateValues: number[], poolSize: number): number {
  if (!rateValues.length) return 0;
  const sorted = rateValues.slice().sort((a, b) => b - a);
  const index = Math.min(poolSize, sorted.length - 1);
  return sorted[index] as number;
}

// seasonValue = (rateValue - replacement) * expectedGP / 82
//
// poolSize is teamCount * rosterSize, from league settings. Never
// hardcoded: a 10-team league has a much shallower waiver wire and a
// correspondingly higher replacement level.
export function seasonValues(
  players: SeasonValueInput[],
  poolSize: number,
): Map<number, number> {
  const replacement = replacementLevel(
    players.map((p) => p.rateValue),
    poolSize,
  );

  const out = new Map<number, number>();
  for (const p of players) {
    // A suspect projection (ESPN publishing a 1-game season for a healthy
    // star) must not be allowed to zero out a real player. Treat them as a
    // full season and let the rate carry the score, which is what the
    // shipped board does today.
    const games = p.suspect ? SEASON_GAMES : p.expectedGP;
    out.set(p.id, ((p.rateValue - replacement) * games) / SEASON_GAMES);
  }
  return out;
}

export interface SeasonValueDetail {
  rateValue: number;
  replacement: number;
  expectedGP: number;
  seasonValue: number;
}

// Single-player version for the UI, where the replacement level has
// already been computed for the whole board.
export function seasonValueFor(
  rateValue: number,
  replacement: number,
  expectedGP: number,
  suspect = false,
): number {
  const games = suspect ? SEASON_GAMES : expectedGP;
  return ((rateValue - replacement) * games) / SEASON_GAMES;
}
