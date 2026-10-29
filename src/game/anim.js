// Shared walk-cycle clock. Every moving entity (local player, host creatures, remote players, creature
// proxies on guests) advances `moveT` by the SAME amount per tile actually travelled, so a remote copy
// animates exactly like the original (the pawn gait phase is moveT * 9.5 in art/compose.js).

export const GAIT_PER_TILE = 0.25;

export function stepGait(e, dist) {
  if (dist > 0) e.moveT = (e.moveT || 0) + dist * GAIT_PER_TILE;
}
