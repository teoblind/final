import React, { useState, useMemo, useEffect } from 'react';
import { Search, ExternalLink, ChevronRight, ChevronDown, FolderOpen, RefreshCw, Send, Mail } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

// ─── File Type Icons ────────────────────────────────────────────────────────

const FILE_ICONS = {
  doc:    { letter: 'D', bg: '#e8eef5', color: '#2c5282' },
  docx:   { letter: 'D', bg: '#e8eef5', color: '#2c5282' },
  sheet:  { letter: 'S', bg: '#edf7f0', color: '#1a6b3c' },
  xlsx:   { letter: 'S', bg: '#edf7f0', color: '#1a6b3c' },
  slides: { letter: 'P', bg: '#fdf6e8', color: '#b8860b' },
  pptx:   { letter: 'P', bg: '#fdf6e8', color: '#b8860b' },
  pdf:    { letter: 'F', bg: '#fdedf0', color: '#dc3545' },
  csv:    { letter: 'C', bg: '#edf7f0', color: '#1a6b3c' },
  other:  { letter: '?', bg: '#f5f4f0', color: '#666' },
};

function getFileIcon(fileType) {
  return FILE_ICONS[fileType] || FILE_ICONS.other;
}

// Google Drive icon SVG
function DriveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="inline-block">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.85 10.15z" fill="#ea4335"/>
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h36.85c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5 60.65 3.3c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.25 28h27.5c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

// ─── Demo Data ──────────────────────────────────────────────────────────────

