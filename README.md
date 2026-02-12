# Sangha MineOS — Mining Operations Platform

A unified mining operations platform for Bitcoin miners and AI HPC operators, built on top of a macro intelligence dashboard. Provides real-time energy market data, fleet-aware hashprice modeling, curtailment optimization, mining pool monitoring, and autonomous agent-based operations.

## Quick Start

```bash
# Install dependencies
npm run install:all

# Create environment file (optional — works without API keys)
cp .env.example .env

# Start development servers (frontend + backend)
npm run dev
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001

## Architecture

```
frontend/
├── src/
│   ├── App.jsx                       # App shell with tab navigation
│   ├── components/
│   │   ├── ui/                       # Shared UI primitives
│   │   │   ├── Panel.tsx             # Base panel (header, refresh, screenshot, export)
│   │   │   ├── MetricCard.tsx        # Key metric display
│   │   │   ├── Chart.tsx             # Reusable chart wrapper
│   │   │   ├── DataSource.tsx        # Source attribution bar
│   │   │   └── StatusDot.tsx         # Connection status indicator
│   │   ├── dashboards/
│   │   │   ├── OperationsDashboard   # Mining ops control center (Phase 2-6 placeholders)
│   │   │   └── MacroDashboard        # All original macro panels
│   │   ├── panels/
│   │   │   ├── PlaceholderPanel.tsx   # Template for coming-soon panels
│   │   │   ├── macro/                # 12 existing macro panels
│   │   │   ├── energy/               # [Phase 2] Energy market panels
│   │   │   ├── hashprice/            # [Phase 3] Fleet hashprice panels
│   │   │   ├── curtailment/          # [Phase 4] Curtailment panels
│   │   │   ├── pools/                # [Phase 5] Pool monitoring panels
│   │   │   └── agents/               # [Phase 6] Agent control panels
│   │   ├── SettingsPanel.tsx         # Platform configuration
│   │   ├── AlertsPanel.jsx           # Threshold alerts
│   │   ├── NotesPanel.jsx            # Trading journal
│   │   ├── LiquidityPanel.jsx        # TBL liquidity signal engine
│   │   └── ManualEntryModal.jsx      # Manual data entry
│   ├── config/
│   │   ├── panels.ts                 # Panel registry (single source of truth)
│   │   ├── dashboards.ts             # Dashboard layout configs
│   │   └── themes.ts                 # Theme tokens
│   ├── lib/
│   │   ├── data/
│   │   │   ├── connectors/           # API connector pattern
│   │   │   ├── cache.ts              # Client-side caching layer
│   │   │   └── types.ts              # Data layer types
│   │   ├── hooks/
│   │   │   ├── useApi.ts             # Data fetching + WebSocket hook
│   │   │   └── usePanel.ts           # Panel state management
│   │   └── utils/                    # Formatters, scoring algorithms
│   └── types/                        # Global TypeScript types

backend/                              # Express + SQLite (unchanged)
├── src/
│   ├── routes/                       # API endpoints
│   ├── services/                     # Yahoo Finance, FRED, hashrate
│   ├── jobs/                         # Scheduled refresh tasks
│   └── cache/                        # SQLite database layer
```

## Dashboard Tabs

### Operations (default)
Mining operations control center. Currently shows placeholder panels for features being built in Phases 2–6:
- **Energy Market** (Phase 2) — Real-time ISO/RTO pricing
- **Fleet Hashprice** (Phase 3) — Fleet-aware profitability modeling
- **Curtailment Optimizer** (Phase 4) — Automated curtailment decisions
- **Pool Monitor** (Phase 5) — Mining pool performance tracking
- **Agent Status** (Phase 6) — Autonomous agent control panel

### Macro Intelligence
All original dashboard panels preserved intact:
1. Bitcoin Hashprice — Mining profitability ($/TH/s/day)
2. EU vs US Tech Ratio — STOXX 600 Tech / NDX relative strength
3. US Strategic Bitcoin Reserve — Government wallet tracking
4. Optical Fiber Infrastructure — GLW/QQQ ratio + fiber basket
5. Japan Macro — JGB yield curve + NIIP
6. Uranium Spot & Term — U3O8 pricing
7. Brazil Green Compute — EWZ/SPY + energy surplus
8. Global Manufacturing PMIs — Regional heatmap
9. Rare Earth Oxide Prices — NdPr, Dy, Tb, Ce tracking
10. Iran Hashrate Share — Geographic distribution
11. Trade Routes — Suez Canal + IMEC milestones
12. Data Center Power — Regional capacity vs demand

### Other Tabs
- **Correlations** — Rolling 30/90-day correlation matrix
- **Alerts** — Threshold alerts with Discord/Telegram webhooks
- **Notes** — Markdown trading journal linked to panels
- **Liquidity** — TBL composite liquidity signal engine
- **Settings** — Platform configuration (fleet, energy, pools, agents)

## Panel Registry

Panels are registered in `src/config/panels.ts`. To add a new panel:

1. Create the component in `src/components/panels/<category>/`
2. Add a registry entry in `config/panels.ts`
3. Add the panel ID to a dashboard layout in `config/dashboards.ts`

## Data Connectors

All external data sources use a consistent connector interface (`src/lib/data/connectors/`):

| Connector | Source | Refresh |
|-----------|--------|---------|
| Hashprice | CoinGecko + Blockchain.info | 15 min |
| Yahoo Finance | Equity/ETF prices | 5 min |
| Bitcoin Reserve | Blockchain.info + DOJ | 30 min |
| FRED | JGB, CPI, unemployment | 30 min |
| Liquidity | FRED + Yahoo + CoinGecko | 5 min |
| Uranium | Manual entry | 1 hr |
| PMI | Trading Economics + Manual | 1 hr |
| Rare Earth | Asian Metal + Manual | 1 hr |

## Phase Roadmap

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Fork & Refactor — Modular architecture, panel registry, navigation | **Complete** |
| 2 | Energy Market Data — ERCOT/ISO pricing, LMP heatmaps | Planned |
| 3 | Fleet Hashprice — Per-machine profitability, breakeven analysis | Planned |
| 4 | Curtailment Optimizer — Automated on/off scheduling | Planned |
| 5 | Pool Monitoring — Multi-pool aggregated dashboard | Planned |
| 6 | Agent Framework — Autonomous operational agents | Planned |
| 7 | AI HPC Module — GPU fleet, inference pricing | Planned |
| 8 | Auth & Multi-tenant — User accounts, team access | Planned |
| 9 | Mobile & Alerts v2 — Mobile app, advanced alerting | Planned |

## API Keys (Optional)

Most data sources work without API keys. For enhanced functionality:

```env
FRED_API_KEY=your_key_here     # FRED economic data
EIA_API_KEY=your_key_here      # Energy data (Phase 2)
COINGECKO_API_KEY=your_key     # Higher rate limits
```

## Development

```bash
# Frontend only
cd frontend && npm run dev

# Backend only
cd backend && npm run dev

# Build for production
cd frontend && npm run build
cd backend && npm start
```

## License

MIT
