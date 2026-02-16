/**
 * Authentication Service
 *
 * Handles password hashing, JWT token generation/verification,
 * and API key management for the Ampera platform.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto, { randomUUID } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'ampera-dev-secret-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ampera-refresh-secret-change-in-production';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

/**
 * Hash a plaintext password using bcrypt with 12 salt rounds.
 * @param {string} password - The plaintext password to hash
 * @returns {Promise<string>} The bcrypt hash
 */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 * @param {string} password - The plaintext password
 * @param {string} hash - The bcrypt hash to compare against
 * @returns {Promise<boolean>} True if the password matches
 */
export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generate an access token and refresh token pair for a user.
 * @param {object} user - The user object
 * @param {string|number} user.id - User ID
 * @param {string} user.email - User email
 * @param {string|number} user.tenant_id - Tenant ID
 * @param {string} user.role - User role
 * @returns {{ accessToken: string, refreshToken: string, expiresAt: string }}
 */
export function generateTokens(user) {
  const sessionId = randomUUID();

  const accessToken = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      tenantId: user.tenant_id,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      sessionId,
    },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  // Calculate the absolute expiration time for the access token
  const decoded = jwt.decode(accessToken);
  const expiresAt = new Date(decoded.exp * 1000).toISOString();

  return { accessToken, refreshToken, expiresAt };
}

/**
 * Verify and decode an access token.
 * @param {string} token - The JWT access token
 * @returns {object} The decoded payload
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError} On invalid or expired token
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Verify and decode a refresh token.
 * @param {string} token - The JWT refresh token
 * @returns {object} The decoded payload
 * @throws {jwt.JsonWebTokenError|jwt.TokenExpiredError} On invalid or expired token
 */
export function verifyRefreshToken(token) {
  return jwt.verify(token, JWT_REFRESH_SECRET);
}

/**
 * Create a SHA-256 hash of a token for secure storage.
 * @param {string} token - The token to hash
 * @returns {string} The hex-encoded SHA-256 hash
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a new API key with a prefix and hash.
 * @returns {{ key: string, prefix: string, hash: string }}
 *   - key: 'mk_live_' + 40 random hex characters
 *   - prefix: first 12 characters of the full key
 *   - hash: SHA-256 hash of the full key
 */
export function generateApiKey() {
  const randomHex = crypto.randomBytes(20).toString('hex'); // 20 bytes = 40 hex chars
  const key = `mk_live_${randomHex}`;
  const prefix = key.substring(0, 12);
  const hash = crypto.createHash('sha256').update(key).digest('hex');

  return { key, prefix, hash };
}

/**
 * Verify an API key against a stored SHA-256 hash.
 * @param {string} key - The API key to verify
 * @param {string} hash - The stored SHA-256 hash
 * @returns {boolean} True if the key matches the hash
 */
export function verifyApiKey(key, hash) {
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(keyHash, 'hex'), Buffer.from(hash, 'hex'));
}
