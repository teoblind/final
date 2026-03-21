import React, { useState } from 'react';
import { useApi } from '../../../hooks/useApi';
import { Card } from './shared';

export default function ContactsTab() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debounceTimer, setDebounceTimer] = useState(null);

  const handleSearch = (val) => {
    setSearch(val);
    if (debounceTimer) clearTimeout(debounceTimer);
    setDebounceTimer(setTimeout(() => setDebouncedSearch(val), 300));
  };

  const queryParam = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : '';
  const { data } = useApi(`/lead-engine/contacts${queryParam}`, { refreshInterval: 30000 });
  const contacts = data?.contacts || [];

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      <Card title="Contact Directory" meta={`${contacts.length} contacts`}>
        <div className="flex items-center gap-[10px] px-[18px] py-3 border-b border-[#f0eeea]">
          <input
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="flex-1 px-[14px] py-2 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-ui-accent focus:bg-white transition-colors placeholder:text-[#c5c5bc]"
            placeholder="Search by name, email, title, company..."
          />
          <span className="text-[11px] text-terminal-muted whitespace-nowrap">{contacts.length} results</span>
        </div>
        <div
          className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
          style={{ gridTemplateColumns: '2fr 2fr 1.5fr 1fr 1fr 80px' }}
        >
          <div>Name</div><div>Email</div><div>Title</div><div>Company</div><div>Region</div><div>Verified</div>
        </div>
        {contacts.length === 0 && (
          <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">
            {search ? 'No contacts match your search.' : 'No contacts yet'}
          </div>
        )}
        {contacts.map((c, i) => (
          <div
            key={c.id || i}
            className="grid px-[18px] py-[12px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors"
            style={{ gridTemplateColumns: '2fr 2fr 1.5fr 1fr 1fr 80px' }}
          >
            <div>
              <div className="font-semibold text-terminal-text">{c.name || '—'}</div>
              {c.phone && <div className="text-[11px] text-[#9a9a92]">{c.phone}</div>}
            </div>
            <div className="text-xs text-[#6b6b65] truncate">{c.email || '—'}</div>
            <div className="text-xs text-[#6b6b65]">{c.title || '—'}</div>
            <div className="text-xs text-[#6b6b65]">{c.venue_name || '—'}</div>
            <div className="text-xs text-[#6b6b65]">{c.region || '—'}</div>
            <div>
              {c.mx_valid ? (
                <span className="text-[10px] font-semibold px-[9px] py-[3px] rounded-md bg-ui-accent-light text-ui-accent">Valid</span>
              ) : (
                <span className="text-[10px] font-semibold px-[9px] py-[3px] rounded-md bg-[#f5f4f0] text-[#9a9a92]">—</span>
              )}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
