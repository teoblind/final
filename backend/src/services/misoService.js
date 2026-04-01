/**
 * MISO (Midcontinent Independent System Operator) Data Service - STUB
 *
 * MISO covers central US from Louisiana to Manitoba.
 * API: https://www.misoenergy.org/markets-and-operations/
 *
 * TODO (Phase 2+): Implement when MISO connector is needed
 */

export async function fetchMisoData(node) {
  throw new Error('MISO connector not yet implemented. Coming in a future phase.');
}

export async function fetchMisoDayAhead(node, date) {
  throw new Error('MISO connector not yet implemented.');
}

export async function fetchMisoSystemLoad() {
  throw new Error('MISO connector not yet implemented.');
}

export async function fetchMisoFuelMix() {
  throw new Error('MISO connector not yet implemented.');
}

export const MISO_NODES = [
  'INDIANA.HUB', 'MICHIGAN.HUB', 'MINNESOTA.HUB', 'ARKANSAS.HUB',
  'LOUISIANA.HUB', 'TEXAS.HUB', 'MISSISSIPPI.HUB'
];
