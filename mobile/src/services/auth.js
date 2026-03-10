import * as SecureStore from 'expo-secure-store';
import { getBaseUrl } from './api';

const STORE_KEYS = {
  user: 'auth_user',
  tokens: 'auth_tokens',
};

export async function login(email, password) {
  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Invalid email or password');
  }

  const data = await response.json();
  const { user, tokens } = data;

  await SecureStore.setItemAsync(STORE_KEYS.user, JSON.stringify(user));
  await SecureStore.setItemAsync(STORE_KEYS.tokens, JSON.stringify(tokens));

  return user;
}

export async function logout() {
  try {
    const headers = await getAuthHeaders();
    if (headers.Authorization) {
      const baseUrl = await getBaseUrl();
      await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: 'POST',
        headers,
      });
    }
  } catch (_) {
    // Proceed with local cleanup even if server call fails
  }

  await SecureStore.deleteItemAsync(STORE_KEYS.user);
  await SecureStore.deleteItemAsync(STORE_KEYS.tokens);
}

export async function refreshTokens() {
  const stored = await getStoredTokens();
  if (!stored?.refreshToken) {
    throw new Error('No refresh token available');
  }

  const baseUrl = await getBaseUrl();
  const response = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  });

  if (!response.ok) {
    await SecureStore.deleteItemAsync(STORE_KEYS.tokens);
    await SecureStore.deleteItemAsync(STORE_KEYS.user);
    throw new Error('Session expired');
  }

  const data = await response.json();
  const tokens = data.tokens;

  await SecureStore.setItemAsync(STORE_KEYS.tokens, JSON.stringify(tokens));

  return tokens;
}

export async function getStoredUser() {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEYS.user);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function getStoredTokens() {
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEYS.tokens);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function getAuthHeaders() {
  const tokens = await getStoredTokens();
  if (tokens?.accessToken) {
    return { Authorization: `Bearer ${tokens.accessToken}` };
  }
  return {};
}

export async function isAuthenticated() {
  const tokens = await getStoredTokens();
  if (!tokens?.accessToken || !tokens?.expiresAt) {
    return false;
  }

  const expiresAt = new Date(tokens.expiresAt).getTime();
  const now = Date.now();

  // If token is expired, try to refresh
  if (now >= expiresAt) {
    try {
      await refreshTokens();
      return true;
    } catch {
      return false;
    }
  }

  return true;
}
