import React, { useMemo } from 'react';
import {
  SVG_WIDTH, SVG_HEIGHT, OFFICE, ZONES, ZONE_COLORS,
} from './constants';
import { calculateDeskSlots, calculateMeetingSeatsSvg, calculateLoungePositions } from './position-allocator';
import { AgentAvatar } from './AgentAvatar';
import { DeskUnit } from './DeskUnit';
import { MeetingTable, Sofa, Plant, CoffeeCup, Chair } from './furniture';
import { ZoneLabel } from './ZoneLabel';

export function FloorPlan({ agents, selectedAgentId, onSelectAgent, tenantName }) {
  const agentList = agents || [];

  // Assign agents to zones based on role
  const deskAgents = useMemo(
    () => agentList.filter((a) => a.zone === 'desk'),
    [agentList],
  );
  const hotDeskAgents = useMemo(
    () => agentList.filter((a) => a.zone === 'hotDesk'),
    [agentList],
  );
  const meetingAgents = useMemo(
    () => agentList.filter((a) => a.zone === 'meeting'),
    [agentList],
  );
  const loungeAgents = useMemo(
    () => agentList.filter((a) => a.zone === 'lounge'),
    [agentList],
  );

  const deskSlots = useMemo(
    () => calculateDeskSlots(ZONES.desk, deskAgents.length, Math.max(deskAgents.length, 4)),
    [deskAgents.length],
  );

  const hotDeskSlots = useMemo(
    () => calculateDeskSlots(ZONES.hotDesk, hotDeskAgents.length, Math.max(hotDeskAgents.length, 4)),
    [hotDeskAgents.length],
  );

  const meetingCenter = {
    x: ZONES.meeting.x + ZONES.meeting.width / 2,
    y: ZONES.meeting.y + ZONES.meeting.height / 2,
  };

  const meetingTableRadius = Math.min(
    60 + meetingAgents.length * 8,
    Math.min(ZONES.meeting.width, ZONES.meeting.height) / 2 - 40,
  );

  const meetingSeats = useMemo(
    () => calculateMeetingSeatsSvg(meetingAgents.length, meetingCenter, meetingTableRadius + 36),
    [meetingAgents.length, meetingTableRadius],
  );

  // Hash-based desk assignment
  const deskAgentBySlot = useMemo(() => {
    const map = new Map();
    for (const agent of deskAgents) {
      let hash = 0;
      for (let i = 0; i < agent.id.length; i++) {
        hash = ((hash << 5) - hash + agent.id.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(hash) % deskSlots.length;
      let slot = idx;
      while (map.has(slot)) {
        slot = (slot + 1) % deskSlots.length;
      }
      map.set(slot, agent);
    }
    return map;
  }, [deskAgents, deskSlots.length]);

  const hotDeskAgentBySlot = useMemo(() => {
    const map = new Map();
    for (const agent of hotDeskAgents) {
      let hash = 0;
      for (let i = 0; i < agent.id.length; i++) {
        hash = ((hash << 5) - hash + agent.id.charCodeAt(i)) | 0;
      }
      const idx = Math.abs(hash) % hotDeskSlots.length;
      let slot = idx;
      while (map.has(slot)) {
        slot = (slot + 1) % hotDeskSlots.length;
      }
      map.set(slot, agent);
    }
    return map;
  }, [hotDeskAgents, hotDeskSlots.length]);

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: '#f0f2f5' }}>
      <svg
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="w-full h-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="building-shadow" x="-3%" y="-3%" width="106%" height="106%">
            <feDropShadow dx="0" dy="3" stdDeviation="6" floodOpacity={0.12} />
          </filter>
          <pattern id="corridor-tiles" width="28" height="28" patternUnits="userSpaceOnUse">
            <rect width="28" height="28" fill={ZONE_COLORS.corridor} />
            <rect x="0.5" y="0.5" width="27" height="27" fill="none" stroke="#d5dbe3" strokeWidth="0.3" rx="1" />
          </pattern>
          <pattern id="lounge-carpet" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill={ZONE_COLORS.lounge} />
            <circle cx="3" cy="3" r="0.5" fill="#e5e0ed" opacity="0.4" />
          </pattern>
        </defs>

        {/* Building shell */}
        <rect
          x={OFFICE.x} y={OFFICE.y} width={OFFICE.width} height={OFFICE.height}
          rx={OFFICE.cornerRadius} fill={ZONE_COLORS.corridor} stroke={ZONE_COLORS.wall}
          strokeWidth={OFFICE.wallThickness} filter="url(#building-shadow)"
        />

        {/* Corridor floor tiles */}
        <CorridorFloor />

        {/* Zone floor fills */}
        {Object.entries(ZONES).map(([key, zone]) => (
          <rect key={`floor-${key}`} x={zone.x} y={zone.y} width={zone.width} height={zone.height}
            fill={key === 'lounge' ? 'url(#lounge-carpet)' : ZONE_COLORS[key]} />
        ))}

        {/* Partition walls */}
        <PartitionWalls />

        {/* Door openings */}
        <DoorOpenings />

        {/* Zone labels */}
        {Object.entries(ZONES).map(([key, zone]) => (
          <ZoneLabel key={`label-${key}`} zone={zone} />
        ))}

        {/* Desk zone furniture */}
        {deskSlots.map((slot, i) => (
          <DeskUnit
            key={`desk-${i}`}
            x={slot.unitX}
            y={slot.unitY}
            agent={deskAgentBySlot.get(i) || null}
            selected={deskAgentBySlot.get(i)?.id === selectedAgentId}
            onSelect={onSelectAgent}
          />
        ))}

        {/* Meeting zone */}
        <MeetingTable x={meetingCenter.x} y={meetingCenter.y} radius={meetingTableRadius} />
        <MeetingChairs seats={meetingSeats} meetingAgentCount={meetingAgents.length} />

        {/* Meeting agents seated */}
        {meetingAgents.map((agent, i) => {
          const seat = meetingSeats[i];
          if (!seat) return null;
          return (
            <AgentAvatar
              key={agent.id}
              agent={{ ...agent, position: seat }}
              selected={agent.id === selectedAgentId}
              onSelect={onSelectAgent}
            />
          );
        })}

        {/* Hot desk zone */}
        {hotDeskSlots.map((slot, i) => (
          <DeskUnit
            key={`hotdesk-${i}`}
            x={slot.unitX}
            y={slot.unitY}
            agent={hotDeskAgentBySlot.get(i) || null}
            selected={hotDeskAgentBySlot.get(i)?.id === selectedAgentId}
            onSelect={onSelectAgent}
          />
        ))}

        {/* Lounge decor */}
        <LoungeDecor tenantName={tenantName} />

        {/* Lounge agents - idle/offline agents hang out here */}
        {(() => {
          const positions = calculateLoungePositions(Math.max(loungeAgents.length, 4));
          return loungeAgents.map((agent, i) => {
            const pos = positions[i] || { x: ZONES.lounge.x + 60 + i * 80, y: ZONES.lounge.y + 60 };
            return (
              <AgentAvatar
                key={`lounge-${agent.id}`}
                agent={{ ...agent, position: pos }}
                selected={agent.id === selectedAgentId}
                onSelect={onSelectAgent}
              />
            );
          });
        })()}

        {/* Main entrance */}
        <EntranceDoor />
      </svg>
    </div>
  );
}

