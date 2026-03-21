import { ZONES, MIN_DESK_WIDTH, DESK_UNIT } from './constants';

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function adaptiveCols(zoneWidth, slotCount, padX = 40) {
  const availW = zoneWidth - padX * 2;
  const maxCols = Math.max(1, Math.floor(availW / MIN_DESK_WIDTH));
  return Math.min(maxCols, Math.max(slotCount, 4));
}

export function calculateDeskSlots(zone, agentCount, slotCount) {
  const total = slotCount ?? agentCount;
  if (total === 0) return [];
  const padX = 40;
  const padY = 50;
  const cols = adaptiveCols(zone.width, total, padX);
  const rows = Math.ceil(total / cols);
  const availW = zone.width - padX * 2;
  const availH = zone.height - padY * 2;
  const cellW = Math.min(DESK_UNIT.width, availW / cols);
  const cellH = Math.min(DESK_UNIT.height, availH / Math.max(rows, 1));

  const slots = [];
  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    slots.push({
      unitX: Math.round(zone.x + padX + cellW * (col + 0.5)),
      unitY: Math.round(zone.y + padY + cellH * (row + 0.5)),
    });
  }
  return slots;
}

export function calculateMeetingSeatsSvg(agentCount, tableCenter, seatRadius) {
  if (agentCount === 0) return [];
  return Array.from({ length: agentCount }, (_, i) => {
    const angle = (2 * Math.PI * i) / agentCount - Math.PI / 2;
    return {
      x: Math.round(tableCenter.x + Math.cos(angle) * seatRadius),
      y: Math.round(tableCenter.y + Math.sin(angle) * seatRadius),
    };
  });
}

export function calculateLoungePositions(maxCount) {
  const lz = ZONES.lounge;
  const anchors = [
    { x: lz.x + 60, y: lz.y + 40 },
    { x: lz.x + 160, y: lz.y + 40 },
    { x: lz.x + 260, y: lz.y + 40 },
    { x: lz.x + 360, y: lz.y + 40 },
    { x: lz.x + 60, y: lz.y + 120 },
    { x: lz.x + 160, y: lz.y + 120 },
    { x: lz.x + 260, y: lz.y + 120 },
    { x: lz.x + 360, y: lz.y + 120 },
    { x: lz.x + 440, y: lz.y + 60 },
    { x: lz.x + 440, y: lz.y + 130 },
    { x: lz.x + 100, y: lz.y + 180 },
    { x: lz.x + 280, y: lz.y + 180 },
  ];
  return anchors.slice(0, Math.min(maxCount, anchors.length));
}
