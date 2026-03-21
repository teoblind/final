export const SVG_WIDTH = 1200;
export const SVG_HEIGHT = 700;

export const OFFICE = {
  x: 30,
  y: 20,
  width: SVG_WIDTH - 60,
  height: SVG_HEIGHT - 40,
  wallThickness: 6,
  cornerRadius: 18,
  corridorWidth: 28,
};

const halfW = (OFFICE.width - OFFICE.corridorWidth) / 2;
const halfH = (OFFICE.height - OFFICE.corridorWidth) / 2;
const rightX = OFFICE.x + halfW + OFFICE.corridorWidth;
const bottomY = OFFICE.y + halfH + OFFICE.corridorWidth;

export const ZONES = {
  desk: { x: OFFICE.x, y: OFFICE.y, width: halfW, height: halfH, label: 'Workstations' },
  meeting: { x: rightX, y: OFFICE.y, width: halfW, height: halfH, label: 'Meeting Room' },
  hotDesk: { x: OFFICE.x, y: bottomY, width: halfW, height: halfH, label: 'Hot Desks' },
  lounge: { x: rightX, y: bottomY, width: halfW, height: halfH, label: 'Lounge' },
};

export const ZONE_COLORS = {
  desk: '#f4f6f9',
  meeting: '#eef3fa',
  hotDesk: '#f1f3f7',
  lounge: '#f3f1f7',
  corridor: '#e8ecf1',
  wall: '#8b9bb0',
};

export const STATUS_COLORS = {
  idle: '#22c55e',
  thinking: '#3b82f6',
  tool_calling: '#f97316',
  speaking: '#a855f7',
  spawning: '#06b6d4',
  error: '#ef4444',
  offline: '#6b7280',
  processing: '#3b82f6',
  running: '#22c55e',
  transcribing: '#a855f7',
  observing: '#f59e0b',
  analyzing: '#8b5cf6',
  walking: '#3b82f6',
};

export const ZONE_LABELS = {
  desk: 'Workstations',
  meeting: 'Meeting Room',
  hotDesk: 'Hot Desks',
  lounge: 'Lounge',
};

export const AVATAR = {
  radius: 20,
  selectedRadius: 24,
  strokeWidth: 3,
  nameLabelMaxChars: 12,
};

export const MIN_DESK_WIDTH = 100;

export const DESK_UNIT = {
  width: 140,
  height: 110,
};
