import React from 'react';
import { X, Activity, TrendingUp, Bell, FileText, Database, Settings, ExternalLink } from 'lucide-react';

export default function Sidebar({ onClose }) {
  return (
    <div className="absolute left-0 top-0 bottom-0 w-64 bg-terminal-panel border-r border-terminal-border">
      <div className="flex items-center justify-between p-4 border-b border-terminal-border">
        <span className="font-bold">Menu</span>
        <button onClick={onClose} className="p-1 hover:bg-terminal-border rounded">
          <X size={20} />
        </button>
      </div>

      <nav className="p-4 space-y-1">
        <NavItem icon={<Activity size={18} />} label="Dashboard" />
        <NavItem icon={<TrendingUp size={18} />} label="Correlations" />
        <NavItem icon={<Bell size={18} />} label="Alerts" />
        <NavItem icon={<FileText size={18} />} label="Notes" />
        <NavItem icon={<Database size={18} />} label="Data Entry" />
      </nav>

      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-terminal-border">
        <div className="text-xs text-terminal-muted space-y-2">
          <p className="font-bold text-terminal-green">ZHAN MACRO</p>
          <p>Atoms &gt; Bits</p>
          <p>Tracking the rotation from asset-light software to energy-intensive industries.</p>
        </div>

        <div className="mt-4 space-y-1">
          <SidebarLink label="Thesis Resources" href="https://coppice.ai" />
          <SidebarLink label="Data Sources" href="https://coppice.ai" />
          <SidebarLink label="API Docs" href="/api/health" />
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon, label, active }) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors ${
        active
          ? 'bg-terminal-green/10 text-terminal-green'
          : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SidebarLink({ label, href }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-xs text-terminal-muted hover:text-terminal-green"
    >
      <ExternalLink size={12} />
      {label}
    </a>
  );
}
