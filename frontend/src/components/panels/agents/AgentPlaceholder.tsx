import React from 'react';
import PlaceholderPanel from '../PlaceholderPanel';

export default function AgentPlaceholder() {
  return (
    <PlaceholderPanel
      title="Agent Status"
      icon="🤖"
      phase={6}
      description="Monitor and control autonomous agents handling curtailment decisions, pool switching, firmware updates, and anomaly response. View agent logs, decision history, and override controls."
      features={[
        'Agent lifecycle management: start, stop, configure, monitor',
        'Decision audit log with full reasoning traces',
        'Real-time agent activity feed and status indicators',
        'Manual override controls for any autonomous decision',
        'Performance scoring: agent decisions vs optimal hindsight',
      ]}
    />
  );
}
