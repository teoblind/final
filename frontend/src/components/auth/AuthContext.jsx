import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/hooks/useApi';

const AuthContext = createContext(null);

const SESSION_KEY = 'sangha_auth';

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(user, tokens) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user, tokens }));
  } catch {
    // sessionStorage may be unavailable in some contexts
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tokens, setTokens] = useState(null);
  const [loading, setLoading] = useState(true);

  const requestInterceptorRef = useRef(null);
  const responseInterceptorRef = useRef(null);
  const refreshPromiseRef = useRef(null);

  // Set up axios request interceptor to attach Bearer token
  const setupInterceptors = useCallback((accessToken) => {
    // Eject previous interceptors if they exist
    if (requestInterceptorRef.current !== null) {
      api.interceptors.request.eject(requestInterceptorRef.current);
    }
    if (responseInterceptorRef.current !== null) {
      api.interceptors.response.eject(responseInterceptorRef.current);
    }

    // Request interceptor: attach Authorization header
    requestInterceptorRef.current = api.interceptors.request.use(
      (config) => {
        // Read the latest token from sessionStorage in case it was refreshed
        const session = loadSession();
        const token = session?.tokens?.accessToken || accessToken;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor: handle 401 by attempting token refresh
    responseInterceptorRef.current = api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        // If 401 and not already retrying and not the refresh endpoint itself
        if (
          error.response?.status === 401 &&
          !originalRequest._retry &&
          !originalRequest.url?.includes('/auth/refresh') &&
          !originalRequest.url?.includes('/auth/login')
        ) {
          originalRequest._retry = true;

          try {
            const newTokens = await refreshTokens();
            if (newTokens) {
              originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
              return api(originalRequest);
            }
          } catch (refreshError) {
            // Refresh failed, force logout
            handleLogout();
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );
  }, []);

  // Refresh tokens
  const refreshTokens = useCallback(async () => {
    // Deduplicate concurrent refresh requests
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const session = loadSession();
    const refreshToken = session?.tokens?.refreshToken;

    if (!refreshToken) {
      return null;
    }

    refreshPromiseRef.current = (async () => {
      try {
        const response = await api.post('/v1/auth/refresh', {
          refreshToken,
        });
        const newTokens = response.data.tokens;
        const currentUser = response.data.user || session?.user;

        setTokens(newTokens);
        setUser(currentUser);
        saveSession(currentUser, newTokens);
        setupInterceptors(newTokens.accessToken);

        return newTokens;
      } catch (err) {
        console.error('Token refresh failed:', err);
        handleLogout();
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    return refreshPromiseRef.current;
  }, [setupInterceptors]);

  // Logout
  const handleLogout = useCallback(async () => {
    const session = loadSession();
    const refreshToken = session?.tokens?.refreshToken;

    // Best-effort logout API call
    if (refreshToken) {
      try {
        await api.post('/v1/auth/logout', { refreshToken });
      } catch {
        // Ignore logout API errors
      }
    }

    // Eject interceptors
    if (requestInterceptorRef.current !== null) {
      api.interceptors.request.eject(requestInterceptorRef.current);
      requestInterceptorRef.current = null;
    }
    if (responseInterceptorRef.current !== null) {
      api.interceptors.response.eject(responseInterceptorRef.current);
      responseInterceptorRef.current = null;
    }

    setUser(null);
    setTokens(null);
    clearSession();
  }, []);

  // Login — called by LoginPage after successful auth
  const login = useCallback(
    (data) => {
      const { user: userData, tokens: tokenData } = data;
      setUser(userData);
      setTokens(tokenData);
      saveSession(userData, tokenData);
      setupInterceptors(tokenData.accessToken);
    },
    [setupInterceptors]
  );

  // Permission / role checks
  const hasPermission = useCallback(
    (permission) => {
      if (!user || !user.permissions) return false;
      return !!user.permissions[permission];
    },
    [user]
  );

  const hasRole = useCallback(
    (role) => {
      if (!user) return false;
      return user.role === role;
    },
    [user]
  );

  // On mount: restore session and validate with /auth/me
  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      const session = loadSession();

      if (!session?.tokens?.accessToken) {
        setLoading(false);
        return;
      }

      // Set up interceptors with the stored token
      setupInterceptors(session.tokens.accessToken);

      try {
        const response = await api.get('/v1/auth/me');

        if (!cancelled) {
          const userData = response.data.user || response.data;
          setUser(userData);
          setTokens(session.tokens);
          saveSession(userData, session.tokens);
        }
      } catch (err) {
        // Token might be expired, try refresh
        if (err.response?.status === 401) {
          try {
            const newTokens = await refreshTokens();
            if (!cancelled && newTokens) {
              const retryResponse = await api.get('/v1/auth/me');
              const userData = retryResponse.data.user || retryResponse.data;
              setUser(userData);
            }
          } catch {
            if (!cancelled) {
              clearSession();
            }
          }
        } else {
          if (!cancelled) {
            clearSession();
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, [setupInterceptors, refreshTokens]);

  // Auto-refresh timer: check token expiry every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      const session = loadSession();
      if (!session?.tokens?.accessToken) return;

      // Decode JWT payload to check expiry (without verification)
      try {
        const payload = JSON.parse(atob(session.tokens.accessToken.split('.')[1]));
        const expiresAt = payload.exp * 1000;
        const now = Date.now();
        const fiveMinutes = 5 * 60 * 1000;

        // If token expires within 5 minutes, refresh proactively
        if (expiresAt - now < fiveMinutes) {
          refreshTokens();
        }
      } catch {
        // If JWT can't be decoded, skip proactive refresh
      }
    }, 60 * 1000);

    return () => clearInterval(interval);
  }, [refreshTokens]);

  const value = {
    user,
    tokens,
    loading,
    login,
    logout: handleLogout,
    hasPermission,
    hasRole,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
