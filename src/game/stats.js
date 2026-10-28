// Level curve + stat scaling (pure functions).

export const MAX_LEVEL = 20;

export const xpToNext = (L) => Math.round(100 * Math.pow(L, 1.5) + 20 * L);

export function playerStats(L) {
  return {
    maxHp: 100 + 16 * (L - 1),
    maxEnergy: 100,
    wMin: 5 + 2 * (L - 1),
    wMax: 9 + 3 * (L - 1),
    swing: 1.6,
    crit: 0.08 + 0.004 * L,
    dodge: 0.05,
  };
}

export function mobStats(sp, L) {
  return {
    maxHp: Math.round(sp.hp * (1 + 0.25 * (L - 1)) * (sp.elite ? 1.1 : 1)),
    dmg: sp.dmg * (1 + 0.16 * (L - 1)),
  };
}

// XP for killing a mob of level mobL at player level plL (0 when trivial / gray)
export function mobXp(sp, mobL, plL) {
  const diff = mobL - plL;
  if (diff <= -5) return 0;
  const f = Math.max(0.15, Math.min(1.5, 1 + 0.12 * diff));
  return Math.max(1, Math.round((30 + 10 * mobL) * sp.xp * f));
}

// WoW-like level color for a mob relative to the player
export function levelColor(mobL, plL) {
  const d = mobL - plL;
  if (d >= 5) return '#ff3b30';
  if (d >= 3) return '#ff8a2a';
  if (d >= -2) return '#ffd84a';
  if (d >= -4) return '#5fd35a';
  return '#9a9a9a';
}
