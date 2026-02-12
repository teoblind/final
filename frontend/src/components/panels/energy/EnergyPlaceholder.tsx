import React from 'react';
import PlaceholderPanel from '../PlaceholderPanel';

export default function EnergyPlaceholder() {
  return (
    <PlaceholderPanel
      title="Energy Market"
      icon="⚡"
      phase={2}
      description="Real-time ERCOT/PJM/CAISO pricing, day-ahead curves, LMP heatmaps, and price forecasting. Connect your energy market feed to see live nodal prices and identify curtailment opportunities."
      features={[
        'Real-time nodal/zonal pricing from ERCOT, PJM, CAISO, MISO',
        'Day-ahead vs real-time price spread visualization',
        'LMP heatmaps with your node highlighted',
        'Price spike alerts and negative pricing detection',
        'Historical price analytics with seasonal patterns',
      ]}
      configAction="Configure Energy Source"
    />
  );
}
