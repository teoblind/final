import React, { useState, useEffect } from 'react';
import { Plus, Mail, FolderOpen, ArrowRight, Building2 } from 'lucide-react';
import api from '../../lib/hooks/useApi';

const STATUS_COLORS = {
  active: { bg: '#e8f5ee', text: '#2a7a4a' },
  pilot: { bg: '#fdf6e8', text: '#8a6a20' },
  partner: { bg: '#e8eef5', text: '#2c5282' },
};

function StatusBadge({ status }) {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.active;
  return (
    <span
      style={{
        background: colors.bg,
        color: colors.text,
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 10px',
        borderRadius: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function CompanyCard({ company, onClick }) {
  const initials = company.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <button
      onClick={onClick}
      style={{
        background: '#ffffff',
        border: '1px solid #e8e6e1',
        borderRadius: 12,
        padding: 24,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        width: '100%',
      }}
      onMouseOver={e => (e.currentTarget.style.borderColor = '#ccc')}
      onMouseOut={e => (e.currentTarget.style.borderColor = '#e8e6e1')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: '#f5f4f0',
            border: '1px solid #e8e6e1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            fontWeight: 700,
            color: '#888',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{company.name}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{company.type}</div>
        </div>
        <StatusBadge status={company.status} />
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#888' }}>
          <Mail size={13} />
          <span>{company.email_accounts || 0} account{company.email_accounts !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#888' }}>
          <FolderOpen size={13} />
          <span>{company.drive_folders || 0} folder{company.drive_folders !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {(company.emails_sent_7d > 0 || company.emails_received_7d > 0) && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid #e8e6e1',
            display: 'flex',
            gap: 20,
            fontSize: 12,
          }}
        >
          <div>
            <span style={{ color: '#888' }}>Sent (7d) </span>
            <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{company.emails_sent_7d}</span>
          </div>
          <div>
            <span style={{ color: '#888' }}>Received (7d) </span>
            <span style={{ color: '#1a1a1a', fontWeight: 600 }}>{company.emails_received_7d}</span>
          </div>
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: '#888',
        }}
      >
        <span>View details</span>
        <ArrowRight size={12} />
      </div>
    </button>
  );
}

function AddCompanyCard({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: '2px dashed #d8d6d0',
        borderRadius: 12,
        padding: 24,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 180,
        transition: 'border-color 0.15s',
        width: '100%',
      }}
      onMouseOver={e => (e.currentTarget.style.borderColor = '#aaa')}
      onMouseOut={e => (e.currentTarget.style.borderColor = '#d8d6d0')}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: '#f5f4f0',
          border: '1px solid #e8e6e1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <Plus size={20} color="#aaa" />
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#aaa' }}>Add Company</div>
    </button>
  );
}

function AddCompanyModal({ onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), type: type.trim(), description: description.trim() });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: '#ffffff',
          border: '1px solid #e8e6e1',
          borderRadius: 14,
          padding: 28,
          width: 420,
          maxWidth: '90vw',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
      >
        <h3 style={{ color: '#1a1a1a', fontSize: 16, fontWeight: 600, marginBottom: 20 }}>
          Add Portfolio Company
        </h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>
            Company Name *
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Acme Corp"
            autoFocus
            style={{
              width: '100%',
              background: '#fafaf8',
              border: '1px solid #e8e6e1',
              borderRadius: 8,
              padding: '10px 12px',
              color: '#1a1a1a',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>
            Type
          </label>
          <input
            value={type}
            onChange={e => setType(e.target.value)}
            placeholder="e.g. AI SaaS, EV Infrastructure"
            style={{
              width: '100%',
              background: '#fafaf8',
              border: '1px solid #e8e6e1',
              borderRadius: 8,
              padding: '10px 12px',
              color: '#1a1a1a',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Brief description..."
            rows={3}
            style={{
              width: '100%',
              background: '#fafaf8',
              border: '1px solid #e8e6e1',
              borderRadius: 8,
              padding: '10px 12px',
              color: '#1a1a1a',
              fontSize: 13,
              outline: 'none',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              border: '1px solid #e8e6e1',
              borderRadius: 8,
              color: '#888',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            style={{
              padding: '8px 18px',
              background: name.trim() ? '#1a1a1a' : '#e8e6e1',
              border: 'none',
              borderRadius: 8,
              color: name.trim() ? '#fff' : '#aaa',
              fontSize: 13,
              fontWeight: 600,
              cursor: name.trim() ? 'pointer' : 'default',
            }}
          >
            Add Company
          </button>
        </div>
      </form>
    </div>
  );
}

export default function PortfolioOverview({ onSelectCompany }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAdd, setShowAdd] = useState(false);

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const res = await api.get('/v1/portfolio/companies');
      setCompanies(res.data.companies || []);
      setError(null);
    } catch (err) {
      console.error('Portfolio fetch error:', err);
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const handleAddCompany = async (data) => {
    try {
      await api.post('/v1/portfolio/companies', data);
      setShowAdd(false);
      fetchCompanies();
    } catch (err) {
      console.error('Add company error:', err);
    }
  };

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Subheader */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <p style={{ fontSize: 13, color: '#888', margin: 0 }}>
            {companies.length} compan{companies.length !== 1 ? 'ies' : 'y'} in portfolio
          </p>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
            <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 12px' }} />
            <p style={{ fontSize: 13 }}>Loading portfolio...</p>
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>
            <p style={{ fontSize: 13 }}>Error: {error}</p>
            <button
              onClick={fetchCompanies}
              style={{
                marginTop: 12,
                padding: '6px 16px',
                background: '#f5f4f0',
                border: '1px solid #e8e6e1',
                borderRadius: 8,
                color: '#888',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: 16,
            }}
          >
            {companies.map(company => (
              <CompanyCard
                key={company.id}
                company={company}
                onClick={() => onSelectCompany?.(company.id)}
              />
            ))}
            <AddCompanyCard onClick={() => setShowAdd(true)} />
          </div>
        )}
      </div>

      {showAdd && (
        <AddCompanyModal
          onClose={() => setShowAdd(false)}
          onSubmit={handleAddCompany}
        />
      )}
    </div>
  );
}
