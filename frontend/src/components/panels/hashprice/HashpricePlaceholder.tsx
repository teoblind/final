import React from 'react';
import PlaceholderPanel from '../PlaceholderPanel';

export default function HashpricePlaceholder() {
  return (
    <PlaceholderPanel
      title="Fleet Hashprice"
      icon="⛏"
      phase={3}
      description="Your fleet's actual hashprice based on ASIC models, efficiency curves, and real energy costs. Includes breakeven analysis, profitability heatmaps by power price, and what-if modeling for hardware upgrades."
      features={[
        'Per-machine profitability based on your actual fleet composition',
        'Breakeven analysis with your energy contract rates',
        'Profitability heatmap: hashprice vs electricity cost matrix',
        'What-if modeling for new hardware purchases',
        'Efficiency degradation tracking over time',
      ]}
      configAction="Configure Fleet"
    />
  );
}
