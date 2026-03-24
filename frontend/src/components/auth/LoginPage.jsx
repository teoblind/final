import React, { useState, useEffect, useRef } from 'react';
import { useTenant } from '../../contexts/TenantContext';
import CoppiceLogo from '../ui/CoppiceLogo';

export default function LoginPage({ onLogin }) {
  const { tenant } = useTenant();
  const [mode, setMode] = useState('login');
  const prefillEmail = new URLSearchParams(window.location.search).get('email') || '';
  const isAdminSubdomain = window.location.hostname.startsWith('admin.');
  const isAdmin = isAdminSubdomain || new URLSearchParams(window.location.search).has('admin');
  const [email, setEmail] = useState(prefillEmail);
  const passwordRef = useRef(null);
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState(null);
  const [tenantPicker, setTenantPicker] = useState(null); // array of { id, slug, name }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      setInviteToken(invite);
      setMode('register');
    }
    const resetToken = params.get('reset_token');
    if (resetToken) {
      setMode('reset');
    }
  }, []);

  useEffect(() => {
    if (prefillEmail && passwordRef.current) {
      passwordRef.current.focus();
    }
  }, []);

  const handleSubmit = async (e, selectedTenantId) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // Forgot password flow
      if (mode === 'forgot') {
        const res = await fetch('/api/v1/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        setSuccess('If that email exists, a reset link has been sent. Check your inbox.');
        setLoading(false);
        return;
      }

      // Reset password flow
      if (mode === 'reset') {
        const resetToken = new URLSearchParams(window.location.search).get('reset_token');
        const res = await fetch('/api/v1/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, newPassword: password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Reset failed');
        setSuccess('Password has been reset. You can now sign in.');
        setMode('login');
        setPassword('');
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
        setLoading(false);
        return;
      }

      const endpoint = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
      // If a tenant was explicitly selected (from picker), pass it; otherwise let the backend resolve from hostname
      const body = mode === 'login'
        ? { email: email.trim(), password: password.trim(), ...(selectedTenantId ? { tenant_id: selectedTenantId } : {}) }
        : { email: email.trim(), password, name: fullName, companyName, ...(inviteToken ? { invitationToken: inviteToken } : {}) };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || 'Login failed');
      }

      // Multi-tenant: show tenant picker
      if (data.tenant_required && data.tenants) {
        setTenantPicker(data.tenants);
        setLoading(false);
        return;
      }

      // Redirect to correct tenant subdomain if needed
      const slug = data.user?.tenantSlug;
      if (slug && !isAdmin) {
        const baseDomain = 'coppice.ai';
        const expectedHost = `${slug}.${baseDomain}`;
        const currentHost = window.location.hostname;
        if (currentHost !== expectedHost && currentHost !== 'localhost') {
          const params = new URLSearchParams({
            access_token: data.tokens.accessToken,
            refresh_token: data.tokens.refreshToken,
            expires_at: data.tokens.expiresAt,
          });
          window.location.href = `https://${expectedHost}/?oauth=success&${params.toString()}`;
          return;
        }
      }

      // Clean query params from URL after successful login
      if (window.location.search) {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      }

      if (onLogin) {
        onLogin({ user: data.user, tokens: data.tokens, adminConsole: isAdmin });
      }
    } catch (err) {
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleTenantSelect = (tenantId) => {
    setTenantPicker(null);
    handleSubmit(null, tenantId);
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setSuccess(null);
  };

  // ─── Admin dark login ───────────────────────────────────────────────────
  if (isAdmin) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a09', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Instrument Sans', sans-serif", WebkitFontSmoothing: 'antialiased', position: 'relative', overflow: 'hidden',
      }}>
        {/* Grid */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />
        {/* Glows */}
        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.06, background: '#3b82f6', top: '-10%', right: '10%', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', filter: 'blur(120px)', opacity: 0.06, background: '#7c3aed', bottom: '-10%', left: '10%', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 2, width: '100%', maxWidth: 380, padding: 20 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 40 }}>
            <img src="/coppice-logo.png" alt="Coppice" style={{ width: 40, height: 40, borderRadius: 9, objectFit: 'cover' }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#9a9a92', letterSpacing: 2, textTransform: 'uppercase' }}>Coppice</span>
          </div>

          {/* Card */}
          <div style={{ background: '#161615', border: '1px solid #2a2a28', borderRadius: 18, padding: 32 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Admin Console</div>
            <div style={{ fontSize: 12, color: '#6b6b65', marginBottom: 24 }}>Platform management — authorized personnel only</div>

            {error && (
              <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(192,57,43,0.1)', color: '#e74c3c', fontSize: 12, border: '1px solid rgba(192,57,43,0.15)' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#9a9a92', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required placeholder="admin@coppice.ai" autoFocus={!prefillEmail}
                  style={darkInputStyle}
                  onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.08)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#2a2a28'; e.target.style.boxShadow = 'none'; }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && passwordRef.current) { e.preventDefault(); passwordRef.current.focus(); } }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: '#9a9a92', marginBottom: 6, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>Password</label>
                <input
                  ref={passwordRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required minLength={8} placeholder="••••••••"
                  style={darkInputStyle}
                  onFocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.08)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#2a2a28'; e.target.style.boxShadow = 'none'; }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b6b65', cursor: 'pointer' }}>
                  <input type="checkbox" defaultChecked style={{ width: 14, height: 14, accentColor: '#3b82f6', cursor: 'pointer' }} />
                  Stay signed in
                </label>
                <button type="button" style={{ fontSize: 11, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
                  Reset
                </button>
              </div>

              <button type="submit" disabled={loading} style={{
                width: '100%', padding: 12, borderRadius: 10, background: '#3b82f6',
                color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1, transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
              onMouseEnter={(e) => { if (!loading) e.target.style.background = '#2563eb'; }}
              onMouseLeave={(e) => { e.target.style.background = '#3b82f6'; }}
              >
                {loading && (
                  <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                )}
                Sign In
              </button>
            </form>

            {/* Status */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #2a2a28', display: 'flex', gap: 16, justifyContent: 'center' }}>
              {['Backend', 'Workspace', 'VPS', 'Cloudflare'].map((s) => (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#6b6b65' }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#2dd478' }} />
                  {s}
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: '#3a3a38' }}>
            <a href="https://coppice.ai" style={{ color: '#6b6b65', textDecoration: 'none' }}>coppice.ai</a>
            {' · '}
            <a href="https://dacp.coppice.ai" style={{ color: '#6b6b65', textDecoration: 'none' }}>DACP</a>
            {' · '}
            <a href="https://sangha.coppice.ai" style={{ color: '#6b6b65', textDecoration: 'none' }}>Sangha</a>
          </div>
        </div>

        {/* Version */}
        <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: '#3a3a38', fontFamily: "'JetBrains Mono', monospace" }}>
          v0.1.0 · March 2026
        </div>

        {/* Tenant Picker Modal (Admin) */}
        {tenantPicker && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}>
            <div style={{
              background: '#161615', border: '1px solid #2a2a28', borderRadius: 18, padding: 32,
              width: '100%', maxWidth: 400,
            }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Choose workspace</div>
              <div style={{ fontSize: 13, color: '#6b6b65', marginBottom: 24 }}>
                Your account belongs to multiple organizations.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {tenantPicker.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => handleTenantSelect(t.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
                      border: '1px solid #2a2a28', borderRadius: 14, background: '#1c1c1a',
                      cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
                      fontFamily: "'Instrument Sans', sans-serif",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.background = '#1e1e1c'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a28'; e.currentTarget.style.background = '#1c1c1a'; }}
                  >
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0,
                    }}>
                      {t.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{t.name}</div>
                      <div style={{ fontSize: 12, color: '#6b6b65' }}>{t.slug}.coppice.ai</div>
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setTenantPicker(null)}
                style={{
                  width: '100%', marginTop: 16, padding: 10, border: 'none', background: 'none',
                  color: '#6b6b65', fontSize: 13, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─── Tenant-branded login ───────────────────────────────────────────────
  const industry = tenant?.settings?.industry;
  const isConstruction = industry === 'construction';
  const isVenture = industry === 'venture';
  const brandName = tenant?.branding?.companyName || 'Coppice';
  const primaryColor = tenant?.branding?.primaryColor || (isConstruction ? '#1e3a5f' : isVenture ? '#141414' : '#1a6b3c');
  const accentColor = isConstruction ? '#93c5fd' : isVenture ? '#888' : '#6ee7b7';
  const glowColor1 = isConstruction ? '#3b82f6' : isVenture ? '#555' : '#34d399';
  const glowColor2 = isConstruction ? '#93c5fd' : isVenture ? '#888' : '#6ee7b7';

  const heroTitle = isConstruction
    ? <>Your AI estimator.<br /><em style={{ fontStyle: 'italic', color: accentColor }}>Always on.</em><br />Always learning.</>
    : isVenture
      ? <>Your portfolio,<br /><em style={{ fontStyle: 'italic', color: '#666' }}>always working.</em></>
      : <>AI-powered<br /><em style={{ fontStyle: 'italic', color: accentColor }}>infrastructure</em><br />intelligence.</>;

  const heroDesc = isConstruction
    ? 'Coppice reads your bid requests, generates estimates from your pricing table, drafts response emails, and tracks every job — 24 hours a day, 7 days a week.'
    : isVenture
      ? 'AI agents monitoring portfolio companies, managing LP relations, processing deal flow, and running fund operations — around the clock, without a full team.'
      : 'Real-time risk analytics, automated curtailment, pool routing optimization, and AI agents — powering the next generation of energy infrastructure.';

  const heroStats = isConstruction
    ? [{ val: '2 min', label: 'Per estimate' }, { val: '94%', label: 'Accuracy' }, { val: '$0.05', label: 'Per estimate' }]
    : isVenture
      ? [{ val: '24/7', label: 'Monitoring' }, { val: '3', label: 'Companies' }, { val: '<1s', label: 'Response time' }]
      : [{ val: '24/7', label: 'Monitoring' }, { val: '6', label: 'AI agents' }, { val: '<1s', label: 'Response time' }];

  const footerText = isConstruction ? '© 2026 Coppice · AI employees for construction' : isVenture ? '© 2026 Zhan Capital · Powered by Coppice' : '© 2026 Coppice · AI infrastructure platform';
  const placeholderEmail = isConstruction ? 'you@dacpconstruction.com' : isVenture ? 'you@zhan.capital' : 'you@company.com';

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Instrument Sans', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
      {/* LEFT — branded panel */}
      <div style={{
        flex: 1, background: primaryColor, position: 'relative',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: '36px 48px', overflow: 'hidden', minHeight: '100vh',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }} />

        <div style={{ position: 'absolute', width: 400, height: 400, borderRadius: '50%', filter: 'blur(80px)', opacity: 0.12, background: glowColor1, top: '-10%', right: '-5%' }} />
        <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', filter: 'blur(80px)', opacity: 0.12, background: glowColor2, bottom: '10%', left: '-5%' }} />
        <div style={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', filter: 'blur(80px)', opacity: 0.08, background: '#b8860b', top: '40%', right: '20%' }} />

        <a href="https://coppice.ai" target="_blank" rel="noopener noreferrer" style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', cursor: 'pointer' }}>
          <CoppiceLogo color={primaryColor} size={36} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: 2 }}>{brandName}</span>
        </a>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 style={{
            fontFamily: "'Newsreader', Georgia, serif",
            fontSize: 'clamp(32px, 3.5vw, 48px)', fontWeight: 400,
            color: '#fff', lineHeight: 1.2, marginBottom: 20,
          }}>
            {heroTitle}
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7, maxWidth: 380 }}>
            {heroDesc}
          </p>

          <div style={{ display: 'flex', gap: 32, marginTop: 36, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {heroStats.map((s) => (
              <div key={s.label + s.val}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 24, fontWeight: 700, color: '#fff' }}>{s.val}</div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>{footerText}</div>
        </div>
      </div>

      {/* RIGHT — login form */}
      <div style={{
        width: 480, minHeight: '100vh', background: '#fafaf8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 40, flexShrink: 0,
      }}>
        <div style={{ width: '100%', maxWidth: 360 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111110', marginBottom: 4 }}>
            {mode === 'forgot' ? 'Reset password' : mode === 'reset' ? 'Set new password' : mode === 'login' ? 'Sign in' : 'Create account'}
          </div>
          <div style={{ fontSize: 13, color: '#9a9a92', marginBottom: 28 }}>
            {mode === 'forgot' ? 'Enter your email to receive a reset link' : mode === 'reset' ? 'Choose a new password (min 8 characters)' : mode === 'login' ? 'Enter your credentials to continue' : 'Set up your workspace'}
          </div>

          {inviteToken && mode === 'register' && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#eef3f9', color: '#1e3a5f', fontSize: 13, border: '1px solid rgba(30,58,95,0.15)' }}>
              You have been invited to join {brandName}. Complete registration below.
            </div>
          )}

          {success && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#eaf5ee', color: '#1a6b3c', fontSize: 13, border: '1px solid rgba(26,107,60,0.15)' }}>
              {success}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#fbeae8', color: '#c0392b', fontSize: 13, border: '1px solid rgba(192,57,43,0.15)' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {mode === 'register' && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Full name</label>
                  <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required placeholder="Enter your full name" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Company name</label>
                  <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required placeholder="Enter your company name" style={inputStyle} onFocus={onFocus} onBlur={onBlur} />
                </div>
              </>
            )}

            {mode !== 'reset' && (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Email address</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  required placeholder={placeholderEmail} autoFocus={!prefillEmail}
                  style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                  onKeyDown={(e) => { if (e.key === 'Enter' && passwordRef.current && mode !== 'forgot') { e.preventDefault(); passwordRef.current.focus(); } }}
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>{mode === 'reset' ? 'New password' : 'Password'}</label>
                <input
                  ref={passwordRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  required minLength={8} placeholder={mode === 'reset' ? 'Min 8 characters' : 'Enter your password'}
                  style={inputStyle} onFocus={onFocus} onBlur={onBlur}
                />
              </div>
            )}

            {mode === 'login' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b6b65', cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 15, height: 15, accentColor: primaryColor, cursor: 'pointer' }} />
                  Remember me
                </label>
                <button type="button" onClick={() => { setMode('forgot'); setError(null); setSuccess(null); }} style={{ fontSize: 12, color: primaryColor, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit' }}>
                  Forgot?
                </button>
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: 13, borderRadius: 12, background: primaryColor,
              color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1, transition: 'all 0.2s', marginTop: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
            onMouseEnter={(e) => { if (!loading) e.target.style.opacity = '0.85'; }}
            onMouseLeave={(e) => { e.target.style.opacity = loading ? '0.5' : '1'; }}
            >
              {loading && (
                <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              )}
              {mode === 'forgot' ? 'Send Reset Link' : mode === 'reset' ? 'Reset Password' : mode === 'login' ? 'Continue' : 'Create Account'}
            </button>
          </form>

          {(mode === 'login' || mode === 'register') && (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0', fontSize: 11, color: '#c5c5bc', textTransform: 'uppercase', letterSpacing: 1 }}>
            <div style={{ flex: 1, height: 1, background: '#f0eeea' }} />or<div style={{ flex: 1, height: 1, background: '#f0eeea' }} />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => window.location.href = `${import.meta.env.VITE_API_URL || '/api'}/v1/auth/google`} style={oauthStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f4f0'; }} onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}>
              <svg style={{ width: 18, height: 18 }} viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>
            <button type="button" onClick={() => window.location.href = `${import.meta.env.VITE_API_URL || '/api'}/v1/auth/github`} style={oauthStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f4f0'; }} onMouseLeave={(e) => { e.currentTarget.style.background = '#ffffff'; }}>
              <svg style={{ width: 18, height: 18 }} viewBox="0 0 24 24" fill="#111110">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </button>
          </div>
          </>)}

          <div style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#9a9a92' }}>
            {(mode === 'forgot' || mode === 'reset') ? (
              <button onClick={() => { setMode('login'); setError(null); setSuccess(null); }} style={{ background: 'none', border: 'none', color: primaryColor, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                Back to sign in
              </button>
            ) : (
              <>
                {mode === 'login' ? 'No account yet? ' : 'Already have an account? '}
                <button onClick={toggleMode} style={{ background: 'none', border: 'none', color: primaryColor, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                  {mode === 'login' ? 'Request access' : 'Sign in'}
                </button>
              </>
            )}
          </div>

          <div style={{ textAlign: 'center', marginTop: 32, fontSize: 11, color: '#c5c5bc' }}>
            Powered by <a href="https://coppice.ai" target="_blank" rel="noopener noreferrer" style={{ color: '#9a9a92', textDecoration: 'none', fontWeight: 600 }}>Coppice</a>
          </div>
        </div>
      </div>

      {/* Tenant Picker Modal */}
      {tenantPicker && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 400,
            boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#111110', marginBottom: 4 }}>Choose workspace</div>
            <div style={{ fontSize: 13, color: '#9a9a92', marginBottom: 24 }}>
              Your account belongs to multiple organizations.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tenantPicker.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTenantSelect(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px',
                    border: '1.5px solid #e8e6e1', borderRadius: 14, background: '#fafaf8',
                    cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left',
                    fontFamily: "'Instrument Sans', sans-serif",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = primaryColor; e.currentTarget.style.background = '#f5f4f0'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e8e6e1'; e.currentTarget.style.background = '#fafaf8'; }}
                >
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0,
                  }}>
                    {t.name?.charAt(0) || '?'}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111110' }}>{t.name}</div>
                    <div style={{ fontSize: 12, color: '#9a9a92' }}>{t.slug}.coppice.ai</div>
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setTenantPicker(null)}
              style={{
                width: '100%', marginTop: 16, padding: 10, border: 'none', background: 'none',
                color: '#9a9a92', fontSize: 13, cursor: 'pointer', fontFamily: "'Instrument Sans', sans-serif",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: '#333330', marginBottom: 6, display: 'block',
};

const inputStyle = {
  width: '100%', padding: '12px 16px', border: '1.5px solid #e8e6e1',
  borderRadius: 12, fontFamily: "'Instrument Sans', sans-serif", fontSize: 14,
  color: '#111110', background: '#ffffff', outline: 'none', transition: 'all 0.2s',
};

const darkInputStyle = {
  width: '100%', padding: '11px 14px', border: '1.5px solid #2a2a28',
  borderRadius: 10, fontFamily: "'Instrument Sans', sans-serif", fontSize: 13,
  color: '#ffffff', background: '#1c1c1a', outline: 'none', transition: 'all 0.2s',
};

const oauthStyle = {
  flex: 1, padding: 11, borderRadius: 12, border: '1.5px solid #e8e6e1',
  background: '#ffffff', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: 8, fontSize: 13, fontWeight: 600,
  color: '#333330', cursor: 'pointer', transition: 'all 0.15s',
  fontFamily: "'Instrument Sans', sans-serif", textDecoration: 'none',
};

function onFocus(e) {
  e.target.style.borderColor = '#1e3a5f';
  e.target.style.boxShadow = '0 0 0 3px rgba(30,58,95,0.08)';
}

function onBlur(e) {
  e.target.style.borderColor = '#e8e6e1';
  e.target.style.boxShadow = 'none';
}
