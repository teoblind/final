import * as SecureStore from 'expo-secure-store';

const DEFAULT_BASE_URL = 'http://localhost:3002/api/v1';
let baseUrl = DEFAULT_BASE_URL;

export async function loadBaseUrl() {
  try {
    const stored = await SecureStore.getItemAsync('api_base_url');
    if (stored) baseUrl = stored;
  } catch {}
  return baseUrl;
}

export async function setBaseUrl(url) {
  baseUrl = url;
  try { await SecureStore.setItemAsync('api_base_url', url); } catch {}
}

export function getBaseUrl() { return baseUrl; }

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  try {
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status}: ${body}`);
    }
    return res.json();
  } catch (err) {
    if (err.message.includes('Network request failed')) {
      throw new Error('Cannot reach server. Check your connection and API URL.');
    }
    throw err;
  }
}

export async function getMessages(agentId, limit = 50) {
  return request(`/chat/${agentId}/messages?limit=${limit}`);
}
export async function sendMessage(agentId, content) {
  return request(`/chat/${agentId}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
}
export async function clearMessages(agentId) {
  return request(`/chat/${agentId}/messages`, { method: 'DELETE' });
}
export async function getApprovals(status = 'pending') {
  return request(`/approvals?status=${status}`);
}
export async function approveItem(id) {
  return request(`/approvals/${id}/approve`, { method: 'POST' });
}
export async function rejectItem(id) {
  return request(`/approvals/${id}/reject`, { method: 'POST' });
}
export async function getNotifications(limit = 20) {
  return request(`/platform-notifications?limit=${limit}`);
}
export async function getNotificationCount() {
  return request('/platform-notifications/count');
}
export async function markNotificationRead(id) {
  return request(`/platform-notifications/${id}/read`, { method: 'POST' });
}
export async function markAllNotificationsRead() {
  return request('/platform-notifications/read-all', { method: 'POST' });
}
export async function getEstimateStats() {
  return request('/estimates/stats');
}
export async function getEstimateInbox() {
  return request('/estimates/inbox');
}
export async function generateEstimate(id) {
  return request(`/estimates/inbox/${id}/estimate`, { method: 'POST' });
}
export async function getEstimates() {
  return request('/estimates/estimates');
}
export async function getJobs() {
  return request('/estimates/jobs');
}
export async function getJobDetail(id) {
  return request(`/estimates/jobs/${id}`);
}
export async function getFieldReports() {
  return request('/estimates/field-reports');
}
export async function getWorkspaceFiles() {
  return request('/workspace/files');
}
export async function checkHealth() {
  return request('/health');
}
