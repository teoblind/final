import React, { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STATUS_BADGE = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  estimated: 'bg-green-50 text-green-700 border-green-200',
  sent: 'bg-purple-50 text-purple-700 border-purple-200',
  'in_progress': 'bg-amber-50 text-amber-700 border-amber-200',
  bidding: 'bg-[#1e3a5f]/10 text-[#1e3a5f] border-[#1e3a5f]/30',
  passed: 'bg-gray-100 text-gray-500 border-gray-300',
};

const URGENCY_BADGE = {
  high: 'bg-red-50 text-terminal-red border-red-200',
  medium: 'bg-amber-50 text-terminal-amber border-amber-200',
  low: 'bg-gray-50 text-terminal-muted border-gray-200',
};

const CONFIDENCE_BADGE = {
  high: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
};

const DELTA_COLORS = {
  up: 'text-[#1e3a5f]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

const WORKFLOW_STEPS = [
  { num: 1, label: 'Analyze ITB' },
  { num: 2, label: 'Organize Docs' },
  { num: 3, label: 'Configure Takeoff' },
  { num: 4, label: 'Review Plans' },
  { num: 5, label: 'Supplier Pricing' },
  { num: 6, label: 'Bid Summary' },
  { num: 7, label: 'Proposal' },
  { num: 8, label: 'Contract' },
];

/* ── Workflow Stepper ── */
function WorkflowStepper({ currentStep }) {
  return (
    <div className="px-[18px] py-3 border-b border-[#f0eeea] overflow-x-auto">
      <div className="flex items-center gap-0 min-w-max">
        {WORKFLOW_STEPS.map((step, i) => {
          const isDone = currentStep > step.num;
          const isCurrent = currentStep === step.num;
          return (
            <React.Fragment key={step.num}>
              {i > 0 && (
                <div className={`flex-shrink-0 h-[2px] w-4 ${isDone ? 'bg-[#1e3a5f]' : 'bg-[#e0deda]'}`} />
              )}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold leading-none ${
                  isDone ? 'bg-[#1e3a5f] text-white' :
                  isCurrent ? 'bg-[#1e3a5f] text-white ring-2 ring-[#1e3a5f]/30' :
                  'bg-[#f0eeea] text-terminal-muted'
                }`}>
                  {isDone ? '\u2713' : step.num}
                </div>
                <span className={`text-[10px] whitespace-nowrap ${
                  isCurrent ? 'font-bold text-[#1e3a5f]' :
                  isDone ? 'font-medium text-terminal-text' :
                  'text-terminal-muted'
                }`}>{step.label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ── Document Organization Panel (Step 2) ── */
function DocumentOrganizationPanel({ bid, token, onAdvance }) {
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [divisions, setDivisions] = useState(null);
  const [expandedDiv, setExpandedDiv] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  const handleFiles = (newFiles) => {
    const arr = Array.from(newFiles);
    setFiles(prev => [...prev, ...arr]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleAnalyzeDocs = async () => {
    setAnalyzing(true);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append('documents', f));
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${bid.id}/analyze-documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.divisions) {
        setDivisions(data.divisions.map(d => ({ ...d, relevant: d.relevant !== false })));
      }
    } catch (e) { console.error(e); }
    setAnalyzing(false);
  };

  const toggleRelevant = (idx) => {
    setDivisions(prev => prev.map((d, i) => i === idx ? { ...d, relevant: !d.relevant } : d));
  };

  const handleConfirmScope = async () => {
    setConfirming(true);
    try {
      const relevant = divisions.filter(d => d.relevant).map(d => ({ code: d.code, name: d.name }));
      await fetch(`${API_BASE}/v1/estimates/inbox/${bid.id}/confirm-scope`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ divisions: relevant }),
      });
      onAdvance(3);
    } catch (e) { console.error(e); }
    setConfirming(false);
  };

  return (
    <div className="px-[18px] py-3">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-[1px] mb-3">Document Organization</div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors mb-3 ${
          dragOver ? 'border-[#1e3a5f] bg-[#1e3a5f]/5' : 'border-[#e0deda] hover:border-[#1e3a5f]/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx,.csv"
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="text-[12px] font-medium text-terminal-text mb-1">Drop bid package documents here</div>
        <div className="text-[10px] text-terminal-muted">Plans PDF, spec book, addenda &mdash; or click to browse</div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mb-3 space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] bg-[#f5f4f0] rounded px-2.5 py-1.5">
              <span className="text-terminal-muted">&#128196;</span>
              <span className="flex-1 truncate text-terminal-text">{f.name}</span>
              <span className="text-[10px] text-terminal-muted">{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 text-[10px] font-bold ml-1">&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Analyze button */}
      {!divisions && (
        <button
          onClick={handleAnalyzeDocs}
          disabled={analyzing || files.length === 0}
          className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a] disabled:opacity-50 transition-colors mb-3"
        >
          {analyzing ? 'Analyzing Documents...' : 'Analyze Documents'}
        </button>
      )}

      {/* CSI Division breakdown */}
      {divisions && (
        <>
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-2 mt-2">CSI Divisions</div>
          <div className="space-y-0.5 mb-4 max-h-[350px] overflow-y-auto">
            {divisions.map((div, idx) => (
              <div key={idx} className={`border rounded-lg transition-colors ${div.relevant ? 'border-[#1e3a5f]/20 bg-white' : 'border-[#e0deda] bg-[#f9f9f7] opacity-60'}`}>
                <div className="flex items-center gap-2 px-2.5 py-2 cursor-pointer" onClick={() => setExpandedDiv(expandedDiv === idx ? null : idx)}>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleRelevant(idx); }}
                    className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[9px] transition-colors ${
                      div.relevant ? 'bg-[#1e3a5f] border-[#1e3a5f] text-white' : 'border-[#ccc] bg-white'
                    }`}
                  >
                    {div.relevant && '\u2713'}
                  </button>
                  <span className="text-[11px] font-mono text-[#1e3a5f] font-semibold flex-shrink-0">{div.code}</span>
                  <span className="text-[11px] text-terminal-text flex-1 truncate">&mdash; {div.name}</span>
                  <span className={`text-[10px] text-terminal-muted transition-transform ${expandedDiv === idx ? 'rotate-180' : ''}`}>&#9660;</span>
                </div>
                {expandedDiv === idx && div.spec_requirements && (
                  <div className="px-2.5 pb-2 pt-0">
                    <div className="text-[10px] font-semibold text-terminal-muted mb-1">Spec Requirements</div>
                    <ul className="space-y-0.5">
                      {(Array.isArray(div.spec_requirements) ? div.spec_requirements : [div.spec_requirements]).map((req, ri) => (
                        <li key={ri} className="text-[10px] text-[#6b6b65] flex items-start gap-1">
                          <span className="text-terminal-muted mt-px">&bull;</span>
                          <span>{req}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={handleConfirmScope}
            disabled={confirming || divisions.filter(d => d.relevant).length === 0}
            className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a] disabled:opacity-50 transition-colors"
          >
            {confirming ? 'Confirming...' : `Confirm Scope (${divisions.filter(d => d.relevant).length} divisions)`}
          </button>
        </>
      )}
    </div>
  );
}

/* ── Plan Analysis Panel (Step 4) ── */
function PlanAnalysisPanel({ bid, token, onAdvance }) {
  const [files, setFiles] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [planswiftFile, setPlanswiftFile] = useState(null);
  const [parsedQuantities, setParsedQuantities] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  const psFileInputRef = useRef(null);
  const headers = { Authorization: `Bearer ${token}` };

  const handleFiles = (newFiles) => {
    const arr = Array.from(newFiles);
    setFiles(prev => [...prev, ...arr]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (idx) => setFiles(prev => prev.filter((_, i) => i !== idx));

  const handleAnalyzePlans = async () => {
    setAnalyzing(true);
    try {
      const formData = new FormData();
      files.forEach(f => formData.append('plans', f));
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${bid.id}/analyze-plans`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.elements) {
        setAnalysis(data.elements);
      }
    } catch (e) { console.error(e); }
    setAnalyzing(false);
  };

  const handlePlanswiftImport = async (file) => {
    setPlanswiftFile(file);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${bid.id}/import-planswift`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json();
      if (data.quantities) setParsedQuantities(data.quantities);
    } catch (e) { console.error(e); }
  };

  const handleContinue = async () => {
    try {
      await fetch(`${API_BASE}/v1/estimates/inbox/${bid.id}/advance-step`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_step: 5 }),
      });
      onAdvance(5);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="px-[18px] py-3">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-[1px] mb-3">Plan Analysis</div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-5 text-center cursor-pointer transition-colors mb-3 ${
          dragOver ? 'border-[#1e3a5f] bg-[#1e3a5f]/5' : 'border-[#e0deda] hover:border-[#1e3a5f]/40'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
        <div className="text-[12px] font-medium text-terminal-text mb-1">Drop plan pages here</div>
        <div className="text-[10px] text-terminal-muted">PNG, JPG, or PDF &mdash; or click to browse</div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mb-3 space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] bg-[#f5f4f0] rounded px-2.5 py-1.5">
              <span className="text-terminal-muted">&#128196;</span>
              <span className="flex-1 truncate text-terminal-text">{f.name}</span>
              <span className="text-[10px] text-terminal-muted">{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-600 text-[10px] font-bold ml-1">&times;</button>
            </div>
          ))}
        </div>
      )}

      {/* Analyze button */}
      {!analysis && (
        <button
          onClick={handleAnalyzePlans}
          disabled={analyzing || files.length === 0}
          className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a] disabled:opacity-50 transition-colors mb-3"
        >
          {analyzing ? 'Analyzing Plans...' : 'Analyze Plans'}
        </button>
      )}

      {/* Analysis results — grouped by type */}
      {analysis && (
        <div className="mb-4">
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-2">Identified Elements</div>
          <div className="space-y-3 max-h-[300px] overflow-y-auto">
            {Object.entries(
              analysis.reduce((groups, el) => {
                const g = el.group || el.type || 'Other';
                if (!groups[g]) groups[g] = [];
                groups[g].push(el);
                return groups;
              }, {})
            ).map(([group, items]) => (
              <div key={group}>
                <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-[0.5px] mb-1">{group}</div>
                <div className="space-y-0.5">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 text-[11px]">
                      <input type="checkbox" defaultChecked className="mt-0.5 accent-[#1e3a5f]" />
                      <span className="text-terminal-text">{item.description}</span>
                      {item.quantity && <span className="text-terminal-muted ml-auto whitespace-nowrap">&mdash; {item.quantity}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PlanSwift import */}
      <div className="border-t border-[#f0eeea] pt-3 mt-3">
        <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-2">PlanSwift Import</div>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => psFileInputRef.current?.click()}
            className="px-2.5 py-1 bg-[#f5f4f0] border border-terminal-border rounded text-[11px] font-medium text-[#555] hover:bg-[#eeedea]"
          >
            {planswiftFile ? planswiftFile.name : 'Upload XLSX / CSV'}
          </button>
          <input
            ref={psFileInputRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={(e) => { if (e.target.files[0]) handlePlanswiftImport(e.target.files[0]); e.target.value = ''; }}
          />
        </div>

        {/* Parsed quantities table */}
        {parsedQuantities && parsedQuantities.length > 0 && (
          <div className="overflow-x-auto mb-3">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-[#f0eeea]">
                  <th className="text-left py-1 font-semibold text-terminal-muted">Item</th>
                  <th className="text-right py-1 font-semibold text-terminal-muted w-16">Qty</th>
                  <th className="text-right py-1 font-semibold text-terminal-muted w-14">Unit</th>
                </tr>
              </thead>
              <tbody>
                {parsedQuantities.map((q, i) => (
                  <tr key={i} className="border-b border-[#f0eeea] last:border-b-0">
                    <td className="py-1 text-[#6b6b65] truncate max-w-[200px]">{q.item || q.description}</td>
                    <td className="py-1 text-right tabular-nums text-terminal-text">{q.quantity?.toLocaleString()}</td>
                    <td className="py-1 text-right text-terminal-muted">{q.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Continue button */}
      {(analysis || parsedQuantities) && (
        <button
          onClick={handleContinue}
          className="mt-3 px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a] transition-colors"
        >
          Continue to Pricing
        </button>
      )}
    </div>
  );
}

export default function DacpEstimatingDashboard() {
  const [bids, setBids] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [filterTab, setFilterTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [itbAnalysis, setItbAnalysis] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [sanityResult, setSanityResult] = useState(null);
  const [checkingBid, setCheckingBid] = useState(false);
  const [generatingDoc, setGeneratingDoc] = useState(null);
  const [bidDecisionLoading, setBidDecisionLoading] = useState(false);
  const [showPassReason, setShowPassReason] = useState(false);
  const [passReason, setPassReason] = useState('');

  const token = localStorage.getItem('auth_token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/inbox`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/estimates`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/stats`, { headers }).then(r => r.json()),
    ]).then(([inboxRes, estRes, statsRes]) => {
      setBids(inboxRes.bidRequests || []);
      setEstimates(estRes.estimates || []);
      setStats(statsRes.stats);
      if (inboxRes.bidRequests?.length > 0) setSelectedId(inboxRes.bidRequests[0].id);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filteredBids = filterTab === 'all' ? bids
    : bids.filter(b => b.status === filterTab);

  const selected = bids.find(b => b.id === selectedId);
  const selectedEstimate = selected ? estimates.find(e => e.bid_request_id === selected.id) : null;

  const handleGenerate = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${selected.id}/estimate`, {
        method: 'POST', headers,
      });
      const data = await res.json();
      if (data.estimate) {
        setEstimates(prev => [data.estimate, ...prev]);
        setBids(prev => prev.map(b => b.id === selected.id ? { ...b, status: 'estimated' } : b));
      }
    } catch (e) { console.error(e); }
    setGenerating(false);
  };

  const tabs = [
    { id: 'all', label: 'All', count: bids.length },
    { id: 'new', label: 'New', count: bids.filter(b => b.status === 'new').length },
    { id: 'bidding', label: 'Bidding', count: bids.filter(b => b.status === 'bidding').length },
    { id: 'estimated', label: 'Estimated', count: bids.filter(b => b.status === 'estimated').length },
    { id: 'sent', label: 'Sent', count: bids.filter(b => b.status === 'sent').length },
    { id: 'passed', label: 'Passed', count: bids.filter(b => b.status === 'passed').length },
  ];

  const statMetrics = stats ? [
    { label: 'Open RFQs', value: stats.openRfqs, delta: 'inbox', type: 'up' },
    { label: 'Due This Week', value: bids.filter(b => { const d = Math.ceil((new Date(b.due_date) - new Date()) / 86400000); return d >= 0 && d <= 7; }).length, delta: 'urgent', type: 'warn' },
    { label: 'Avg Response', value: '1.2d', delta: 'target 2d', type: 'up' },
    { label: 'Bids Out', value: stats.sentEstimates || 0, delta: 'sent', type: 'flat' },
    { label: 'Hit Rate', value: `${stats.winRate}%`, delta: `${stats.wonJobs}W/${stats.lostJobs}L`, type: stats.winRate > 50 ? 'up' : 'warn' },
    { label: 'Pipeline $', value: `$${((estimates.reduce((s, e) => s + (e.total_bid || 0), 0)) / 1000).toFixed(0)}K`, delta: `${estimates.length} bids`, type: 'up' },
  ] : [];

  const handleAnalyzeItb = useCallback(async () => {
    if (!selected) return;
    setAnalyzing(true);
    setItbAnalysis(null);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${selected.id}/analyze`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.analysis) {
        setItbAnalysis(data.analysis);
        setShowAnalysis(true);
      }
    } catch (e) { console.error(e); }
    setAnalyzing(false);
  }, [selected]);

  const handleSanityCheck = useCallback(async () => {
    if (!selectedEstimate) return;
    setCheckingBid(true);
    setSanityResult(null);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/estimates/${selectedEstimate.id}/sanity-check`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      setSanityResult(data);
    } catch (e) { console.error(e); }
    setCheckingBid(false);
  }, [selectedEstimate]);

  const handleGenerateDoc = useCallback(async (type) => {
    if (!selected) return;
    setGeneratingDoc(type);
    try {
      let url, body;
      if (type === 'takeoff') {
        url = `${API_BASE}/v1/estimates/generate-takeoff-template`;
        body = { project_name: selected.project, gc_name: selected.gc_name || selected.from_company };
      } else if (type === 'compliance') {
        url = `${API_BASE}/v1/estimates/generate-compliance-forms`;
        body = { project_name: selected.project, gc_name: selected.gc_name || selected.from_company, bid_date: selected.due_date };
      } else if (type === 'proposal') {
        url = `${API_BASE}/v1/estimates/generate-proposal`;
        body = {
          projectName: selected.project, gcName: selected.gc_name || selected.from_company,
          location: selected.location || '', bidDueDate: selected.due_date,
          totalBid: selectedEstimate?.total_bid || 0,
        };
      }
      const res = await fetch(url, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.file_path) {
        alert(`Document generated: ${data.file_path.split('/').pop()}`);
      } else if (data.error) {
        alert(`Error: ${data.error}`);
      } else {
        alert('Document generated successfully');
      }
    } catch (e) { console.error(e); alert('Failed to generate document'); }
    setGeneratingDoc(null);
  }, [selected, selectedEstimate]);

  const handleBidDecision = useCallback(async (decision, reason) => {
    if (!selected) return;
    setBidDecisionLoading(true);
    try {
      const body = { decision };
      if (reason) body.reason = reason;
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${selected.id}/bid-decision`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (decision === 'bid') {
        setBids(prev => prev.map(b => b.id === selected.id ? { ...b, status: 'bidding', workflow_step: 2 } : b));
      } else {
        setBids(prev => prev.map(b => b.id === selected.id ? { ...b, status: 'passed' } : b));
      }
      setShowPassReason(false);
      setPassReason('');
    } catch (e) { console.error(e); }
    setBidDecisionLoading(false);
  }, [selected]);

  const handleWorkflowAdvance = useCallback((newStep) => {
    if (!selected) return;
    setBids(prev => prev.map(b => b.id === selected.id ? { ...b, workflow_step: newStep } : b));
  }, [selected]);

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Stats Strip */}
      {statMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
          {statMetrics.map((m) => (
            <div key={m.label} className="bg-terminal-panel p-[14px_16px]">
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">{m.label}</div>
              <div className="text-xl font-bold text-terminal-text tabular-nums leading-none">{m.value}</div>
              <div className={`text-[11px] font-semibold mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
            </div>
          ))}
        </div>
      )}

      {/* Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        {/* Left — Inbox */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] border-b border-[#f0eeea]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Inbox</span>
              <span className="text-[11px] text-terminal-muted">{bids.length} RFQs</span>
            </div>
            <div className="flex gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setFilterTab(t.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    filterTab === t.id
                      ? 'bg-[#1e3a5f] text-white'
                      : 'bg-[#f5f4f0] text-terminal-muted hover:bg-[#eeedea]'
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filteredBids.map((bid) => {
              const days = Math.ceil((new Date(bid.due_date) - new Date()) / 86400000);
              const isSelected = bid.id === selectedId;
              return (
                <div
                  key={bid.id}
                  onClick={() => setSelectedId(bid.id)}
                  className={`px-[18px] py-3 border-b border-[#f0eeea] cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#e8eef5]' : 'hover:bg-[#f5f4f0]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-medium text-terminal-text truncate flex-1 mr-2">{bid.gc_name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STATUS_BADGE[bid.status] || STATUS_BADGE.new}`}>
                      {bid.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-terminal-muted truncate mb-1">
                    {bid.subject.replace(/^(RFQ|ITB|RFP|Pricing Request|Budget Pricing|Budget Request|Quick Turn|Bid|Pre-Qual \+ RFQ|FYI):?\s*/i, '')}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${URGENCY_BADGE[bid.urgency]}`}>
                      {bid.urgency}
                    </span>
                    <span className="text-[10px] text-terminal-muted">
                      {days <= 0 ? 'Due today' : `${days}d left`}
                    </span>
                  </div>
                </div>
              );
            })}
            {filteredBids.length === 0 && (
              <div className="px-[18px] py-8 text-center text-terminal-muted text-sm">No bid requests</div>
            )}
          </div>
        </div>

        {/* Right — Estimate Preview */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          {selected ? (
            <>
              {/* Header — always visible */}
              <div className="px-[18px] py-[14px] border-b border-[#f0eeea]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-terminal-text">{selected.gc_name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${URGENCY_BADGE[selected.urgency]}`}>
                    Due {selected.due_date}
                  </span>
                </div>
                <div className="text-[13px] text-terminal-text">{selected.subject}</div>
                <div className="text-[11px] text-terminal-muted mt-1">{selected.from_name} &lt;{selected.from_email}&gt;</div>
              </div>

              {/* Workflow Stepper — shown when bidding */}
              {selected.status === 'bidding' && (
                <WorkflowStepper currentStep={selected.workflow_step || 1} />
              )}

              {/* ═══ Step 2: Document Organization ═══ */}
              {selected.status === 'bidding' && selected.workflow_step === 2 ? (
                <DocumentOrganizationPanel
                  bid={selected}
                  token={token}
                  onAdvance={handleWorkflowAdvance}
                />
              ) : selected.status === 'bidding' && selected.workflow_step === 4 ? (
                /* ═══ Step 4: Plan Analysis ═══ */
                <PlanAnalysisPanel
                  bid={selected}
                  token={token}
                  onAdvance={handleWorkflowAdvance}
                />
              ) : (
                /* ═══ Steps 0-1 (new/analyze), 3 (takeoff), 5+ (estimate/pricing) ═══ */
                <>
                  {/* Scope Summary */}
                  <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                    <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-2">Scope</div>
                    {(() => {
                      const scope = selected.scope || (selected.scope_json ? JSON.parse(selected.scope_json) : {});
                      const items = scope.items || [];
                      return items.length > 0 ? (
                        <ul className="space-y-1">
                          {items.map((item, i) => (
                            <li key={i} className="text-[12px] text-[#6b6b65] flex items-start gap-1.5">
                              <span className="text-terminal-muted mt-0.5">&bull;</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-[12px] text-terminal-muted">No scope details provided</div>
                      );
                    })()}
                  </div>

                  {/* Missing Info */}
                  {(() => {
                    const missing = selected.missing_info || (selected.missing_info_json ? JSON.parse(selected.missing_info_json) : []);
                    if (missing.length === 0) return null;
                    return (
                      <div className="px-[18px] py-3 border-b border-[#f0eeea] bg-amber-50/50">
                        <div className="text-[10px] font-bold text-terminal-amber uppercase tracking-[1px] mb-1">Missing Info</div>
                        {missing.map((m, i) => (
                          <div key={i} className="text-[12px] text-terminal-amber">{m}</div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Estimate / Line Items */}
                  {selectedEstimate ? (
                    <>
                      <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Estimate</div>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CONFIDENCE_BADGE[selectedEstimate.confidence] || CONFIDENCE_BADGE.medium}`}>
                            {selectedEstimate.confidence} confidence
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-[12px]">
                            <thead>
                              <tr className="border-b border-[#f0eeea]">
                                <th className="text-left py-1.5 font-semibold text-terminal-muted">Item</th>
                                <th className="text-right py-1.5 font-semibold text-terminal-muted w-16">Qty</th>
                                <th className="text-right py-1.5 font-semibold text-terminal-muted w-14">Unit</th>
                                <th className="text-right py-1.5 font-semibold text-terminal-muted w-20">Unit $</th>
                                <th className="text-right py-1.5 font-semibold text-terminal-muted w-24">Extended</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(selectedEstimate.line_items || (selectedEstimate.line_items_json ? JSON.parse(selectedEstimate.line_items_json) : [])).map((li, i) => (
                                <tr key={i} className="border-b border-[#f0eeea] last:border-b-0">
                                  <td className="py-1.5 text-[#6b6b65] truncate max-w-[200px]">{li.pricingItem || li.description}</td>
                                  <td className="py-1.5 text-right tabular-nums text-terminal-text">{li.quantity?.toLocaleString()}</td>
                                  <td className="py-1.5 text-right text-terminal-muted">{li.unit}</td>
                                  <td className="py-1.5 text-right tabular-nums text-terminal-text">${li.unitPrice?.toFixed(2)}</td>
                                  <td className="py-1.5 text-right tabular-nums font-medium text-terminal-text">${li.extended?.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Totals */}
                      <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                        <div className="space-y-1 text-[12px]">
                          <div className="flex justify-between"><span className="text-[#6b6b65]">Subtotal</span><span className="tabular-nums">${selectedEstimate.subtotal?.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span className="text-[#6b6b65]">Overhead ({selectedEstimate.overhead_pct}%)</span><span className="tabular-nums">${Math.round(selectedEstimate.subtotal * (selectedEstimate.overhead_pct / 100))?.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span className="text-[#6b6b65]">Profit ({selectedEstimate.profit_pct}%)</span><span className="tabular-nums">${Math.round((selectedEstimate.subtotal * (1 + selectedEstimate.overhead_pct / 100)) * (selectedEstimate.profit_pct / 100))?.toLocaleString()}</span></div>
                          <div className="flex justify-between"><span className="text-[#6b6b65]">Mobilization + Testing</span><span className="tabular-nums">${selectedEstimate.mobilization?.toLocaleString()}</span></div>
                          <div className="flex justify-between pt-2 border-t border-[#f0eeea] text-[14px] font-bold">
                            <span className="text-terminal-text">Total Bid</span>
                            <span className="text-[#1e3a5f] tabular-nums">${selectedEstimate.total_bid?.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="px-[18px] py-8 text-center">
                      <div className="text-sm text-terminal-muted mb-3">No estimate generated yet</div>
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-semibold hover:bg-[#2a4f7a] disabled:opacity-50 transition-colors"
                      >
                        {generating ? 'Generating...' : 'Generate Estimate'}
                      </button>
                    </div>
                  )}

                  {/* ITB Analysis Panel */}
                  {showAnalysis && itbAnalysis && (
                    <div className="px-[18px] py-3 border-b border-[#f0eeea] bg-blue-50/30">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-[1px]">ITB Analysis</div>
                        <button onClick={() => setShowAnalysis(false)} className="text-[10px] text-terminal-muted hover:text-terminal-text">Close</button>
                      </div>

                      {/* Bid Recommendation */}
                      {itbAnalysis.bid_recommendation && (
                        <div className={`mb-3 p-2.5 rounded-lg border ${
                          itbAnalysis.bid_recommendation.recommend === 'bid' ? 'bg-green-50 border-green-200' :
                          itbAnalysis.bid_recommendation.recommend === 'no-bid' ? 'bg-red-50 border-red-200' :
                          'bg-amber-50 border-amber-200'
                        }`}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[11px] font-bold uppercase ${
                              itbAnalysis.bid_recommendation.recommend === 'bid' ? 'text-green-700' :
                              itbAnalysis.bid_recommendation.recommend === 'no-bid' ? 'text-red-700' : 'text-amber-700'
                            }`}>
                              {itbAnalysis.bid_recommendation.recommend === 'bid' ? 'Recommend: BID' :
                               itbAnalysis.bid_recommendation.recommend === 'no-bid' ? 'Recommend: NO BID' :
                               'Recommend: CONDITIONAL'}
                            </span>
                            <span className="text-[10px] text-terminal-muted">({itbAnalysis.bid_recommendation.confidence} confidence)</span>
                          </div>
                          <div className="text-[11px] text-[#555]">{itbAnalysis.bid_recommendation.reasoning}</div>
                        </div>
                      )}

                      {/* Project Summary */}
                      {itbAnalysis.project_summary && (
                        <div className="mb-2">
                          <div className="text-[10px] font-semibold text-terminal-muted mb-1">Project</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                            {itbAnalysis.project_summary.name && <div><span className="text-terminal-muted">Name:</span> <span className="text-terminal-text font-medium">{itbAnalysis.project_summary.name}</span></div>}
                            {itbAnalysis.project_summary.location && <div><span className="text-terminal-muted">Location:</span> <span className="text-terminal-text">{itbAnalysis.project_summary.location}</span></div>}
                            {itbAnalysis.project_summary.project_type && <div><span className="text-terminal-muted">Type:</span> <span className="text-terminal-text capitalize">{itbAnalysis.project_summary.project_type}</span></div>}
                            {itbAnalysis.project_summary.pre_bid_meeting && <div><span className="text-terminal-muted">Pre-bid:</span> <span className="text-terminal-text">{itbAnalysis.project_summary.pre_bid_meeting}</span></div>}
                          </div>
                        </div>
                      )}

                      {/* Scope Analysis */}
                      {itbAnalysis.scope_analysis && (
                        <div className="mb-2">
                          <div className="text-[10px] font-semibold text-terminal-muted mb-1">Scope ({itbAnalysis.scope_analysis.complexity} complexity)</div>
                          <div className="flex flex-wrap gap-1 mb-1">
                            {(itbAnalysis.scope_analysis.csi_divisions || []).map((div, i) => (
                              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e3a5f]/10 text-[#1e3a5f] font-medium">{div}</span>
                            ))}
                          </div>
                          {itbAnalysis.scope_analysis.estimated_total_cy && (
                            <div className="text-[11px] text-terminal-text">Est. Volume: <span className="font-semibold">{itbAnalysis.scope_analysis.estimated_total_cy}</span></div>
                          )}
                        </div>
                      )}

                      {/* Compliance */}
                      {itbAnalysis.compliance_requirements && (
                        <div className="mb-2">
                          <div className="text-[10px] font-semibold text-terminal-muted mb-1">Compliance</div>
                          <div className="flex flex-wrap gap-1">
                            {itbAnalysis.compliance_requirements.dbe_required && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">DBE {itbAnalysis.compliance_requirements.dbe_percentage || ''}</span>}
                            {itbAnalysis.compliance_requirements.buy_america && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Buy America</span>}
                            {itbAnalysis.compliance_requirements.prevailing_wage && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Prevailing Wage</span>}
                            {itbAnalysis.compliance_requirements.night_work && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">Night Work</span>}
                            {itbAnalysis.compliance_requirements.prequalification_required && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">Pre-Qual Required</span>}
                          </div>
                        </div>
                      )}

                      {/* Missing Critical */}
                      {itbAnalysis.missing_critical?.length > 0 && (
                        <div className="mb-2">
                          <div className="text-[10px] font-semibold text-terminal-amber mb-1">Missing / Action Required</div>
                          {itbAnalysis.missing_critical.map((m, i) => (
                            <div key={i} className="text-[11px] text-[#555] mb-0.5">
                              <span className="text-amber-600 font-medium">{m.item}</span> &mdash; {m.action}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Risk Factors */}
                      {itbAnalysis.risk_factors?.length > 0 && (
                        <div className="mb-2">
                          <div className="text-[10px] font-semibold text-terminal-muted mb-1">Risks</div>
                          {itbAnalysis.risk_factors.map((r, i) => (
                            <div key={i} className="text-[11px] flex items-start gap-1.5 mb-0.5">
                              <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                                r.severity === 'high' ? 'bg-red-100 text-red-700' :
                                r.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                              }`}>{r.severity}</span>
                              <span className="text-[#555]">{r.risk}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Next Steps */}
                      {itbAnalysis.next_steps?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold text-terminal-muted mb-1">Next Steps</div>
                          {itbAnalysis.next_steps.map((s, i) => (
                            <div key={i} className="text-[11px] text-[#555] flex items-start gap-1.5 mb-0.5">
                              <span className="text-[#1e3a5f] font-bold">{i + 1}.</span>
                              <span>{s.step}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Bid / Pass Decision Buttons */}
                  {selected.status === 'new' && (showAnalysis || itbAnalysis) && (
                    <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                      <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-2">Decision</div>
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => handleBidDecision('bid')}
                          disabled={bidDecisionLoading}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg text-[12px] font-bold hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                          {bidDecisionLoading ? '...' : 'Bid on This'}
                        </button>
                        {!showPassReason ? (
                          <button
                            onClick={() => setShowPassReason(true)}
                            disabled={bidDecisionLoading}
                            className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-[12px] font-bold hover:bg-gray-200 border border-gray-300 disabled:opacity-50 transition-colors"
                          >
                            Pass
                          </button>
                        ) : (
                          <div className="flex-1 flex items-center gap-2">
                            <input
                              type="text"
                              value={passReason}
                              onChange={(e) => setPassReason(e.target.value)}
                              placeholder="Reason (optional)"
                              className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-[12px] text-terminal-text bg-white focus:outline-none focus:border-[#1e3a5f]"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === 'Enter') handleBidDecision('pass', passReason); if (e.key === 'Escape') setShowPassReason(false); }}
                            />
                            <button
                              onClick={() => handleBidDecision('pass', passReason)}
                              disabled={bidDecisionLoading}
                              className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-[12px] font-bold hover:bg-red-600 disabled:opacity-50 transition-colors"
                            >
                              Confirm Pass
                            </button>
                            <button
                              onClick={() => { setShowPassReason(false); setPassReason(''); }}
                              className="text-[11px] text-terminal-muted hover:text-terminal-text"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Passed banner */}
                  {selected.status === 'passed' && (
                    <div className="px-[18px] py-3 border-b border-[#f0eeea] bg-gray-50">
                      <div className="text-[11px] font-bold text-gray-500 uppercase tracking-[1px]">Passed</div>
                      {selected.pass_reason && <div className="text-[11px] text-gray-400 mt-0.5">{selected.pass_reason}</div>}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="px-[18px] py-3 flex gap-2 flex-wrap">
                    <button
                      onClick={handleAnalyzeItb}
                      disabled={analyzing}
                      className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a] disabled:opacity-50 transition-colors"
                    >
                      {analyzing ? 'Analyzing...' : showAnalysis ? 'Re-Analyze' : 'Analyze ITB'}
                    </button>
                    {!selectedEstimate && selected.status !== 'passed' && (
                      <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="px-3 py-1.5 bg-terminal-panel border border-[#1e3a5f] text-[#1e3a5f] rounded-lg text-[12px] font-semibold hover:bg-[#e8eef5] disabled:opacity-50"
                      >
                        {generating ? 'Generating...' : 'Generate Estimate'}
                      </button>
                    )}
                    {selectedEstimate && (
                      <>
                        <button onClick={() => alert('Opening estimate editor...')} className="px-3 py-1.5 bg-terminal-panel border border-terminal-border rounded-lg text-[12px] font-semibold text-terminal-text hover:bg-[#f5f4f0]">
                          Edit
                        </button>
                        <button
                          onClick={handleSanityCheck}
                          disabled={checkingBid}
                          className="px-3 py-1.5 bg-terminal-panel border border-terminal-border rounded-lg text-[12px] font-semibold text-terminal-text hover:bg-[#f5f4f0] disabled:opacity-50"
                        >
                          {checkingBid ? 'Checking...' : 'Sanity Check'}
                        </button>
                        <button onClick={() => alert('Quote sent to GC.')} className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a]">
                          Send Quote
                        </button>
                      </>
                    )}
                  </div>

                  {/* Document Generation Toolbar */}
                  <div className="px-[18px] py-2 border-t border-[#f0eeea] flex gap-2 flex-wrap">
                    <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] self-center mr-1">Generate</span>
                    <button
                      onClick={() => handleGenerateDoc('takeoff')}
                      disabled={generatingDoc === 'takeoff'}
                      className="px-2.5 py-1 bg-[#f5f4f0] border border-terminal-border rounded text-[11px] font-medium text-[#555] hover:bg-[#eeedea] disabled:opacity-50"
                    >
                      {generatingDoc === 'takeoff' ? '...' : 'Takeoff Template'}
                    </button>
                    <button
                      onClick={() => handleGenerateDoc('compliance')}
                      disabled={generatingDoc === 'compliance'}
                      className="px-2.5 py-1 bg-[#f5f4f0] border border-terminal-border rounded text-[11px] font-medium text-[#555] hover:bg-[#eeedea] disabled:opacity-50"
                    >
                      {generatingDoc === 'compliance' ? '...' : 'Compliance Forms'}
                    </button>
                    {selectedEstimate && (
                      <button
                        onClick={() => handleGenerateDoc('proposal')}
                        disabled={generatingDoc === 'proposal'}
                        className="px-2.5 py-1 bg-[#f5f4f0] border border-terminal-border rounded text-[11px] font-medium text-[#555] hover:bg-[#eeedea] disabled:opacity-50"
                      >
                        {generatingDoc === 'proposal' ? '...' : 'Proposal Doc'}
                      </button>
                    )}
                  </div>

                  {/* Bid Sanity Check Results */}
                  {sanityResult && (
                    <div className="px-[18px] py-3 border-t border-[#f0eeea]">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Sanity Check</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          sanityResult.verdict === 'pass' ? 'bg-green-100 text-green-700' :
                          sanityResult.verdict === 'warn' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>{sanityResult.verdict?.toUpperCase()}</span>
                      </div>
                      <div className="space-y-1">
                        {sanityResult.checks?.map((c, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                              c.status === 'pass' ? 'bg-green-100 text-green-700' :
                              c.status === 'warn' ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>
                              {c.status === 'pass' ? '\u2713' : c.status === 'warn' ? '!' : '\u2717'}
                            </span>
                            <span className="text-[#333] font-medium">{c.label}</span>
                            <span className="text-terminal-muted">{c.detail}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-24 text-terminal-muted text-sm">
              Select a bid request to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
