/**
 * PJM Interconnection Data Service - STUB
 *
 * PJM serves Mid-Atlantic and Great Lakes regions.
 * API: https://dataminer2.pjm.com/feed (requires registration)
 *
 * TODO (Phase 2+): Implement when PJM connector is needed
 */

export async function fetchPjmData(node) {
  throw new Error('PJM connector not yet implemented. Coming in a future phase.');
}

export async function fetchPjmDayAhead(node, date) {
  throw new Error('PJM connector not yet implemented.');
}

export async function fetchPjmSystemLoad() {
  throw new Error('PJM connector not yet implemented.');
}

export async function fetchPjmFuelMix() {
  throw new Error('PJM connector not yet implemented.');
}

export const PJM_NODES = [
  'WESTERN HUB', 'EASTERN HUB', 'AEP DAYTON HUB', 'CHICAGO HUB',
  'DOMINION HUB', 'AD HUB', 'NI HUB'
];