const MINING_FOLDERS = {
  'Reports': {
    path: '/Sangha/Reports/',
    files: [
      { name: 'Week 10 Operations Report', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
      { name: 'Daily Curtailment Summary — Mar 6', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'February P&L Review', type: 'sheet', owner: 'Spencer Marr', modified: 'Mar 3, 2026', agent: false },
      { name: 'Q1 Insurance Progress', type: 'doc', owner: 'Spencer Marr', modified: 'Feb 28, 2026', agent: false },
    ],
  },
  'Presentations': {
    path: '/Sangha/Presentations/',
    files: [
      { name: 'Weekly Executive Briefing — W10', type: 'slides', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
      { name: 'Total Energies Meeting Deck', type: 'slides', owner: 'Spencer Marr', modified: 'Mar 5, 2026', agent: false },
      { name: 'Investor Update — February', type: 'slides', owner: 'Workspace Agent', modified: 'Mar 1, 2026', agent: true },
    ],
  },
  'Deals': {
    path: '/Sangha/Deals/',
    files: [
      { name: 'SunPeak Energy — Prospect Brief', type: 'doc', owner: 'Workspace Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'GridScale Partners — Term Sheet Draft', type: 'doc', owner: 'Spencer Marr', modified: 'Mar 4, 2026', agent: false },
      { name: 'Lead Pipeline Tracker', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
    ],
  },
  'Fleet': {
    path: '/Sangha/Fleet/',
    files: [
      { name: 'Fleet Inventory — March 2026', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 7, 2026', agent: true },
      { name: 'S19 Viability Analysis', type: 'sheet', owner: 'Workspace Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'Crane County Site Review', type: 'slides', owner: 'Spencer Marr', modified: 'Feb 25, 2026', agent: false },
      { name: 'Hardware Procurement Quotes', type: 'pdf', owner: 'Miguel Torres', modified: 'Feb 20, 2026', agent: false },
    ],
  },
};

const DACP_FOLDERS = {
  'Estimates': {
    path: '/DACP/Estimates/',
    files: [
      { name: 'DACP_Estimate_BishopArts.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 9, 2026', agent: true },
      { name: 'DACP_Estimate_MemorialHermann_Ph2.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 6, 2026', agent: true },
      { name: 'DACP_Estimate_I35RetainingWalls.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 8, 2026', agent: true },
      { name: 'DACP_Estimate_SamsungFab_Revised.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 6, 2026', agent: true },
      { name: 'DACP_Estimate_McKinneyTC_Draft.xlsx', type: 'sheet', owner: 'Estimating Bot', modified: 'Mar 8, 2026', agent: true },
    ],
  },
  'Meeting Notes': {
    path: '/DACP/Meeting Notes/',
    files: [
      { name: 'Turner_CoordinationCall_Mar6.pdf', type: 'pdf', owner: 'Meeting Bot', modified: 'Mar 6, 2026', agent: true },
      { name: 'WeeklyStandup_Mar5.pdf', type: 'pdf', owner: 'Meeting Bot', modified: 'Mar 5, 2026', agent: true },
      { name: 'DPR_SamsungFab_ScopeReview_Mar3.pdf', type: 'pdf', owner: 'Meeting Bot', modified: 'Mar 3, 2026', agent: true },
    ],
  },
  'Daily Reports': {
    path: '/DACP/Daily Reports/',
    files: [
      { name: 'DailyOps_Mar9.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 9, 2026', agent: true },
      { name: 'DailyOps_Mar8.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 8, 2026', agent: true },
      { name: 'DailyOps_Mar7.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 7, 2026', agent: true },
      { name: 'DailyOps_Mar6.pdf', type: 'pdf', owner: 'Reporting Engine', modified: 'Mar 6, 2026', agent: true },
    ],
  },
  'Field Reports': {
    path: '/DACP/Field Reports/',
    files: [
      { name: 'Westpark_DailyLog_Mar8.pdf', type: 'pdf', owner: 'Carlos Mendez', modified: 'Mar 8, 2026', agent: false },
      { name: 'Westpark_DailyLog_Mar7.pdf', type: 'pdf', owner: 'Carlos Mendez', modified: 'Mar 7, 2026', agent: false },
      { name: 'FriscoStation_RockFlag_Mar7.pdf', type: 'pdf', owner: 'Carlos Mendez', modified: 'Mar 7, 2026', agent: false },
    ],
  },
  'GC Correspondence': {
    path: '/DACP/GC Correspondence/',
    files: [
      { name: 'Turner_MemorialHermann_Ph2_Bid.pdf', type: 'pdf', owner: 'Email Agent', modified: 'Mar 6, 2026', agent: true },
      { name: 'HenselPhelps_I35_RFQ.pdf', type: 'pdf', owner: 'Email Agent', modified: 'Mar 8, 2026', agent: true },
      { name: 'DPR_SamsungFab_RevisedScope.pdf', type: 'pdf', owner: 'Email Agent', modified: 'Mar 6, 2026', agent: true },
    ],
  },
  'Pricing': {
    path: '/DACP/Pricing/',
    files: [
      { name: 'DACP_MasterPricingTable_2026.xlsx', type: 'sheet', owner: 'David Castillo', modified: 'Mar 1, 2026', agent: false },
      { name: 'TXI_PriceLetter_Mar2026.pdf', type: 'pdf', owner: 'Marcel Pineda', modified: 'Mar 1, 2026', agent: false },
    ],
  },
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function FilesDashboard() {
  const { tenant } = useTenant();
  const isConstruction = tenant?.settings?.industry === 'construction';
  const demoFolders = isConstruction ? DACP_FOLDERS : MINING_FOLDERS;
  const driveRoot = isConstruction ? '/DACP/' : '/Sangha/';

  const [folders, setFolders] = useState(demoFolders);
  const [liveMode, setLiveMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set(Object.keys(demoFolders)));
  const [selectedFolder, setSelectedFolder] = useState(Object.keys(demoFolders)[0]);
  const [search, setSearch] = useState('');
  const [totalFiles, setTotalFiles] = useState(0);

  // Format date string for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Convert API files into folder structure
  const buildFoldersFromApi = (files, categories) => {
    const grouped = {};
    for (const file of files) {
      const cat = file.category || 'Other';
      if (!grouped[cat]) {
        grouped[cat] = { path: `${driveRoot}${cat}/`, files: [] };
      }
      grouped[cat].files.push({
        name: file.name,
        type: file.file_type || 'other',
        owner: '',
        modified: formatDate(file.modified_at),
        agent: true,
        url: file.drive_url || null,
        isDrive: !!file.drive_url,
        size: file.size_bytes,
        category: cat,
      });
    }
    // Sort categories by count (use categories array order)
    if (categories) {
      const ordered = {};
      for (const cat of categories) {
        if (grouped[cat.category]) {
          ordered[cat.category] = grouped[cat.category];
        }
      }
      // Add any remaining
      for (const [k, v] of Object.entries(grouped)) {
        if (!ordered[k]) ordered[k] = v;
      }
      return ordered;
    }
    return grouped;
  };

  // Try to load real files from API
  useEffect(() => {
    let cancelled = false;
    async function fetchFiles() {
      try {
        // First try the tenant files endpoint
        const res = await fetch(`${API_BASE}/v1/files`);
        if (!res.ok) throw new Error('Files endpoint not available');
        const data = await res.json();
        if (!cancelled && data.files && data.files.length > 0) {
          const grouped = buildFoldersFromApi(data.files, data.categories);
          if (Object.keys(grouped).length > 0) {
            setFolders(grouped);
            setExpandedFolders(new Set(Object.keys(grouped)));
            setSelectedFolder(Object.keys(grouped)[0]);
            setLiveMode(true);
            setTotalFiles(data.total || data.files.length);
            return;
          }
        }
      } catch {
        // Fall through to workspace agent
      }

      // Fallback: try workspace agent
      try {
        const res = await fetch(`${API_BASE}/v1/workspace/files`);
        if (!res.ok) throw new Error('Workspace agent not available');
        const data = await res.json();
        if (!cancelled && data.files && data.files.length > 0) {
          const grouped = {};
          for (const file of data.files) {
            const folder = file.folder || 'Uncategorized';
            if (!grouped[folder]) grouped[folder] = { path: `${driveRoot}${folder}/`, files: [] };
            grouped[folder].files.push({
              name: file.name,
              type: file.type || 'doc',
              owner: file.owner || 'Unknown',
              modified: file.modified || '',
              agent: file.agent || false,
              url: file.url,
            });
          }
          if (Object.keys(grouped).length > 0) {
            setFolders(grouped);
            setExpandedFolders(new Set(Object.keys(grouped)));
            setSelectedFolder(Object.keys(grouped)[0]);
            setLiveMode(true);
          }
        }
      } catch {
        // Silently fall back to demo data
      }
    }
    fetchFiles();
    return () => { cancelled = true; };
  }, [isConstruction]);

  const refreshFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/files`);
      if (res.ok) {
        const data = await res.json();
        if (data.files?.length > 0) {
          const grouped = buildFoldersFromApi(data.files, data.categories);
          setFolders(grouped);
          setLiveMode(true);
          setTotalFiles(data.total || data.files.length);
        }
      }
    } catch {}
    setLoading(false);
  };

  const toggleFolder = (name) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setSelectedFolder(name);
  };

  const filteredFiles = useMemo(() => {
    if (!search.trim()) {
      return folders[selectedFolder]?.files || [];
    }
    const q = search.toLowerCase();
    const results = [];
    for (const [, folder] of Object.entries(folders)) {
      for (const file of folder.files) {
        if (file.name.toLowerCase().includes(q) || (file.owner && file.owner.toLowerCase().includes(q))) {
          results.push(file);
        }
      }
    }
    return results;
  }, [folders, selectedFolder, search]);

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-sm font-bold text-terminal-text tracking-[0.3px]">Files</h2>
        {liveMode ? (
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.5px] px-2 py-0.5 rounded-full bg-[#edf7f0] text-[#1a6b3c] border border-[#d0e8d8]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#1a6b3c] animate-pulse" />
            Live
          </span>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-2 py-0.5 rounded-full bg-[#f5f4f0] text-terminal-muted border border-terminal-border">Demo</span>
        )}
        {totalFiles > 0 && (
          <span className="text-[11px] text-terminal-muted">{totalFiles} files</span>
        )}
        <button
          onClick={refreshFiles}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-terminal-muted bg-[#f5f4f0] border border-terminal-border hover:bg-[#eeede8] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-[12px] bg-[#f5f4f0] border border-terminal-border text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-terminal-green transition-colors"
          />
        </div>
      </div>

      <div className="flex gap-5">
        {/* Folder tree sidebar */}
        <div className="w-52 shrink-0">
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
            <div className="px-[14px] py-[10px] border-b border-[#f0eeea]">
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Folders</span>
            </div>
            <div className="py-1">
              {Object.keys(folders).map(name => {
                const isExpanded = expandedFolders.has(name);
                const isSelected = selectedFolder === name && !search.trim();
                return (
                  <button
                    key={name}
                    onClick={() => toggleFolder(name)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                      isSelected
                        ? 'bg-[rgba(45,212,120,0.06)] text-terminal-text'
                        : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
                    }`}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="shrink-0 opacity-40" />
                      : <ChevronRight size={12} className="shrink-0 opacity-40" />
                    }
                    <FolderOpen size={14} className={`shrink-0 ${isSelected ? 'text-terminal-green' : 'opacity-50'}`} />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto text-[10px] text-terminal-muted tabular-nums">
                      {folders[name].files.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 min-w-0">
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_100px_140px] gap-2 px-[18px] py-[10px] border-b border-[#f0eeea]">
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Name</span>
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Modified</span>
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] text-right">Actions</span>
            </div>

            {/* Path breadcrumb */}
            {!search.trim() && (
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] font-mono text-terminal-muted">
                  {folders[selectedFolder]?.path}
                </span>
              </div>
            )}
            {search.trim() && (
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] text-terminal-muted">
                  {filteredFiles.length} result{filteredFiles.length !== 1 ? 's' : ''} for "{search}"
                </span>
              </div>
            )}

            {/* Files */}
            {filteredFiles.length === 0 ? (
              <div className="px-[18px] py-10 text-center text-[13px] text-terminal-muted">No files found.</div>
            ) : (
              filteredFiles.map((file, i) => {
                const icon = getFileIcon(file.type);
                const isExternal = file.isDrive || (file.url && file.url.startsWith('http'));
                const isReport = file.name.toLowerCase().includes('report') || file.name.toLowerCase().includes('contact');
                const isEstimate = file.name.toLowerCase().includes('estimate');
                const isPipeline = file.name.toLowerCase().includes('pipeline');
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_100px_140px] gap-2 items-center px-[18px] py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors group"
                  >
                    {/* Name with icon */}
                    <div
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (isExternal) {
                          window.open(file.url, '_blank', 'noopener,noreferrer');
                        } else if (file.url) {
                          window.open(`${FILE_BASE}${file.url}`, '_blank');
                        }
                      }}
                    >
                      <span
                        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ background: icon.bg, color: icon.color }}
                      >
                        {icon.letter}
                      </span>
                      <span className="text-[13px] font-medium text-terminal-text truncate group-hover:text-[#2c5282] transition-colors">{file.name}</span>
                      {file.isDrive && (
                        <span className="flex items-center gap-1 text-[9px] font-semibold text-[#666] shrink-0" title="Opens in Google Drive">
                          <DriveIcon />
                        </span>
                      )}
                      {file.agent && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f3eef8] text-[#5b3a8c] border-[#d8cce8] shrink-0">
                          agent
                        </span>
                      )}
                      {file.size > 0 && (
                        <span className="text-[10px] text-terminal-muted shrink-0">{formatSize(file.size)}</span>
                      )}
                    </div>

                    {/* Modified */}
                    <span className="text-[12px] text-terminal-muted tabular-nums">{file.modified}</span>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(isReport || isPipeline) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const teamEmail = isConstruction ? 'Mpineda@dacpholdings.com' : 'spencer@sanghasystems.com';
                            const subject = encodeURIComponent(`Coppice Report: ${file.name}`);
                            const body = encodeURIComponent(`Hi,\n\nPlease find the latest ${file.name}.\n\n${file.url ? 'View in Drive: ' + file.url + '\n\n' : ''}Generated by Coppice on ${file.modified || new Date().toLocaleDateString()}.\n\nBest,\nCoppice Agent`);
                            window.open(`mailto:${teamEmail}?subject=${subject}&body=${body}`, '_self');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#1a6b3c] bg-[#edf7f0] border border-[#d0e8d8] hover:bg-[#dff0e5] transition-colors"
                          title="Send to team"
                        >
                          <Send size={9} /> Send
                        </button>
                      )}
                      {isEstimate && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const gcName = file.name.replace(/DACP_Estimate_|\.xlsx/g, '').replace(/_/g, ' ');
                            const subject = encodeURIComponent(`DACP Estimate — ${gcName}`);
                            const body = encodeURIComponent(`Please find attached our estimate for ${gcName}.\n\n${file.url ? 'View: ' + file.url + '\n\n' : ''}Best regards,\nDACP Construction`);
                            window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#2c5282] bg-[#e8eef5] border border-[#c5d5e8] hover:bg-[#dce6f0] transition-colors"
                          title="Send to GC"
                        >
                          <Mail size={9} /> Send to GC
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isExternal) {
                            window.open(file.url, '_blank', 'noopener,noreferrer');
                          } else if (file.url) {
                            window.open(`${FILE_BASE}${file.url}`, '_blank');
                          }
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#2c5282] hover:bg-[#e8eef5] transition-colors"
                      >
                        Open <ExternalLink size={9} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
