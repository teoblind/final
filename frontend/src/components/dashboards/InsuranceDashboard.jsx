import React, { useState, Suspense, lazy } from 'react';
import { Shield, TrendingUp, Sliders, FileCheck } from 'lucide-react';

const RiskProfilePanel = lazy(() => import('../panels/insurance/RiskProfilePanel'));
const RevenueProjectionPanel = lazy(() => import('../panels/insurance/RevenueProjectionPanel'));
const CoverageExplorerPanel = lazy(() => import('../panels/insurance/CoverageExplorerPanel'));
const CoverageStatusPanel = lazy(() => import('../panels/insurance/CoverageStatusPanel'));

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="spinner w-8 h-8" />
    </div>
  );
}

const TABS = [
  { id: 'risk', label: 'Risk Profile', icon: Shield },
  { id: 'projections', label: 'Revenue Projections', icon: TrendingUp },
  { id: 'explore', label: 'Coverage Explorer', icon: Sliders },
  { id: 'status', label: 'Coverage Status', icon: FileCheck },
];

export default function InsuranceDashboard() {
  const [activeTab, setActiveTab] = useState('risk');

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-terminal-green">Insurance & Revenue Protection</h2>
        <p className="text-xs text-terminal-muted mt-1">
          Sangha revenue floor guarantees — risk assessment, coverage exploration, and policy management.
        </p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-4 border-b border-terminal-border pb-2 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-t text-sm whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-terminal-panel text-terminal-green border border-terminal-green/30 border-b-0'
                : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-panel/50'
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<LoadingSpinner />}>
        {activeTab === 'risk' && <RiskProfilePanel />}
        {activeTab === 'projections' && <RevenueProjectionPanel />}
        {activeTab === 'explore' && <CoverageExplorerPanel />}
        {activeTab === 'status' && <CoverageStatusPanel />}
      </Suspense>
    </div>
  );
}
