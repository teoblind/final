import React, { useState, useMemo } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 6c: Worker Fleet Status
 * Detailed worker-level view with sorting, filtering, pagination.
 * Cross-references with curtailment schedule for OFF workers.
 */
const PAGE_SIZE = 50;

export default function WorkerFleetPanel() {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('hashrate');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/pools/workers', {
    refreshInterval: 60 * 1000,
  });

  const workers = data?.workers || [];
  const summary = data?.summary;

  // Filter and sort workers
  const filteredWorkers = useMemo(() => {
    let list = [...workers];

    // Text search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(w => w.name?.toLowerCase().includes(q) || w.id?.toLowerCase().includes(q));
    }

    // Status filter
    if (filter !== 'all') {
      list = list.filter(w => w.status === filter);
    }

    // Sort
    list.sort((a, b) => {
      switch (sort) {
        case 'hashrate': return (b.hashrate || 0) - (a.hashrate || 0);
        case 'name': return (a.name || '').localeCompare(b.name || '');
        case 'reject': return (b.rejectRate || 0) - (a.rejectRate || 0);
        case 'lastShare': return new Date(b.lastShare || 0) - new Date(a.lastShare || 0);
        default: return 0;
      }
    });

    return list;
  }, [workers, filter, sort, search]);

  const totalPages = Math.ceil(filteredWorkers.length / PAGE_SIZE);
  const pageWorkers = filteredWorkers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const statusIcon = (status) => {
    switch (status) {
      case 'active': return { icon: '\u25CF', color: 'text-terminal-green', label: 'ON' };
      case 'slow': return { icon: '\u26A0', color: 'text-terminal-amber', label: 'SLOW' };
      case 'inactive': return { icon: '\u25CB', color: 'text-terminal-muted', label: 'OFF' };
      case 'dead': return { icon: '\u2715', color: 'text-terminal-red', label: 'DEAD' };
      default: return { icon: '?', color: 'text-terminal-muted', label: status };
    }
  };

  if (data && !data.configured) {
    return (
      <Panel title="Worker Fleet" source="—" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Connect your pool to see worker details.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Worker Fleet"
      source={data?.pool || 'Mining Pools'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      <div className="space-y-3">
        {/* Summary Bar */}
        {summary && (
          <div className="flex items-center gap-3 text-xs flex-wrap">
            <span className="text-terminal-green">{summary.active} ON</span>
            <span className="text-terminal-amber">{summary.slow} SLOW</span>
            <span className="text-terminal-red">{summary.dead} DEAD</span>
            <span className="text-terminal-muted">{summary.inactive} OFF</span>
            {summary.curtailmentMatch !== undefined && (
              <span className={`ml-auto ${summary.curtailmentMatch ? 'text-terminal-green' : 'text-terminal-red'}`}>
                OFF workers match curtailment: {summary.curtailmentMatch ? 'Yes' : 'No'}
              </span>
            )}
          </div>
        )}

        {/* Filter / Sort / Search Row */}
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filter}
            onChange={e => { setFilter(e.target.value); setPage(0); }}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="slow">Slow</option>
            <option value="inactive">Offline</option>
            <option value="dead">Dead</option>
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text"
          >
            <option value="hashrate">Sort: Hashrate</option>
            <option value="name">Sort: Name</option>
            <option value="reject">Sort: Reject Rate</option>
            <option value="lastShare">Sort: Last Share</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search workers..."
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text flex-1 min-w-[120px]"
          />
          <span className="text-[10px] text-terminal-muted">{filteredWorkers.length} workers</span>
        </div>

        {/* Worker Table */}
        <div className="overflow-x-auto">
          {/* Header */}
          <div className="grid grid-cols-[1fr_80px_50px_60px_70px] gap-2 px-2 py-1 text-[10px] text-terminal-muted border-b border-terminal-border">
            <div>WORKER</div>
            <div className="text-right">HASHRATE</div>
            <div className="text-center">STATUS</div>
            <div className="text-right">REJECT</div>
            <div className="text-right">LAST</div>
          </div>

          {/* Rows */}
          <div className="max-h-[400px] overflow-y-auto">
            {pageWorkers.map((w, i) => {
              const si = statusIcon(w.status);
              const timeSince = w.lastShare ? getTimeSince(w.lastShare) : '—';
              return (
                <div
                  key={i}
                  className={`grid grid-cols-[1fr_80px_50px_60px_70px] gap-2 px-2 py-1.5 text-xs border-b border-terminal-border/30 ${
                    w.status === 'dead' ? 'opacity-40' : w.status === 'inactive' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="text-terminal-text truncate" title={w.name}>{w.name}</div>
                  <div className="text-right text-terminal-text font-mono">
                    {w.hashrate > 0 ? `${formatNumber(w.hashrate, 0)} TH/s` : '—'}
                  </div>
                  <div className={`text-center ${si.color}`}>{si.icon} {si.label}</div>
                  <div className={`text-right ${(w.rejectRate || 0) > 2 ? 'text-terminal-red' : 'text-terminal-muted'}`}>
                    {w.rejectRate !== undefined ? `${formatNumber(w.rejectRate, 1)}%` : '—'}
                  </div>
                  <div className="text-right text-terminal-muted">{timeSince}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-xs">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded bg-terminal-bg border border-terminal-border text-terminal-text disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-terminal-muted">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-2 py-1 rounded bg-terminal-bg border border-terminal-border text-terminal-text disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function getTimeSince(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
