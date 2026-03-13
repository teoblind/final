import React, { useState } from 'react';

export default function SetPasswordModal({ onSuccess, onSkip }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const session = JSON.parse(sessionStorage.getItem('sangha_auth') || '{}');
      const res = await fetch('/api/v1/auth/set-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.tokens?.accessToken}`,
        },
        body: JSON.stringify({ newPassword }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set password');

      if (session?.user) {
        session.user.mustSetPassword = false;
        sessionStorage.setItem('sangha_auth', JSON.stringify(session));
      }

      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      fontFamily: "'Instrument Sans', sans-serif",
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 400,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111110', marginBottom: 4 }}>
          Set your password
        </div>
        <div style={{ fontSize: 13, color: '#9a9a92', marginBottom: 24 }}>
          Create a password so you can also sign in with email.
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 10,
            background: '#fbeae8', color: '#c0392b', fontSize: 13,
            border: '1px solid rgba(192,57,43,0.15)',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>New password</label>
            <input
              type="password" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required minLength={8} placeholder="At least 8 characters"
              style={inputStyle}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>Confirm password</label>
            <input
              type="password" value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required placeholder="Re-enter password"
              style={inputStyle}
            />
          </div>

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: 13, borderRadius: 12, background: '#1a6b3c',
            color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1, transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            {loading && (
              <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
            )}
            Set Password
          </button>
        </form>

        {onSkip && (
          <button
            onClick={onSkip}
            style={{
              width: '100%', marginTop: 12, padding: 10, border: 'none', background: 'none',
              color: '#9a9a92', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Skip for now
          </button>
        )}
      </div>

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
