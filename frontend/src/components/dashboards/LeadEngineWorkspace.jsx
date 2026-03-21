import React, { useState, Suspense, lazy } from 'react';

const AgentChat = lazy(() => import('../chat/AgentChat'));
const PipelineTab = lazy(() => import('./lead-engine/PipelineTab'));
const OutreachTab = lazy(() => import('./lead-engine/OutreachTab'));
const ContactsTab = lazy(() => import('./lead-engine/ContactsTab'));
const ConfigTab = lazy(() => import('./lead-engine/ConfigTab'));

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'contacts', label: 'Contacts' },
  { id: 'config', label: 'Config' },
];

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="spinner w-10 h-10" />
    </div>
  );
}

export default function LeadEngineWorkspace() {
  const [activeTab, setActiveTab] = useState('chat');

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-terminal-border bg-terminal-panel shrink-0">
        <div className="flex items-center gap-1.5 mr-4">
          <div className="w-6 h-6 rounded-lg bg-ui-accent flex items-center justify-center text-[11px] font-bold text-white">L</div>
          <span className="text-[13px] font-semibold text-terminal-text">Lead Engine</span>
        </div>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-ui-accent text-white'
                : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'chat' ? (
        <div className="flex-1 relative">
          <Suspense fallback={<LoadingSpinner />}>
            <AgentChat agentId="lead-engine" />
          </Suspense>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <Suspense fallback={<LoadingSpinner />}>
            {activeTab === 'pipeline' && <PipelineTab />}
            {activeTab === 'outreach' && <OutreachTab />}
            {activeTab === 'contacts' && <ContactsTab />}
            {activeTab === 'config' && <ConfigTab />}
          </Suspense>
        </div>
      )}
    </div>
  );
}
