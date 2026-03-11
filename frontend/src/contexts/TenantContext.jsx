import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const TenantContext = createContext(null);

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Detect tenant slug from hostname
function getSlugFromHostname() {
  const hostname = window.location.hostname;

  // Production: dacp.coppice.ai → 'dacp'
  if (hostname.endsWith('.coppice.ai')) {
    return hostname.replace('.coppice.ai', '');
  }

  // Dev: dacp.localhost → 'dacp'
  const parts = hostname.split('.');
  if (parts.length >= 2 && parts[parts.length - 1] === 'localhost') {
    return parts[0];
  }

  return null;
}

// Fallback tenant configs when API is unreachable
const FALLBACK_TENANTS = {
  dacp: {
    name: 'DACP Construction',
    slug: 'dacp',
    branding: { companyName: 'DACP', primaryColor: '#1e3a5f', logo: null },
    settings: { industry: 'construction' },
  },
  sangha: {
    name: 'Sangha Renewables',
    slug: 'sangha',
    branding: { companyName: 'COPPICE', primaryColor: '#1a6b3c', logo: null },
    settings: { industry: 'mining' },
  },
};

export function TenantProvider({ children }) {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const slug = getSlugFromHostname();

    axios.get(`${API_BASE}/v1/tenant/public`)
      .then(res => {
        setTenant(res.data);
        applyBranding(res.data.branding);
      })
      .catch(() => {
        // Fallback — use detected slug or default
        const fallback = FALLBACK_TENANTS[slug] || FALLBACK_TENANTS.sangha;
        setTenant(fallback);
        applyBranding(fallback.branding);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <TenantContext.Provider value={{ tenant, loading }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}

function applyBranding(branding) {
  if (!branding) return;
  const root = document.documentElement.style;
  if (branding.primaryColor) {
    root.setProperty('--t-accent', branding.primaryColor);
    root.setProperty('--t-sidebar', branding.primaryColor);
  }
}
