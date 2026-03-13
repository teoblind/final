/**
 * Intuit (QuickBooks) OAuth Routes
 *
 * Mirrors the Google integration OAuth pattern from auth.js.
 * Uses Basic auth header for token exchange (not client_secret_post).
 * Intuit refresh tokens expire after 100 days.
 */

import { Router } from 'express';
import axios from 'axios';
import { authenticate } from '../middleware/auth.js';
import { upsertKeyVaultEntry, getKeyVaultEntries, deleteKeyVaultEntry, insertAuditLog } from '../cache/database.js';
import { verifyAccessToken } from '../services/authService.js';

const router = Router();

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const INTUIT_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const INTUIT_SCOPES = 'com.intuit.quickbooks.accounting com.intuit.quickbooks.payment';

function getRedirectUri(req) {
  const proto = process.env.NODE_ENV === 'production' ? 'https' : (req.headers['x-forwarded-proto'] || req.protocol);
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/api/v1/auth/intuit/callback`;
}

// ─── GET /integrate — Start Intuit OAuth flow ────────────────────────────────

router.get('/integrate', (req, res) => {
  try {
    const clientId = process.env.INTUIT_CLIENT_ID;
    if (!clientId) {
      return res.status(501).json({ error: 'Intuit OAuth not configured' });
    }

    const { token } = req.query;
    if (!token) {
      return res.status(401).json({ error: 'Authentication token is required' });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const state = Buffer.from(JSON.stringify({
      tenantId: decoded.tenantId,
      userId: decoded.userId,
    })).toString('base64url');

    const redirectUri = getRedirectUri(req);
    const authUrl = new URL(INTUIT_AUTH_URL);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('scope', INTUIT_SCOPES);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state', state);

    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Intuit integrate start error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /callback — Handle Intuit OAuth callback ────────────────────────────

router.get('/callback', async (req, res) => {
  try {
    const { code, state, realmId, error: oauthError } = req.query;

    if (oauthError || !code || !state) {
      return res.status(400).send(renderErrorPage(
        'OAuth flow was cancelled or failed.',
        oauthError || 'missing_code_or_state'
      ));
    }

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).send(renderErrorPage('Invalid state parameter.', 'invalid_state'));
    }

    const { tenantId, userId } = stateData;
    if (!tenantId || !userId) {
      return res.status(400).send(renderErrorPage('Missing required state fields.', 'incomplete_state'));
    }

    // Exchange code for tokens — Intuit uses Basic auth header
    const clientId = process.env.INTUIT_CLIENT_ID;
    const clientSecret = process.env.INTUIT_CLIENT_SECRET;
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenResp = await axios.post(INTUIT_TOKEN_URL, new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(req),
    }).toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    const tokens = tokenResp.data;

    // Store realm_id
    if (realmId) {
      upsertKeyVaultEntry({
        tenantId,
        service: 'intuit-quickbooks',
        keyName: 'realm_id',
        keyValue: realmId,
        addedBy: userId,
      });
    }

    // Store refresh_token
    if (tokens.refresh_token) {
      upsertKeyVaultEntry({
        tenantId,
        service: 'intuit-quickbooks',
        keyName: 'refresh_token',
        keyValue: tokens.refresh_token,
        addedBy: userId,
      });
    }

    // Store access_token with expiry
    if (tokens.access_token) {
      upsertKeyVaultEntry({
        tenantId,
        service: 'intuit-quickbooks',
        keyName: 'access_token',
        keyValue: tokens.access_token,
        addedBy: userId,
        expiresAt: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
      });
    }

    // Audit log
    insertAuditLog({
      tenantId,
      userId,
      action: 'integration.connected',
      resourceType: 'integration',
      resourceId: 'intuit-quickbooks',
      details: { hasRefreshToken: !!tokens.refresh_token, realmId },
      ipAddress: req.ip,
    });

    // Send success to opener
    res.send(`<!DOCTYPE html>
<html>
<head><title>QuickBooks Connected</title></head>
<body>
  <p style="font-family: -apple-system, sans-serif; text-align: center; margin-top: 40px; color: #1a6b3c;">
    QuickBooks connected successfully. This window will close automatically.
  </p>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth-integration-success', source: 'intuit-quickbooks' }, '*');
    }
    window.close();
  </script>
</body>
</html>`);
  } catch (error) {
    console.error('Intuit callback error:', error);
    res.status(500).send(renderErrorPage(
      'Something went wrong connecting QuickBooks. Please try again.',
      error.message
    ));
  }
});

// ─── GET /status — Check connection status ───────────────────────────────────

router.get('/status', authenticate, (req, res) => {
  try {
    const entries = getKeyVaultEntries(req.user.tenantId);
    const qbEntries = entries.filter(e => e.service === 'intuit-quickbooks');
    const hasRefresh = qbEntries.some(e => e.key_name === 'refresh_token');
    const hasRealm = qbEntries.some(e => e.key_name === 'realm_id');

    res.json({
      connected: hasRefresh && hasRealm,
      hasRefreshToken: hasRefresh,
      hasRealmId: hasRealm,
    });
  } catch (error) {
    console.error('Intuit status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /disconnect — Remove QuickBooks connection ────────────────────────

router.delete('/disconnect', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const entries = getKeyVaultEntries(tenantId);
    const qbEntries = entries.filter(e => e.service === 'intuit-quickbooks');

    // Try to revoke token with Intuit
    const refreshToken = qbEntries.find(e => e.key_name === 'refresh_token');
    if (refreshToken) {
      try {
        const clientId = process.env.INTUIT_CLIENT_ID;
        const clientSecret = process.env.INTUIT_CLIENT_SECRET;
        const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        await axios.post(INTUIT_REVOKE_URL, new URLSearchParams({
          token: refreshToken.key_value || '',
        }).toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basicAuth}`,
          },
          timeout: 10000,
        });
      } catch {
        // Revoke failed — still remove locally
      }
    }

    // Remove all QB entries from key_vault
    for (const entry of qbEntries) {
      deleteKeyVaultEntry(entry.id, tenantId);
    }

    insertAuditLog({
      tenantId,
      userId: req.user.userId,
      action: 'integration.disconnected',
      resourceType: 'integration',
      resourceId: 'intuit-quickbooks',
      details: {},
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Intuit disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function renderErrorPage(message, detail) {
  return `<!DOCTYPE html>
<html>
<head><title>QuickBooks Error</title></head>
<body>
  <div style="font-family: -apple-system, sans-serif; text-align: center; margin-top: 40px; max-width: 480px; margin-left: auto; margin-right: auto;">
    <h2 style="color: #c0392b;">Connection Failed</h2>
    <p style="color: #333;">${message}</p>
    <p style="color: #999; font-size: 12px;">Error: ${detail}</p>
    <button onclick="window.close()" style="margin-top: 16px; padding: 8px 24px; background: #333; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px;">
      Close Window
    </button>
  </div>
</body>
</html>`;
}

export default router;
