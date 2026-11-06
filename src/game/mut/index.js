// Every shared-state domain registers its ops / intents / owner messages at import time. Imported once by
// systems.js so the registries are complete before any peer applies an op.
import './loot.js';
import './objects.js';
import './structures.js';
import './roofs.js';
import './tiles.js';
import './crops.js';
import './camps.js';
import './combat.js';
import './bow.js';
import './env.js';
import './paths.js'; // painted terrain paths (agent M)
import './own.js';
import './kit.js';
import './corpses.js';
import './levels.js';
import './decks.js'; // piers / bridges falling into the water
import './stock.js'; // livestock: ties (docs/LIVESTOCK.md)
import './fish.js'; // fishing with a rod
import './giants.js';   // ice giants: smash telegraph, thrown ice rock
import './ballista.js'; // the ballista: operator, aim, shots
import './terrain.js';  // terrain height: dig / fill / level / smooth (docs/TERRAIN-HEIGHT.md)
import './tunnels.js';  // tunnels dug into the relief (docs/TERRAIN-HEIGHT.md)
import './boats.js';    // boats: launch, riders, rowing
import './horses.js';   // horses: taming with wheat, saddle, riding (docs/HORSE.md)
import './siege.js';    // siege engines: operator, aim, shots, pushing, the ram, the tower's ramp (docs/REINOS.md)
import './towns.js';    // settlements: their shared state, the gates (docs/REINOS.md)
import './people.js';   // settlements' people: deaths / replacements, the world's progress, the bell (game/people.js)
import './eco.js';      // the economy of the kingdoms: markets, reputation, jobs, properties, tax (docs/REINOS.md)
import './realms.js';   // the kingdoms' diplomacy, owners, armies, sieges by numbers (docs/REINOS.md §13)
import './warfare.js';  // the armies near the players: forces, the structures of an army, shouts, reputation for helping a side (docs/REINOS.md §14)
import './army.js';     // the player in the army: enlisting, the pay, service, bonuses, desertion (docs/REINOS.md §15)
import './raids.js';    // the winter attacks on the settlements: the waves, the end, a player mending his property (docs/REINOS.md §16)
import './skirmish.js'; // a skirmish arena: the lobby, the match, the results (docs/SKIRMISH.md)
