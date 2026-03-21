import React, { memo } from 'react';
import { AgentAvatar } from './AgentAvatar';
import { Desk, Chair } from './furniture';

export const DeskUnit = memo(
  function DeskUnit({ x, y, agent, selected, onSelect }) {
    return (
      <g transform={`translate(${x}, ${y})`}>
        <Desk x={0} y={30} />
        <Chair x={0} y={-12} />
        {agent && (
          <AgentAvatar
            agent={{ ...agent, position: { x: 0, y: -12 } }}
            selected={selected}
            onSelect={onSelect}
          />
        )}
      </g>
    );
  },
  (prev, next) => {
    if (prev.x !== next.x || prev.y !== next.y) return false;
    if (prev.selected !== next.selected) return false;
    if (prev.agent === null && next.agent === null) return true;
    if (prev.agent === null || next.agent === null) return false;
    return (
      prev.agent.id === next.agent.id &&
      prev.agent.status === next.agent.status &&
      prev.agent.name === next.agent.name
    );
  },
);
