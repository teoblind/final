import React, { useState, memo, useMemo } from 'react';
import { generateSvgAvatar } from './avatar-generator';
import { STATUS_COLORS } from './constants';

// Pixel art sprite system
// Each cell: 0=transparent, 1=hair, 2=skin, 3=eyes, 4=shirt, 5=pants, 6=shoes
const PX = 3;
const COLS = 10;
const ROWS = 16;
const SPRITE_W = COLS * PX;
const SPRITE_H = ROWS * PX;

// Hair variants (rows 0-3, rest is shared body)
const HAIR = {
  short: [
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,1,2,2,2,2,1,0,0],
  ],
  spiky: [
    [0,1,0,1,1,1,1,0,1,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,1,2,2,2,2,1,0,0],
  ],
  'side-part': [
    [0,1,1,1,1,1,0,0,0,0],
    [0,1,1,1,1,1,1,1,0,0],
    [0,1,1,1,1,1,1,1,0,0],
    [0,1,1,2,2,2,2,1,0,0],
  ],
  curly: [
    [0,1,1,1,1,1,1,1,1,0],
    [1,1,1,1,1,1,1,1,1,1],
    [1,1,1,1,1,1,1,1,1,1],
    [0,1,1,2,2,2,2,1,1,0],
  ],
  buzz: [
    [0,0,0,0,0,0,0,0,0,0],
    [0,0,0,1,1,1,1,0,0,0],
    [0,0,1,1,1,1,1,1,0,0],
    [0,0,1,2,2,2,2,1,0,0],
  ],
};

// Shared body (rows 4-15)
const BODY = [
  [0,0,2,3,2,2,3,2,0,0], // 4  eyes
  [0,0,0,2,2,2,2,0,0,0], // 5  nose
  [0,0,0,2,2,2,2,0,0,0], // 6  chin
  [0,0,0,0,2,2,0,0,0,0], // 7  neck
  [0,0,4,4,4,4,4,4,0,0], // 8  shirt shoulders
  [0,2,4,4,4,4,4,4,2,0], // 9  shirt + arms
  [0,2,4,4,4,4,4,4,2,0], // 10 shirt + arms
  [0,0,0,4,4,4,4,0,0,0], // 11 waist
  [0,0,0,5,5,5,5,0,0,0], // 12 hips
  [0,0,0,5,5,0,5,5,0,0], // 13 legs
  [0,0,0,5,5,0,5,5,0,0], // 14 legs
  [0,0,6,6,6,0,6,6,6,0], // 15 shoes
];

function buildSprite(hairStyle) {
  return [...(HAIR[hairStyle] || HAIR.short), ...BODY];
}

const PixelSprite = memo(function PixelSprite({ sprite, data }) {
  const colorMap = useMemo(() => ({
    1: data.hairColor,
    2: data.skinColor,
    3: '#1a1a1a',
    4: data.shirtColor,
    5: data.pantsColor || '#2d3748',
    6: '#2c2c2c',
  }), [data.hairColor, data.skinColor, data.shirtColor, data.pantsColor]);

  const pixels = useMemo(() => {
    const result = [];
    const ox = -SPRITE_W / 2;
    const oy = -SPRITE_H / 2;
    for (let y = 0; y < sprite.length; y++) {
      const row = sprite[y];
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (cell !== 0) {
          result.push(
            <rect
              key={`${y}_${x}`}
              x={ox + x * PX}
              y={oy + y * PX}
              width={PX + 0.5}
              height={PX + 0.5}
              fill={colorMap[cell]}
            />
          );
        }
      }
    }
    return result;
  }, [sprite, colorMap]);

  return <g style={{ shapeRendering: 'crispEdges' }}>{pixels}</g>;
});

const statusLabels = {
  idle: 'Idle',
  thinking: 'Thinking',
  tool_calling: 'Using Tool',
  speaking: 'Speaking',
  spawning: 'Starting',
  error: 'Error',
  offline: 'Offline',
  processing: 'Processing',
  running: 'Running',
  transcribing: 'Transcribing',
  observing: 'Observing',
  analyzing: 'Analyzing',
};