/* ═══ Sub-components ═══ */

function CorridorFloor() {
  const cw = OFFICE.corridorWidth;
  const hCorrX = OFFICE.x;
  const hCorrY = OFFICE.y + (OFFICE.height - cw) / 2;
  const vCorrX = OFFICE.x + (OFFICE.width - cw) / 2;
  const vCorrY = OFFICE.y;

  return (
    <g>
      <rect x={hCorrX} y={hCorrY} width={OFFICE.width} height={cw} fill="url(#corridor-tiles)" />
      <rect x={vCorrX} y={vCorrY} width={cw} height={OFFICE.height} fill="url(#corridor-tiles)" />
      <line x1={hCorrX} y1={hCorrY + cw / 2} x2={hCorrX + OFFICE.width} y2={hCorrY + cw / 2}
        stroke="#c8d0dc" strokeWidth={0.5} strokeDasharray="8 6" opacity={0.6} />
      <line x1={vCorrX + cw / 2} y1={vCorrY} x2={vCorrX + cw / 2} y2={vCorrY + OFFICE.height}
        stroke="#c8d0dc" strokeWidth={0.5} strokeDasharray="8 6" opacity={0.6} />
    </g>
  );
}

function PartitionWalls() {
  const wallW = 4;
  const cw = OFFICE.corridorWidth;
  const midX = OFFICE.x + (OFFICE.width - cw) / 2;
  const midY = OFFICE.y + (OFFICE.height - cw) / 2;

  const walls = [
    { x: midX - wallW / 2, y: OFFICE.y, w: wallW, h: midY - OFFICE.y },
    { x: midX - wallW / 2, y: midY + cw, w: wallW, h: OFFICE.y + OFFICE.height - midY - cw },
    { x: midX + cw - wallW / 2, y: OFFICE.y, w: wallW, h: midY - OFFICE.y },
    { x: midX + cw - wallW / 2, y: midY + cw, w: wallW, h: OFFICE.y + OFFICE.height - midY - cw },
    { x: OFFICE.x, y: midY - wallW / 2, w: midX - OFFICE.x, h: wallW },
    { x: midX + cw, y: midY - wallW / 2, w: OFFICE.x + OFFICE.width - midX - cw, h: wallW },
    { x: OFFICE.x, y: midY + cw - wallW / 2, w: midX - OFFICE.x, h: wallW },
    { x: midX + cw, y: midY + cw - wallW / 2, w: OFFICE.x + OFFICE.width - midX - cw, h: wallW },
  ];

  return (
    <g>
      {walls.map((w, i) => (
        <rect key={`wall-${i}`} x={w.x} y={w.y} width={w.w} height={w.h}
          fill="#c8d0dc" stroke="#8b9bb0" strokeWidth={0.5} />
      ))}
    </g>
  );
}

