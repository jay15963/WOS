// Atlas validation against the game content: every contract name, every creature species (non-pawn) with
// its own <sp>_{s,n,e}, art for every structure / flora / natural / crop kind. Used to reject a cached atlas,
// to refuse multiplayer with incomplete graphics and by game.net.selfTest(). Lives on the game side (not in
// src/art) so the art module graph — and thus ART_ID — does not depend on balance/content files.

import { SPECIES, BUILDINGS } from './data.js';
import { CONTRACT, hasKindArt, atlasDigest } from '../art/contract.js';
import { FLORA_KINDS } from './flora.js';
import { CROPS } from './farming.js';

export function requiredSprites() {
  const out = new Set(CONTRACT);
  for (const sp in SPECIES) if (!SPECIES[sp].pawn) for (const d of ['s', 'n', 'e']) out.add(`${sp}_${d}`);
  for (const k in CROPS) out.add(`crop_${k}_0`);
  return [...out];
}

// kinds that only need *some* art (type, type_0, type_h, type_<n>)
export function requiredKinds() {
  return [...Object.keys(BUILDINGS), ...FLORA_KINDS, 'boulder', 'tent', 'crate', 'banner'];
}

// -> { ok, missingSprites, missingKinds, speciesFallbacks, placeholders, failures, digest }
export function checkAtlas(A) {
  const names = A.sprites; // Map name -> sprite
  const missingSprites = requiredSprites().filter((n) => !names.has(n));
  const missingKinds = requiredKinds().filter((k) => !hasKindArt(names, k) && !A.groups?.[k]);
  const speciesFallbacks = Object.keys(SPECIES).filter((sp) => !SPECIES[sp].pawn && !names.has(sp + '_s'));
  const placeholders = A.placeholders || [];
  const failures = A.failures || [];
  return {
    ok: !missingSprites.length && !missingKinds.length && !placeholders.length && !failures.length,
    missingSprites, missingKinds, speciesFallbacks, placeholders, failures,
    digest: atlasDigest(names.keys()),
  };
}