export const AgentAvatar = memo(function AgentAvatar({ agent, selected, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const color = STATUS_COLORS[agent.status] || STATUS_COLORS.idle;
  const avatarData = generateSvgAvatar(agent.id);
  const sprite = useMemo(() => buildSprite(avatarData.hairStyle), [avatarData.hairStyle]);

  const displayName =
    agent.name.length > 12 ? `${agent.name.slice(0, 12)}...` : agent.name;

  return (
    <g
      transform={`translate(${agent.position.x}, ${agent.position.y})`}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect && onSelect(agent.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Status shadow under feet */}
      <ellipse
        cx={0}
        cy={SPRITE_H / 2 + 2}
        rx={SPRITE_W / 2 + 3}
        ry={5}
        fill={color}
        opacity={0.35}
        style={getShadowAnim(agent.status)}
      />

      {/* Selected glow */}
      {selected && (
        <rect
          x={-SPRITE_W / 2 - 6}
          y={-SPRITE_H / 2 - 6}
          width={SPRITE_W + 12}
          height={SPRITE_H + 12}
          rx={6}
          fill={color}
          opacity={0.15}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      )}

      {/* Pixel character with outline */}
      <g style={{ filter: 'drop-shadow(0 0 0.6px rgba(0,0,0,0.4))' }}>
        <PixelSprite sprite={sprite} data={avatarData} />
      </g>

      {/* Thinking dots */}
      {(agent.status === 'thinking' || agent.status === 'processing' || agent.status === 'analyzing') && (
        <g transform={`translate(6, ${-SPRITE_H / 2 - 8})`}>
          {[0, 1, 2].map((i) => (
            <circle key={i} cx={i * 5} cy={0} r={2} fill="#3b82f6"
              style={{ animation: `thinking-dots 1.2s ease-in-out ${i * 0.15}s infinite` }} />
          ))}
        </g>
      )}

      {/* Error badge */}
      {agent.status === 'error' && (
        <g transform={`translate(${SPRITE_W / 2 - 2}, ${-SPRITE_H / 2 - 2})`}>
          <circle r={7} fill="#ef4444" />
          <text textAnchor="middle" dy="4" fontSize="10" fill="#fff" fontWeight="bold">!</text>
        </g>
      )}

      {/* Speaking indicator */}
      {(agent.status === 'speaking' || agent.status === 'transcribing') && (
        <g transform={`translate(${SPRITE_W / 2 + 2}, ${-SPRITE_H / 2})`}>
          <circle r={7} fill="#a855f7" opacity={0.9}>
            <animate attributeName="r" values="6;8;6" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.9;0.5;0.9" dur="1.5s" repeatCount="indefinite" />
          </circle>
          <g transform="translate(-4.5,-4.5) scale(0.45)">
            <path fill="#fff" fillRule="evenodd"
              d="M3.43 2.524A41.29 41.29 0 0110 2c2.236 0 4.43.18 6.57.524 1.437.231 2.43 1.49 2.43 2.902v5.148c0 1.413-.993 2.67-2.43 2.902a41.102 41.102 0 01-3.55.414c-.28.02-.521.18-.643.413l-1.712 3.293a.75.75 0 01-1.33 0l-1.713-3.293a.783.783 0 00-.642-.413 41.108 41.108 0 01-3.55-.414C1.993 13.245 1 11.986 1 10.574V5.426c0-1.413.993-2.67 2.43-2.902z"
              clipRule="evenodd" />
          </g>
        </g>
      )}

      {/* Tool name label */}
      {agent.status === 'tool_calling' && agent.currentTool && (
        <foreignObject x={-50} y={SPRITE_H / 2 + 4} width={100} height={20} style={{ pointerEvents: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <span style={{
              fontSize: '9px', fontWeight: 600, color: '#fff', backgroundColor: '#f97316',
              borderRadius: '4px', padding: '1px 6px', whiteSpace: 'nowrap',
              maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {agent.currentTool.name}
            </span>
          </div>
        </foreignObject>
      )}

      {/* Name label */}
      <foreignObject
        x={-60}
        y={SPRITE_H / 2 + (agent.status === 'tool_calling' && agent.currentTool ? 20 : 6)}
        width={120}
        height={22}
        style={{ pointerEvents: 'none' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <span
            title={agent.name}
            style={{
              fontSize: '11px', fontWeight: 500, color: '#475569',
              backgroundColor: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(6px)',
              borderRadius: '6px', padding: '1px 8px', whiteSpace: 'nowrap',
              border: '1px solid rgba(0,0,0,0.06)',
            }}
          >
            {displayName}
          </span>
        </div>
      </foreignObject>

      {/* Hover tooltip */}
      {hovered && (
        <foreignObject x={-80} y={-SPRITE_H / 2 - 34} width={160} height={32} style={{ pointerEvents: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <span style={{
              fontSize: '11px', fontWeight: 500, color: '#374151',
              backgroundColor: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(8px)',
              borderRadius: '8px', padding: '4px 10px', whiteSpace: 'nowrap',
              boxShadow: '0 4px 8px rgba(0,0,0,0.1)', border: '1px solid rgba(0,0,0,0.06)',
            }}>
              {agent.name} &middot; {statusLabels[agent.status] || agent.status}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  );
});

function getShadowAnim(status) {
  switch (status) {
    case 'thinking':
    case 'processing':
    case 'analyzing':
      return { animation: 'agent-pulse 1.5s ease-in-out infinite' };
    case 'tool_calling':
    case 'running':
      return { animation: 'agent-pulse 2s ease-in-out infinite' };
    case 'speaking':
    case 'transcribing':
      return { animation: 'agent-pulse 1s ease-in-out infinite' };
    case 'error':
      return { animation: 'agent-blink 0.8s ease-in-out infinite' };
    case 'spawning':
      return { animation: 'agent-spawn 0.5s ease-out forwards' };
    default:
      return {};
  }
}