function DoorOpenings() {
  const cw = OFFICE.corridorWidth;
  const midX = OFFICE.x + (OFFICE.width - cw) / 2;
  const midY = OFFICE.y + (OFFICE.height - cw) / 2;
  const doorWidth = 40;
  const doorColor = ZONE_COLORS.corridor;

  const doors = [
    { cx: (OFFICE.x + midX) / 2, cy: midY, horizontal: true },
    { cx: (midX + cw + OFFICE.x + OFFICE.width) / 2, cy: midY, horizontal: true },
    { cx: (OFFICE.x + midX) / 2, cy: midY + cw, horizontal: true },
    { cx: (midX + cw + OFFICE.x + OFFICE.width) / 2, cy: midY + cw, horizontal: true },
    { cx: midX, cy: (OFFICE.y + midY) / 2, horizontal: false },
    { cx: midX + cw, cy: (OFFICE.y + midY) / 2, horizontal: false },
    { cx: midX, cy: (midY + cw + OFFICE.y + OFFICE.height) / 2, horizontal: false },
    { cx: midX + cw, cy: (midY + cw + OFFICE.y + OFFICE.height) / 2, horizontal: false },
  ];

  return (
    <g>
      {doors.map((d, i) => {
        const half = doorWidth / 2;
        if (d.horizontal) {
          return (
            <g key={`door-${i}`}>
              <rect x={d.cx - half} y={d.cy - 3} width={doorWidth} height={6} fill={doorColor} />
              <path d={`M ${d.cx - half} ${d.cy} A ${half} ${half} 0 0 1 ${d.cx + half} ${d.cy}`}
                fill="none" stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
            </g>
          );
        }
        return (
          <g key={`door-${i}`}>
            <rect x={d.cx - 3} y={d.cy - half} width={6} height={doorWidth} fill={doorColor} />
            <path d={`M ${d.cx} ${d.cy - half} A ${half} ${half} 0 0 1 ${d.cx} ${d.cy + half}`}
              fill="none" stroke="#94a3b8" strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
          </g>
        );
      })}
    </g>
  );
}

function MeetingChairs({ seats, meetingAgentCount }) {
  const meetingCenter = {
    x: ZONES.meeting.x + ZONES.meeting.width / 2,
    y: ZONES.meeting.y + ZONES.meeting.height / 2,
  };

  if (meetingAgentCount > 0) {
    return (
      <g>
        {seats.map((s, i) => (
          <Chair key={`mc-${i}`} x={s.x} y={s.y} />
        ))}
      </g>
    );
  }

  // Empty meeting room - show default chairs
  const emptyCount = 6;
  const emptyRadius = 100;
  return (
    <g>
      {Array.from({ length: emptyCount }, (_, i) => {
        const angle = (2 * Math.PI * i) / emptyCount - Math.PI / 2;
        return (
          <Chair
            key={`mc-empty-${i}`}
            x={Math.round(meetingCenter.x + Math.cos(angle) * emptyRadius)}
            y={Math.round(meetingCenter.y + Math.sin(angle) * emptyRadius)}
          />
        );
      })}
    </g>
  );
}

