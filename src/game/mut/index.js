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
import './own.js';
