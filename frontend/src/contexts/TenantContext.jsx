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
    branding: { companyName: 'DACP', primaryColor: '#1e3a5f', hideSanghaBranding: true, logo: null },
    settings: { industry: 'construction' },
  },
  sangha: {
    name: 'Coppice Platform',
    slug: 'sangha',
    branding: { companyName: 'COPPICE', primaryColor: '#1a6b3c', logo: null },
    settings: { industry: 'mining' },
  },
  zhan: {
    name: 'Zhan Capital',
    slug: 'zhan',
    branding: { companyName: 'Zhan Capital', primaryColor: '#141414', sidebarColor: '#0e0e0e', logo: null },
    settings: { industry: 'venture', show_portfolio: true },
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
        // Fallback - use detected slug or default
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

function lightenColor(hex, amount = 0.4) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    r: Math.round(r + (255 - r) * amount),
    g: Math.round(g + (255 - g) * amount),
    b: Math.round(b + (255 - b) * amount),
  };
}

function applyBranding(branding) {
  if (!branding) return;
  const root = document.documentElement.style;
  if (branding.primaryColor) {
    const pc = branding.primaryColor;
    root.setProperty('--t-accent', pc);
    root.setProperty('--t-sidebar', branding.sidebarColor || pc);
    // Derive UI accent colors from primary color
    const r = parseInt(pc.slice(1, 3), 16);
    const g = parseInt(pc.slice(3, 5), 16);
    const b = parseInt(pc.slice(5, 7), 16);
    root.setProperty('--t-ui-accent', pc);
    root.setProperty('--t-ui-accent-rgb', `${r}, ${g}, ${b}`);
    root.setProperty('--t-ui-accent-bg', `rgba(${r}, ${g}, ${b}, 0.08)`);
    root.setProperty('--t-ui-accent-border', `rgba(${r}, ${g}, ${b}, 0.2)`);
  }
  // Sidebar accent: use tenant's own color (lightened for visibility) or Coppice green
  if (branding.hideSanghaBranding && branding.primaryColor) {
    const light = lightenColor(branding.primaryColor, 0.45);
    const hex = `#${light.r.toString(16).padStart(2,'0')}${light.g.toString(16).padStart(2,'0')}${light.b.toString(16).padStart(2,'0')}`;
    root.setProperty('--t-sidebar-accent', hex);
    root.setProperty('--t-sidebar-accent-rgb', `${light.r}, ${light.g}, ${light.b}`);
  } else {
    root.setProperty('--t-sidebar-accent', '#2dd478');
    root.setProperty('--t-sidebar-accent-rgb', '45,212,120');
  }
}
