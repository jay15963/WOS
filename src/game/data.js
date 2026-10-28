// Static gameplay definitions (pure data, no DOM). Shared by simulation and UI.
// Content lives in src/game/content/* (one file per area); this module re-exports everything.

export * from './content/items.js';
export * from './content/combat.js';
export * from './content/buildings.js';

export const WEATHER_PT = {
  clear: ['Céu limpo', '☀'], cloudy: ['Nublado', '☁'], rain: ['Chuva', '🌧'], storm: ['Tempestade', '⛈'], fog: ['Neblina', '🌫'],
};

// Reaction colors (nameplates, target frame, minimap)
export const TEMPER_COLOR = { hostile: '#ff5a48', neutral: '#ffd84a', passive: '#7fdc6a' };
