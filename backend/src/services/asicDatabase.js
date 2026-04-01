/**
 * ASIC Database - Built-in specifications for common mining hardware.
 * Miners can also add custom models not in this database.
 */

export const ASIC_DATABASE = [
  // Bitmain Antminer - Current Generation
  { id: 's21-pro', manufacturer: 'Bitmain', model: 'Antminer S21 Pro', hashrate: 234, powerConsumption: 3510, efficiency: 15.0, releaseYear: 2024, generation: 'current' },
  { id: 's21-xp', manufacturer: 'Bitmain', model: 'Antminer S21 XP', hashrate: 270, powerConsumption: 3645, efficiency: 13.5, releaseYear: 2024, generation: 'current' },
  { id: 's21-hydro', manufacturer: 'Bitmain', model: 'Antminer S21 Hydro', hashrate: 335, powerConsumption: 5360, efficiency: 16.0, releaseYear: 2024, generation: 'current' },
  { id: 's21', manufacturer: 'Bitmain', model: 'Antminer S21', hashrate: 200, powerConsumption: 3500, efficiency: 17.5, releaseYear: 2024, generation: 'current' },
  { id: 't21', manufacturer: 'Bitmain', model: 'Antminer T21', hashrate: 190, powerConsumption: 3610, efficiency: 19.0, releaseYear: 2024, generation: 'current' },

  // Bitmain Antminer - Mid Generation
  { id: 's19-xp', manufacturer: 'Bitmain', model: 'Antminer S19 XP', hashrate: 140, powerConsumption: 3010, efficiency: 21.5, releaseYear: 2022, generation: 'mid' },
  { id: 's19k-pro', manufacturer: 'Bitmain', model: 'Antminer S19k Pro', hashrate: 120, powerConsumption: 2760, efficiency: 23.0, releaseYear: 2023, generation: 'mid' },
  { id: 's19-pro', manufacturer: 'Bitmain', model: 'Antminer S19 Pro', hashrate: 110, powerConsumption: 3250, efficiency: 29.5, releaseYear: 2020, generation: 'mid' },
  { id: 's19', manufacturer: 'Bitmain', model: 'Antminer S19', hashrate: 95, powerConsumption: 3250, efficiency: 34.2, releaseYear: 2020, generation: 'mid' },

  // Bitmain Antminer - Legacy
  { id: 's17', manufacturer: 'Bitmain', model: 'Antminer S17', hashrate: 56, powerConsumption: 2520, efficiency: 45.0, releaseYear: 2019, generation: 'legacy' },
  { id: 's9', manufacturer: 'Bitmain', model: 'Antminer S9', hashrate: 14, powerConsumption: 1350, efficiency: 96.4, releaseYear: 2016, generation: 'legacy' },

  // MicroBT WhatsMiner - Current Generation
  { id: 'm63s', manufacturer: 'MicroBT', model: 'WhatsMiner M63S', hashrate: 390, powerConsumption: 7215, efficiency: 18.5, releaseYear: 2024, generation: 'current' },
  { id: 'm60s', manufacturer: 'MicroBT', model: 'WhatsMiner M60S', hashrate: 186, powerConsumption: 3348, efficiency: 18.0, releaseYear: 2024, generation: 'current' },
  { id: 'm56s', manufacturer: 'MicroBT', model: 'WhatsMiner M56S', hashrate: 212, powerConsumption: 5300, efficiency: 25.0, releaseYear: 2023, generation: 'current' },

  // MicroBT WhatsMiner - Mid Generation
  { id: 'm50s', manufacturer: 'MicroBT', model: 'WhatsMiner M50S', hashrate: 126, powerConsumption: 3276, efficiency: 26.0, releaseYear: 2023, generation: 'mid' },
  { id: 'm30s++', manufacturer: 'MicroBT', model: 'WhatsMiner M30S++', hashrate: 112, powerConsumption: 3472, efficiency: 31.0, releaseYear: 2021, generation: 'mid' },

  // Canaan Avalon - Current Generation
  { id: 'a1466', manufacturer: 'Canaan', model: 'Avalon A1466', hashrate: 150, powerConsumption: 3230, efficiency: 21.5, releaseYear: 2024, generation: 'current' },
];

/**
 * Look up an ASIC model by ID
 */
export function getAsicModel(id) {
  return ASIC_DATABASE.find(m => m.id === id);
}

/**
 * Get all models grouped by manufacturer
 */
export function getAsicsByManufacturer() {
  const grouped = {};
  for (const model of ASIC_DATABASE) {
    if (!grouped[model.manufacturer]) grouped[model.manufacturer] = [];
    grouped[model.manufacturer].push(model);
  }
  return grouped;
}

/**
 * Get all models grouped by generation
 */
export function getAsicsByGeneration() {
  const grouped = { current: [], mid: [], legacy: [] };
  for (const model of ASIC_DATABASE) {
    grouped[model.generation].push(model);
  }
  return grouped;
}

export default ASIC_DATABASE;
