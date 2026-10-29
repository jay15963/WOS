// Registries of intents (guest → host requests), ops (sequenced deterministic appliers run by every peer)
// and owner messages (host → one player). Leaf module (no imports) so any gameplay module can register at
// top level without import-order cycles. Definitions live in src/game/mut/*.js; tools/check-sync.mjs (R9)
// verifies that every net.emit / net.request literal is defined here and every definition is used.
//
// defineIntent(name, { doc, args, run(game, args, actor, net) -> false | 'reason' (reject) | anything (ok) })
// defineOp(name, { doc, args, apply(game, args, ctx) })   ctx = { seq, mine (args.by === me), net, auth }
// defineOwn(name, { doc, args, apply(game, args) })        runs on the owning player's client only

export const INTENTS = Object.create(null);
export const OPS = Object.create(null);
export const OWN = Object.create(null);

export function defineIntent(name, def) {
  if (!def || typeof def.doc !== 'string' || !def.args || typeof def.run !== 'function') throw new Error(`defineIntent('${name}'): doc, args e run são obrigatórios`);
  if (INTENTS[name]) throw new Error(`intent duplicada: ${name}`);
  INTENTS[name] = def;
}
export function defineOp(name, def) {
  if (!def || typeof def.doc !== 'string' || !def.args || typeof def.apply !== 'function') throw new Error(`defineOp('${name}'): doc, args e apply são obrigatórios`);
  if (OPS[name]) throw new Error(`op duplicada: ${name}`);
  OPS[name] = def;
}
export function defineOwn(name, def) {
  if (!def || typeof def.doc !== 'string' || !def.args || typeof def.apply !== 'function') throw new Error(`defineOwn('${name}'): doc, args e apply são obrigatórios`);
  OWN[name] = def;
}
