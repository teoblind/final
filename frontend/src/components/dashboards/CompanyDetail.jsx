import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, Mail, FolderOpen, Plus, ExternalLink,
  Send, Inbox, FileText, Clock, RefreshCw,
} from 'lucide-react';
import api from '../../lib/hooks/useApi';

const STATUS_COLORS = {
  active: { bg: '#4a7a4a', text: '#a8d8a8' },
  pilot: { bg: '#7a6a3a', text: '#d8cca0' },
  partner: { bg: '#3a5a7a', text: '#a0c0d8' },
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
        padding: '3px 12px',
        borderRadius: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function StatCard({ label, value, icon: Icon, sublabel }) {
  return (
    <div
      style={{
        background: '#1a1a1a',
        border: '1px solid #222',
        borderRadius: 10,
        padding: 18,
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {Icon && <Icon size={14} color="#555" />}
        <span style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#d8d4cc' }}>{value}</div>
      {sublabel && (
        <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 4 }}>{sublabel}</div>
      )}
    </div>
  );
}

function ConnectBox({ icon: Icon, title, description, buttonText, onClick }) {
  return (
    <div
      style={{
        border: '2px dashed #2a2a2a',
        borderRadius: 10,
        padding: 24,
        textAlign: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onClick={onClick}
      onMouseOver={e => (e.currentTarget.style.borderColor = '#444')}
      onMouseOut={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
    >
      <Icon size={28} color="#555" style={{ marginBottom: 10 }} />
      <div style={{ fontSize: 14, fontWeight: 600, color: '#d8d4cc', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 14 }}>{description}</div>
      <button
        style={{
          padding: '7px 18px',
          background: '#252525',
          border: '1px solid #333',
          borderRadius: 8,
          color: '#d8d4cc',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Plus size={13} />
        {buttonText}
      </button>
    </div>
  );
}

function EmailPanel({ emails, loading }) {
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>
        Loading emails...
      </div>
    );
  }

  if (!emails || emails.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#3a3a3a', fontSize: 13 }}>
        No recent emails
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 400, overflow: 'auto' }}>
      {emails.map(email => {
        const fromMatch = email.from?.match(/^"?([^"<]+)"?\s*<?/) || [null, email.from];
        const senderName = fromMatch[1]?.trim() || email.from;
        const isInbox = email.labelIds?.includes('INBOX');

        return (
          <div
            key={email.id}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #222',
              cursor: 'pointer',
              transition: 'background 0.1s',
            }}
            onMouseOver={e => (e.currentTarget.style.background = '#1f1f1f')}
            onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {isInbox ? <Inbox size={12} color="#3a5a7a" /> : <Send size={12} color="#4a7a4a" />}
              <span style={{ fontSize: 12, fontWeight: 600, color: '#d8d4cc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {senderName}
              </span>
              <span style={{ fontSize: 10, color: '#3a3a3a', whiteSpace: 'nowrap' }}>
                {email.date ? new Date(email.date).toLocaleDateString() : ''}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email.subject}
            </div>
            <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email.snippet}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FilesPanel({ files, loading }) {
  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 13 }}>
        Loading files...
      </div>
    );
  }

  if (!files || files.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: '#3a3a3a', fontSize: 13 }}>
        No files found
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 400, overflow: 'auto' }}>
      {files.map(file => (
        <a
          key={file.id}
          href={file.webViewLink}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderBottom: '1px solid #222',
            textDecoration: 'none',
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#1f1f1f')}
          onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
        >
          <FileText size={14} color="#555" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#d8d4cc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {file.name}
            </div>
            <div style={{ fontSize: 10, color: '#3a3a3a', marginTop: 2 }}>
              {file.folderName && <span>{file.folderName} &middot; </span>}
              {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ''}
            </div>
          </div>
          <ExternalLink size={12} color="#555" />
        </a>
      ))}
    </div>
  );
}

