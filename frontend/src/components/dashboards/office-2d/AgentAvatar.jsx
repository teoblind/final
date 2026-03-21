import React, { useState, memo } from 'react';
import { generateSvgAvatar } from './avatar-generator';
import { STATUS_COLORS, AVATAR } from './constants';

export const AgentAvatar = memo(function AgentAvatar({ agent, selected, onSelect }) {
  const [hovered, setHovered] = useState(false);

  const r = selected ? AVATAR.selectedRadius : AVATAR.radius;
  const color = STATUS_COLORS[agent.status] || STATUS_COLORS.idle;
  const avatarData = generateSvgAvatar(agent.id);
  const clipId = `avatar-clip-${agent.id}`;

  const displayName =
    agent.name.length > AVATAR.nameLabelMaxChars
      ? `${agent.name.slice(0, AVATAR.nameLabelMaxChars)}...`
      : agent.name;

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

  return (
    <g
      transform={`translate(${agent.position.x}, ${agent.position.y})`}
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect && onSelect(agent.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Selected glow */}
      {selected && (
        <circle r={r + 8} fill={color} opacity={0.18} style={{ filter: `drop-shadow(0 0 10px ${color})` }} />
      )}

      {/* Status ring */}
      <StatusRing status={agent.status} r={r} color={color} />

      {/* Avatar face */}
      <defs>
        <clipPath id={clipId}>
          <circle r={r - 2} />
        </clipPath>
      </defs>
      <circle r={r - 2} fill="#f8fafc" />
      <g clipPath={`url(#${clipId})`}>
        <AvatarFace data={avatarData} size={r * 2 - 4} />
      </g>

      {/* Thinking indicator */}
      {(agent.status === 'thinking' || agent.status === 'processing' || agent.status === 'analyzing') && (
        <ThinkingDots r={r} />
      )}

      {/* Error badge */}
      {agent.status === 'error' && (
        <g transform={`translate(${r * 0.65}, ${-r * 0.65})`}>
          <circle r={7} fill="#ef4444" />
          <text textAnchor="middle" dy="4" fontSize="10" fill="#fff" fontWeight="bold">!</text>
        </g>
      )}

      {/* Speaking indicator */}
      {(agent.status === 'speaking' || agent.status === 'transcribing') && (
        <SpeakingIndicator r={r} />
      )}

      {/* Tool name label */}
      {agent.status === 'tool_calling' && agent.currentTool && (
        <foreignObject x={-50} y={r + 2} width={100} height={20} style={{ pointerEvents: 'none' }}>
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
        y={r + (agent.status === 'tool_calling' && agent.currentTool ? 18 : 4)}
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
        <foreignObject x={-80} y={-r - 38} width={160} height={32} style={{ pointerEvents: 'none' }}>
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

function StatusRing({ status, r, color }) {
  const animStyle = getStatusRingAnimation(status);
  return (
    <circle
      r={r}
      fill="none"
      stroke={color}
      strokeWidth={AVATAR.strokeWidth}
      style={{ transition: 'stroke 300ms ease', ...animStyle }}
    />
  );
}

function getStatusRingAnimation(status) {
  switch (status) {
    case 'thinking':
    case 'processing':
    case 'analyzing':
      return { animation: 'agent-pulse 1.5s ease-in-out infinite' };
    case 'tool_calling':
    case 'running':
      return { animation: 'agent-pulse 2s ease-in-out infinite', strokeDasharray: '6 3' };
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

function ThinkingDots({ r }) {
  return (
    <g transform={`translate(${r * 0.55}, ${-r * 0.7})`}>
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={i * 5} cy={0} r={2} fill="#3b82f6"
          style={{ animation: `thinking-dots 1.2s ease-in-out ${i * 0.15}s infinite` }} />
      ))}
    </g>
  );
}

function SpeakingIndicator({ r }) {
  return (
    <g transform={`translate(${r * 0.55}, ${-r * 0.75})`}>
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
  );
}

function AvatarFace({ data, size }) {
  const s = size / 2;
  const faceRx = data.faceShape === 'round' ? s * 0.8 : data.faceShape === 'oval' ? s * 0.7 : s * 0.75;
  const faceRy = data.faceShape === 'oval' ? s * 0.9 : faceRx;

  return (
    <g>
      <rect x={-s} y={s * 0.4} width={size} height={s * 1.2} fill={data.shirtColor} />
      <ellipse cx={0} cy={-s * 0.05} rx={faceRx} ry={faceRy} fill={data.skinColor} />
      <HairSvg style={data.hairStyle} color={data.hairColor} s={s} faceRx={faceRx} />
      <EyesSvg style={data.eyeStyle} s={s} />
    </g>
  );
}

function HairSvg({ style, color, s, faceRx }) {
  switch (style) {
    case 'short':
      return <ellipse cx={0} cy={-s * 0.55} rx={faceRx * 0.95} ry={s * 0.45} fill={color} />;
    case 'spiky':
      return (
        <g>
          <ellipse cx={0} cy={-s * 0.55} rx={faceRx * 0.9} ry={s * 0.4} fill={color} />
          {[-0.4, -0.15, 0.1, 0.35].map((off) => (
            <polygon key={off}
              points={`${off * s * 2},-${s * 0.85} ${off * s * 2 - 3},-${s * 0.5} ${off * s * 2 + 3},-${s * 0.5}`}
              fill={color} />
          ))}
        </g>
      );
    case 'side-part':
      return (
        <g>
          <ellipse cx={-s * 0.1} cy={-s * 0.55} rx={faceRx} ry={s * 0.45} fill={color} />
          <rect x={faceRx * 0.3} y={-s * 0.9} width={faceRx * 0.5} height={s * 0.3} rx={3} fill={color} />
        </g>
      );
    case 'curly':
      return (
        <g>
          {[[-0.35, -0.7], [0, -0.78], [0.35, -0.7], [-0.5, -0.45], [0.5, -0.45]].map(([ox, oy], i) => (
            <circle key={i} cx={ox * s} cy={oy * s} r={s * 0.22} fill={color} />
          ))}
        </g>
      );
    case 'buzz':
      return <ellipse cx={0} cy={-s * 0.45} rx={faceRx * 0.85} ry={s * 0.35} fill={color} opacity={0.7} />;
    default:
      return null;
  }
}

function EyesSvg({ style, s }) {
  const ey = -s * 0.08;
  const gap = s * 0.28;
  switch (style) {
    case 'dot':
      return (
        <g>
          <circle cx={-gap} cy={ey} r={2} fill="#333" />
          <circle cx={gap} cy={ey} r={2} fill="#333" />
        </g>
      );
    case 'line':
      return (
        <g>
          <line x1={-gap - 3} y1={ey} x2={-gap + 3} y2={ey} stroke="#333" strokeWidth={1.5} strokeLinecap="round" />
          <line x1={gap - 3} y1={ey} x2={gap + 3} y2={ey} stroke="#333" strokeWidth={1.5} strokeLinecap="round" />
        </g>
      );
    case 'wide':
      return (
        <g>
          <ellipse cx={-gap} cy={ey} rx={3} ry={2.5} fill="#fff" stroke="#333" strokeWidth={0.8} />
          <circle cx={-gap} cy={ey} r={1.2} fill="#333" />
          <ellipse cx={gap} cy={ey} rx={3} ry={2.5} fill="#fff" stroke="#333" strokeWidth={0.8} />
          <circle cx={gap} cy={ey} r={1.2} fill="#333" />
        </g>
      );
    default:
      return null;
  }
}
