const SHIRT_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#ec4899',
];

const PANTS_COLORS = ['#2d3748', '#374151', '#1e293b', '#3b4a6b', '#4a3728', '#1a1a2e'];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const HAIR_STYLES = ['short', 'spiky', 'side-part', 'curly', 'buzz'];
const SKIN_COLORS = ['#fde2c8', '#f5c5a0', '#d4956b', '#a0714f', '#6b4226', '#ffe0bd'];
const HAIR_COLORS = ['#2c1b0e', '#5a3214', '#c2884a', '#e8c068'];

export function generateSvgAvatar(agentId) {
  const h = hashString(agentId);
  const bits = (offset, count) => (h >>> offset) % count;

  return {
    hairStyle: HAIR_STYLES[bits(3, HAIR_STYLES.length)],
    skinColor: SKIN_COLORS[bits(8, SKIN_COLORS.length)],
    hairColor: HAIR_COLORS[bits(11, HAIR_COLORS.length)],
    shirtColor: SHIRT_PALETTE[h % SHIRT_PALETTE.length],
    pantsColor: PANTS_COLORS[bits(14, PANTS_COLORS.length)],
  };
}
