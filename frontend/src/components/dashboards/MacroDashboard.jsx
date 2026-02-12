import React from 'react';

// All existing macro panels — imported from their new location
import HashpricePanel from '../panels/macro/HashpricePanel';
import EuUsRatioPanel from '../panels/macro/EuUsRatioPanel';
import BtcReservePanel from '../panels/macro/BtcReservePanel';
import FiberPanel from '../panels/macro/FiberPanel';
import JapanPanel from '../panels/macro/JapanPanel';
import UraniumPanel from '../panels/macro/UraniumPanel';
import BrazilPanel from '../panels/macro/BrazilPanel';
import PmiPanel from '../panels/macro/PmiPanel';
import RareEarthPanel from '../panels/macro/RareEarthPanel';
import IranHashratePanel from '../panels/macro/IranHashratePanel';
import TradeRoutesPanel from '../panels/macro/TradeRoutesPanel';
import DatacenterPanel from '../panels/macro/DatacenterPanel';

/**
 * Macro Intelligence Dashboard
 *
 * All existing panels from the original "Zhan Macro" dashboard,
 * preserved intact and reorganized under this tab.
 */
export default function MacroDashboard() {
  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-terminal-green">Macro Intelligence</h2>
        <p className="text-xs text-terminal-muted">
          Capital rotation tracking: Atoms &gt; Bits thesis monitoring
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 panel-grid">
        <HashpricePanel />
        <EuUsRatioPanel />
        <BtcReservePanel />
        <FiberPanel />
        <JapanPanel />
        <UraniumPanel />
        <BrazilPanel />
        <PmiPanel />
        <RareEarthPanel />
        <IranHashratePanel />
        <TradeRoutesPanel />
        <DatacenterPanel />
      </div>
    </div>
  );
}
