// The player in the army (docs/REINOS.md §15 "Fase 3c — o jogador no exército"): the numbers. Pure data (node can
// import it): game/army.js runs them (who may enlist, the orders, the pay), game/mut/army.js replicates the records.

export const ARMY = {
  // who may enlist (the economy's membership + the reputation with that kingdom — content/eco.js RANKS index)
  join: { village: 1, castle: 2, city: 2 }, // village militia: Conhecido (25) · castle / city: Respeitado (100)
  // ranks by service points (a day served, enemies felled, battles won, places taken, sieges repelled)
  ranks: [
    { name: 'Recruta', svc: 0, pay: 20 },
    { name: 'Soldado', svc: 6, pay: 30 },
    { name: 'Sargento', svc: 18, pay: 45 },
    { name: 'Capitão', svc: 40, pay: 65 },
  ],
  warPay: 1.5,          // × the daily wage while the kingdom is at war (campaign pay)
  // service points
  svc: { day: 1, kill: 1, killMax: 4, general: 3, won: 3, taken: 5, repelled: 4 }, // (killMax: kills that count a day)
  // bonuses (coins, reputation with the kingdom) for an outcome the player was part of (near it, or fought in it)
  bonus: { won: [40, 6], taken: [90, 12], repelled: [50, 10] },
  near: 90,             // tiles: a player this near the fight / the place at its end took part in it
  serveRep: 2,          // reputation a day served while the kingdom is at war (1 at peace)
  // leaving while the army is in action (a battle, a siege — its own or of its home): desertion
  desert: { rep: -25, banDays: 2 },
  // the orders: how near counts as "with the army"
  withArmy: 22,         // tiles from the army's middle
  far: 60,              // tiles: farther than this the order is "alcance o exército"
};
export const rankOfSvc = (svc) => { let k = 0; for (let i = 0; i < ARMY.ranks.length; i++) if ((svc | 0) >= ARMY.ranks[i].svc) k = i; return k; };
export const KIND_ARMY_PT = { village: 'a milícia', castle: 'a guarnição', city: 'o exército' };
