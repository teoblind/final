import React, { useState, useEffect } from 'react';
import api from '../../lib/hooks/useApi';

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState(null);

  // Extract invitation token from URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
      setInviteToken(invite);
      setMode('register');
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let response;

      if (mode === 'login') {
        response = await api.post('/v1/auth/login', {
          email,
          password,
        });
      } else {
        const payload = {
          email,
          password,
          fullName,
          companyName,
        };
        if (inviteToken) {
          payload.invitationToken = inviteToken;
        }
        response = await api.post('/v1/auth/register', payload);
      }

      const data = response.data;
      if (onLogin) {
        onLogin({ user: data.user, tokens: data.tokens });
      }
    } catch (err) {
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'An unexpected error occurred';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="text-terminal-green text-3xl font-bold">&#9650;</span>
            <h1 className="text-2xl font-bold text-terminal-text tracking-wide">
              SANGHA AMPERA
            </h1>
          </div>
          <p className="text-terminal-muted text-sm">
            Mining Operations Intelligence Platform
          </p>
        </div>

        {/* Login/Register Card */}
        <div className="bg-terminal-panel border border-terminal-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-terminal-text mb-6">
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>

          {/* Invitation banner */}
          {inviteToken && mode === 'register' && (
            <div className="mb-4 px-3 py-2 bg-terminal-green/10 border border-terminal-green/30 rounded text-terminal-green text-xs">
              You have been invited to join Sangha Ampera. Complete registration below.
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mb-4 px-3 py-2 bg-terminal-red/10 border border-terminal-red/30 rounded text-terminal-red text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Register-only fields */}
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    placeholder="Enter your full name"
                    className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
                    Company Name
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    placeholder="Enter your company name"
                    className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors"
                  />
                </div>
              </>
            )}

            {/* Email */}
            <div>
              <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
                className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs text-terminal-muted uppercase tracking-wider mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
                className="w-full px-3 py-2.5 bg-[#0a0a0a] border border-terminal-border rounded text-terminal-text text-sm placeholder-terminal-muted/50 focus:outline-none focus:border-terminal-green transition-colors"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-terminal-green text-[#0a0a0a] font-semibold rounded hover:bg-terminal-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a] rounded-full animate-spin" />
              )}
              {mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-6 text-center">
            <button
              onClick={toggleMode}
              className="text-sm text-terminal-cyan hover:underline"
            >
              {mode === 'login'
                ? "Don't have an account? Create Account"
                : 'Already have an account? Sign In'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-terminal-muted text-xs mt-6">
          Sangha Ampera &middot; Mining Operations Platform
        </p>
      </div>
    </div>
  );
}
