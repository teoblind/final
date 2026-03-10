import React, { createContext, useContext, useState, useEffect } from 'react';
import * as auth from '../services/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkStoredAuth();
  }, []);

  async function checkStoredAuth() {
    try {
      const authenticated = await auth.isAuthenticated();
      if (authenticated) {
        const storedUser = await auth.getStoredUser();
        if (storedUser) {
          setUser(storedUser);
        }
      }
    } catch {
      // No valid session
    } finally {
      setLoading(false);
    }
  }

  async function login(email, password) {
    const loggedInUser = await auth.login(email, password);
    setUser(loggedInUser);
    return loggedInUser;
  }

  async function logout() {
    await auth.logout();
    setUser(null);
  }

  const value = {
    user,
    loading,
    login,
    logout,
    isAuthenticated: !!user,
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