function LoungeDecor({ tenantName }) {
  const lz = ZONES.lounge;
  const cx = lz.x + lz.width / 2;

  const bgWallW = 200;
  const bgWallH = 36;
  const bgWallY = lz.y + lz.height * 0.52;

  const deskW = 160;
  const deskH = 24;
  const deskY = bgWallY + bgWallH + 14;

  return (
    <g>
      {/* Sofas & coffee */}
      <Sofa x={lz.x + 100} y={lz.y + 60} rotation={0} />
      <Sofa x={lz.x + 280} y={lz.y + 60} rotation={0} />
      <Sofa x={lz.x + 100} y={lz.y + 140} rotation={180} />
      <CoffeeCup x={lz.x + 190} y={lz.y + 100} />
      <CoffeeCup x={lz.x + 100} y={lz.y + 100} />
      <Sofa x={lz.x + 440} y={lz.y + 100} rotation={90} />

      {/* Logo backdrop wall */}
      <rect x={cx - bgWallW / 2} y={bgWallY} width={bgWallW} height={bgWallH} rx={4} fill="#3b4f6b" />
      <rect x={cx - bgWallW / 2} y={bgWallY} width={bgWallW} height={3} rx={1.5} fill="#7a9bc0" />
      <text x={cx} y={bgWallY + bgWallH / 2 + 5} textAnchor="middle" fill="#ffffff"
        fontSize={14} fontWeight={700} fontFamily="system-ui, sans-serif" letterSpacing="0.12em">
        {tenantName || 'Coppice'}
      </text>

      {/* Reception desk */}
      <rect x={cx - deskW / 2} y={deskY} width={deskW} height={deskH} rx={12}
        fill="#8494a7" stroke="#5a6878" strokeWidth={1} />
      <rect x={cx - deskW / 2 + 4} y={deskY + 3} width={deskW - 8} height={deskH - 6}
        rx={9} fill="#a5b4c8" opacity={0.5} />

      {/* Plants */}
      <Plant x={cx - bgWallW / 2 - 30} y={bgWallY + bgWallH / 2} />
      <Plant x={cx + bgWallW / 2 + 30} y={bgWallY + bgWallH / 2} />
      <Plant x={lz.x + 40} y={lz.y + lz.height - 50} />
      <Plant x={lz.x + lz.width - 40} y={lz.y + lz.height - 50} />
    </g>
  );
}

function EntranceDoor() {
  const lz = ZONES.lounge;
  const doorCX = lz.x + lz.width / 2;
  const doorY = OFFICE.y + OFFICE.height;
  const doorW = 70;
  const half = doorW / 2;

  return (
    <g>
      <rect x={doorCX - half - 2} y={doorY - OFFICE.wallThickness - 1}
        width={doorW + 4} height={OFFICE.wallThickness + 4} fill={ZONE_COLORS.lounge} />
      <rect x={doorCX - half - 3} y={doorY - 10} width={3} height={12} rx={1} fill="#8b9bb0" />
      <rect x={doorCX + half} y={doorY - 10} width={3} height={12} rx={1} fill="#8b9bb0" />
      <path d={`M ${doorCX - half} ${doorY} A ${half} ${half} 0 0 0 ${doorCX} ${doorY - half}`}
        fill="none" stroke="#8b9bb0" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.5} />
      <path d={`M ${doorCX + half} ${doorY} A ${half} ${half} 0 0 1 ${doorCX} ${doorY - half}`}
        fill="none" stroke="#8b9bb0" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.5} />
      <rect x={doorCX - 30} y={doorY - 18} width={60} height={12} rx={3} fill="#b0a090" opacity={0.5} />
      <text x={doorCX} y={doorY + 14} textAnchor="middle" fill="#94a3b8"
        fontSize={9} fontWeight={600} fontFamily="system-ui, sans-serif" letterSpacing="0.15em">
        ENTRANCE
      </text>
    </g>
  );
}
