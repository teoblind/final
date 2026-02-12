import React from 'react';
import PlaceholderPanel from '../PlaceholderPanel';

export default function CurtailmentPlaceholder() {
  return (
    <PlaceholderPanel
      title="Curtailment Optimizer"
      icon="🔋"
      phase={4}
      description="Autonomous curtailment engine that cross-references energy prices, hashprice, and demand response signals. Shows optimal on/off schedules, revenue from curtailment credits, and historical performance."
      features={[
        'Optimal mine-on/mine-off schedule based on energy + hashprice',
        'Demand response program integration (4CP, ancillary services)',
        'Revenue tracking: mining income vs curtailment credits',
        'Backtest curtailment strategies against historical data',
        'Configurable thresholds and override controls',
      ]}
      configAction="Configure Energy Source"
    />
  );
}
