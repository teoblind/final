import React from 'react';
import PlaceholderPanel from '../PlaceholderPanel';

export default function PoolPlaceholder() {
  return (
    <PlaceholderPanel
      title="Pool Monitor"
      icon="🏊"
      phase={5}
      description="Unified view across all your mining pools. Track hashrate, shares, luck, earnings, and payout schedules. Compare pool performance and detect anomalies like hashrate drops or rejected shares."
      features={[
        'Multi-pool aggregated dashboard (Foundry, Braiins, Ocean, etc.)',
        'Hashrate vs expected hashrate with variance alerts',
        'Luck tracking and statistical analysis',
        'Earnings comparison across pools',
        'Payout schedule tracking and optimization',
      ]}
      configAction="Configure Pool APIs"
    />
  );
}