function ConnectGmailModal({ companyId, onClose, onSuccess }) {
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!address.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/v1/portfolio/companies/${companyId}/connect-gmail`, {
        gmail_address: address.trim(),
        refresh_token: token.trim() || null,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Connect Gmail error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 14, padding: 28, width: 420, maxWidth: '90vw' }}
      >
        <h3 style={{ color: '#d8d4cc', fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Connect Gmail Account</h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 6 }}>Gmail Address *</label>
          <input
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="hello@company.com"
            autoFocus
            style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', color: '#d8d4cc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 6 }}>OAuth Refresh Token (optional)</label>
          <input
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste refresh token..."
            style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', color: '#d8d4cc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
          <div style={{ fontSize: 11, color: '#3a3a3a', marginTop: 4 }}>Required to fetch emails. Use Google OAuth integration to obtain one.</div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={!address.trim() || submitting} style={{ padding: '8px 18px', background: address.trim() ? '#d8d4cc' : '#333', border: 'none', borderRadius: 8, color: address.trim() ? '#141414' : '#555', fontSize: 13, fontWeight: 600, cursor: address.trim() ? 'pointer' : 'default' }}>
            {submitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ConnectDriveModal({ companyId, onClose, onSuccess }) {
  const [folderId, setFolderId] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderUrl, setFolderUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!folderId.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/v1/portfolio/companies/${companyId}/connect-drive`, {
        folder_id: folderId.trim(),
        folder_name: folderName.trim() || null,
        folder_url: folderUrl.trim() || null,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Connect Drive error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 14, padding: 28, width: 420, maxWidth: '90vw' }}
      >
        <h3 style={{ color: '#d8d4cc', fontSize: 16, fontWeight: 600, marginBottom: 20 }}>Connect Drive Folder</h3>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 6 }}>Google Drive Folder ID *</label>
          <input
            value={folderId}
            onChange={e => setFolderId(e.target.value)}
            placeholder="e.g. 1abc123..."
            autoFocus
            style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', color: '#d8d4cc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 6 }}>Folder Name</label>
          <input
            value={folderName}
            onChange={e => setFolderName(e.target.value)}
            placeholder="e.g. Shared Docs"
            style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', color: '#d8d4cc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, color: '#555', marginBottom: 6 }}>Folder URL</label>
          <input
            value={folderUrl}
            onChange={e => setFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            style={{ width: '100%', background: '#141414', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', color: '#d8d4cc', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', background: 'transparent', border: '1px solid #333', borderRadius: 8, color: '#888', fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button type="submit" disabled={!folderId.trim() || submitting} style={{ padding: '8px 18px', background: folderId.trim() ? '#d8d4cc' : '#333', border: 'none', borderRadius: 8, color: folderId.trim() ? '#141414' : '#555', fontSize: 13, fontWeight: 600, cursor: folderId.trim() ? 'pointer' : 'default' }}>
            {submitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CompanyDetail({ companyId, onBack }) {
  const [company, setCompany] = useState(null);
  const [emails, setEmails] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [showConnectGmail, setShowConnectGmail] = useState(false);
  const [showConnectDrive, setShowConnectDrive] = useState(false);

  const fetchCompany = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/v1/portfolio/companies/${companyId}`);
      setCompany(res.data.company);
    } catch (err) {
      console.error('Company fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchEmails = async () => {
    setEmailsLoading(true);
    try {
      const res = await api.get(`/v1/portfolio/companies/${companyId}/emails`);
      setEmails(res.data.emails || []);
    } catch (err) {
      console.error('Emails fetch error:', err);
    } finally {
      setEmailsLoading(false);
    }
  };

  const fetchFiles = async () => {
    setFilesLoading(true);
    try {
      const res = await api.get(`/v1/portfolio/companies/${companyId}/files`);
      setFiles(res.data.files || []);
    } catch (err) {
      console.error('Files fetch error:', err);
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    fetchCompany();
  }, [companyId]);

  useEffect(() => {
    if (!company) return;
    if (company.email_accounts?.length > 0) fetchEmails();
    if (company.drive_folders?.length > 0) fetchFiles();
  }, [company]);

  if (loading || !company) {
    return (
      <div style={{ background: '#141414', minHeight: '100vh', padding: 32, textAlign: 'center', paddingTop: 100 }}>
        <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 12px' }} />
        <p style={{ fontSize: 13, color: '#555' }}>Loading company...</p>
      </div>
    );
  }

  const initials = company.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const hasEmailAccounts = company.email_accounts?.length > 0;
  const hasDriveFolders = company.drive_folders?.length > 0;

  // Compute stats
  const emailStats = company.email_stats || [];
  const totalSent = emailStats.reduce((s, e) => s + e.sent_count, 0);
  const totalReceived = emailStats.reduce((s, e) => s + e.received_count, 0);
  const connectedAccounts = (company.email_accounts || []).filter(a => a.oauth_refresh_token).length;

  return (
    <div style={{ background: '#141414', minHeight: '100vh', padding: 32 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: '#555',
            fontSize: 13,
            cursor: 'pointer',
            padding: 0,
            marginBottom: 24,
          }}
        >
          <ArrowLeft size={14} />
          Back to Portfolio
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#252525',
              border: '1px solid #333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              fontWeight: 700,
              color: '#888',
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#d8d4cc', margin: 0 }}>{company.name}</h1>
              <StatusBadge status={company.status} />
            </div>
            <div style={{ fontSize: 13, color: '#555', marginTop: 4 }}>
              {company.type}
              {company.description && <span> &middot; {company.description}</span>}
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
          <StatCard label="Email Accounts" value={connectedAccounts} icon={Mail} sublabel={`${(company.email_accounts || []).length} total`} />
          <StatCard label="Sent (30d)" value={totalSent} icon={Send} />
          <StatCard label="Received (30d)" value={totalReceived} icon={Inbox} />
          <StatCard label="Drive Folders" value={(company.drive_folders || []).length} icon={FolderOpen} />
        </div>

        {/* Two-column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Email panel */}
          <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Mail size={14} color="#555" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#d8d4cc' }}>Email Inbox</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {hasEmailAccounts && (
                  <button
                    onClick={fetchEmails}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}
                    title="Refresh emails"
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
                <button
                  onClick={() => setShowConnectGmail(true)}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}
                  title="Connect Gmail"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {hasEmailAccounts ? (
              <>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid #1f1f1f' }}>
                  {company.email_accounts.map(a => (
                    <div key={a.id} style={{ fontSize: 11, color: a.oauth_refresh_token ? '#4a7a4a' : '#7a6a3a', padding: '2px 0' }}>
                      {a.gmail_address} {a.oauth_refresh_token ? '(connected)' : '(no token)'}
                    </div>
                  ))}
                </div>
                <EmailPanel emails={emails} loading={emailsLoading} />
              </>
            ) : (
              <ConnectBox
                icon={Mail}
                title="Connect Gmail"
                description="Link a Gmail account to monitor email activity"
                buttonText="Connect Account"
                onClick={() => setShowConnectGmail(true)}
              />
            )}
          </div>

          {/* Drive panel */}
          <div style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FolderOpen size={14} color="#555" />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#d8d4cc' }}>Drive Folder</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {hasDriveFolders && (
                  <button
                    onClick={fetchFiles}
                    style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}
                    title="Refresh files"
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
                <button
                  onClick={() => setShowConnectDrive(true)}
                  style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 4 }}
                  title="Connect Drive folder"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {hasDriveFolders ? (
              <>
                <div style={{ padding: '8px 16px', borderBottom: '1px solid #1f1f1f' }}>
                  {company.drive_folders.map(f => (
                    <div key={f.id} style={{ fontSize: 11, color: '#4a7a4a', padding: '2px 0' }}>
                      {f.folder_name || f.folder_id}
                      {f.folder_url && (
                        <a href={f.folder_url} target="_blank" rel="noopener noreferrer" style={{ color: '#555', marginLeft: 6 }}>
                          <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
                <FilesPanel files={files} loading={filesLoading} />
              </>
            ) : (
              <ConnectBox
                icon={FolderOpen}
                title="Connect Drive Folder"
                description="Link a Google Drive folder to browse shared files"
                buttonText="Connect Folder"
                onClick={() => setShowConnectDrive(true)}
              />
            )}
          </div>
        </div>

        {/* Activity feed / email stats chart */}
        {emailStats.length > 0 && (
          <div style={{ marginTop: 16, background: '#1a1a1a', border: '1px solid #222', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Clock size={14} color="#555" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#d8d4cc' }}>Email Activity (30d)</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {emailStats.slice(0, 14).reverse().map(stat => (
                <div key={stat.date} style={{ textAlign: 'center', flex: 1, minWidth: 40 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
                    <div
                      style={{
                        width: 8,
                        height: Math.max(4, (stat.sent_count + stat.received_count) * 3),
                        background: '#4a7a4a',
                        borderRadius: 2,
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 9, color: '#3a3a3a', marginTop: 4 }}>
                    {stat.date.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showConnectGmail && (
        <ConnectGmailModal
          companyId={companyId}
          onClose={() => setShowConnectGmail(false)}
          onSuccess={fetchCompany}
        />
      )}
      {showConnectDrive && (
        <ConnectDriveModal
          companyId={companyId}
          onClose={() => setShowConnectDrive(false)}
          onSuccess={fetchCompany}
        />
      )}
    </div>
  );
}
