import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Search, ExternalLink, ChevronRight, ChevronDown, FolderOpen, RefreshCw, Send, Mail, X, AlertTriangle, TrendingUp, Shield, Target, Zap, Clock, FileText, Printer, Download, MessageCircle, Upload, Mic, Newspaper } from 'lucide-react';
import { useTenant } from '../../contexts/TenantContext';
import { useAuth } from '../auth/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

// ─── File Type Icons ────────────────────────────────────────────────────────

const FILE_ICONS = {
  doc:    { letter: 'D', bg: '#e8eef5', color: '#2c5282' },
  docx:   { letter: 'D', bg: '#e8eef5', color: '#2c5282' },
  sheet:  { letter: 'S', bg: '#edf7f0', color: '#1a6b3c' },
  xlsx:   { letter: 'S', bg: '#edf7f0', color: '#1a6b3c' },
  slides: { letter: 'P', bg: '#fdf6e8', color: '#b8860b' },
  pptx:   { letter: 'P', bg: '#fdf6e8', color: '#b8860b' },
  pdf:    { letter: 'F', bg: '#fdedf0', color: '#dc3545' },
  csv:    { letter: 'C', bg: '#edf7f0', color: '#1a6b3c' },
  meeting:{ letter: 'M', bg: '#f0edf7', color: '#7c3aed' },
  newsletter:{ letter: 'N', bg: '#e8eef5', color: '#1e3a5f' },
  other:  { letter: '?', bg: '#f5f4f0', color: '#666' },
};

function getFileIcon(fileType) {
  return FILE_ICONS[fileType] || FILE_ICONS.other;
}

// Google Drive icon SVG
function DriveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg" className="inline-block">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0-1.2 4.5h27.5z" fill="#00ac47"/>
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.85l5.85 10.15z" fill="#ea4335"/>
      <path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
      <path d="M59.85 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h36.85c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="M73.4 26.5 60.65 3.3c-.8-1.4-1.95-2.5-3.3-3.3L43.6 25l16.25 28h27.5c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>
  );
}

// ─── Intel Report Content ───────────────────────────────────────────────────

const REPORT_CONTENT = {
  '2026-02-06': `\u26a1 Weekly Intel: Feb 6, 2026 \u2013 Mining Market Dynamics
============================================================
Generated: Feb 6, 2026 2:03 PM EST

COMPETITOR SNAPSHOT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Key Competitor Actions (Last 24-72 Hours):
\u2022 Bitfarms (BITF): Bitfarms completes deleveraging with Keel rebrand, consolidating 4 EH/s fleet under new identity after selling Argentinian operations at 30% discount.
  Strategic Read: Forced capital restructuring signals distress; reduced hashrate lowers competitive pressure.
  Risk: Keel rebrand may attract fresh institutional capital if successful, re-entering as leaner competitor.
  Sangha Implication: Bitfarms' 4 EH/s reduction directly benefits Sangha's difficulty-adjusted margins. Argentine asset fire sale may signal more distressed assets becoming available at below-replacement cost.

\u2022 Core Scientific (CORZ): Core Scientific announces 200 MW AI hosting agreement with CoreWeave, converting 40% of mining capacity to HPC workloads by Q3 2026.
  Strategic Read: Largest public miner pivoting aggressively to AI/HPC, removing significant hashrate from Bitcoin network.
  Sangha Implication: Core Scientific's 200 MW conversion removes ~8 EH/s from network, creating immediate difficulty tailwind for pure-play miners. Validates Sangha's decision to remain focused on mining.

\u2022 Marathon Digital (MARA): Marathon reports Q4 loss of $142M, announces $200M at-the-market equity offering to fund operations through halving cycle.
  Strategic Read: Largest US miner diluting equity to survive, signaling cash flow pressures across the industry.
  Sangha Implication: Marathon's dilutive financing at cycle lows demonstrates the advantage of Sangha's behind-the-meter model with sub-3-cent power. No equity dilution needed when operating costs are 60% below public miner averages.

\u2022 Hut 8 (HUT): Hut 8 secures $150M credit facility backed by 9,100 BTC treasury reserves, signaling shift to balance-sheet-driven strategy.
  Strategic Read: Using BTC treasury as collateral suggests mining revenues insufficient to fund operations independently.
  Sangha Implication: Hut 8 leveraging BTC reserves indicates industry-wide margin compression. Sangha's low-cost structure means no need to encumber BTC holdings for operating capital.


Trending Themes:
\u2022 mining_difficulty_decline [new]
\u2022 industry_consolidation [new]
\u2022 cost_advantage_critical [new]
\u2022 ai_hpc_pivot_accelerating
\u2022 public_miner_distress


Our Positioning: Strongly favorable. Multiple competitors exiting or reducing hashrate creates significant difficulty tailwind. Sangha's sub-3-cent power cost positions us in the top 5% of efficient operators globally.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

TOP NEWS ITEMS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500


1. Bitfarms Deleverages, Unveils Keel Rebrand as Bitcoin Mining Margins Sink Below $30/PH/s - TheMinerMag
   [credible] [near_term] [high] [opportunity]

   Why it matters: Major miner financial distress and potential capacity reduction will decrease network difficulty, improving margins for remaining efficient operators.
   Sangha impact: Bitfarms' struggles indicate industry consolidation opportunity. Their potential hashrate reduction directly benefits Sangha through lower difficulty. Distressed assets may become available at attractive prices.
   Actionability: Monitor Bitfarms for potential asset acquisition opportunities or facility partnerships


2. Bitcoin miners power down en masse as losses hit records - ForkLog
   [credible] [near_term] [high] [opportunity]

   Why it matters: Widespread miner shutdowns reduce network hashrate and mining difficulty, making remaining operations more profitable per unit of computing power deployed.
   Sangha impact: As competitors shut down operations, Bitcoin mining difficulty will decrease, directly improving Sangha's profit margins per hash. Sangha's low-cost behind-the-meter advantage becomes even more critical as higher-cost miners exit first.
   Actionability: Monitor hashrate data to quantify opportunity and use in investor materials to highlight competitive moat


3. Bitcoin Is Crashing So Hard That Miners Are Unplugging Their Equipment - Futurism
   [credible] [near_term] [high] [opportunity]

   Why it matters: Equipment shutdowns across the industry will trigger automatic difficulty adjustments, making mining more profitable for operators who can continue running.
   Sangha impact: Sangha's behind-the-meter cost structure allows continued operation while grid-dependent competitors shut down. This creates immediate margin expansion opportunity as difficulty decreases.
   Actionability: Calculate potential margin improvement from expected difficulty drop and communicate to stakeholders


4. Bitcoin Mining Revenue Gauge Falls to Record Low During Selloff - Bloomberg.com
   [credible] [near_term] [high] [opportunity]

   Why it matters: Record low mining revenues will force marginal miners offline, reducing network difficulty and improving economics for efficient operators who can weather the downturn.
   Sangha impact: Sangha's lowest-in-industry power costs provide crucial survival advantage during this downturn. As weaker competitors exit, Sangha gains larger share of remaining mining rewards when difficulty adjusts downward.
   Actionability: Prepare investor communication emphasizing cost advantage and ability to maintain operations while competitors shut down


5. Miners are being squeezed as bitcoin's $70,000 price fails to cover $87,000 production costs - CoinDesk
   [credible] [near_term] [high] [opportunity]

   Why it matters: Industry-wide negative margins will force widespread shutdowns, significantly reducing network hashrate and triggering beneficial difficulty adjustments for surviving miners.
   Sangha impact: If Sangha's production costs are below $70k (likely given lowest-cost positioning), this represents massive competitive advantage as most industry players operate at losses. Sangha can continue mining profitably while competitors exit.
   Actionability: Verify Sangha's production cost per Bitcoin vs industry average and highlight this spread to investors

════════════════════════════════════════════════════════════

RECOMMENDED OUTREACH
────────────────────────────────────────

Stats: Total Contacts: 9 | High Priority: 0 | Competitor-Triggered: 0 | Re-Engagements: 0

1. Chris Brown
   Title: Founder and Managing Director | Company: Brown Equity Group | Email: cbrown@brownequitygroup.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Chris Brown is Founder and Managing Director at Brown Equity Group. Given their industry focus, the recent developments around Bitfarms Deleverages, Unveils Keel Rebrand as... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Bitfarms Deleverages, Unveils Keel..., Sangha's behind-the-meter model and flexible load capabilities position us to help Brown Equity Group navigate these market dynamics.

2. Carlos Mendez
   Title: Managing Director & CoFounder | Company: Crayhill | Email: cherrera@crayhill.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Carlos Mendez is Managing Director & CoFounder at Crayhill. Given their industry focus, the recent developments around Bitfarms Deleverages, Unveils Keel Rebrand as... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Bitfarms Deleverages, Unveils Keel..., Sangha's behind-the-meter model and flexible load capabilities position us to help Crayhill navigate these market dynamics.

3. Gary Blitz
   Title: Global Co-CEO of M&A and Transaction Solutions/Global Head of Tax | Company: Aon | Email: gary.blitz@aon.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Gary Blitz is Global Co-CEO of M&A and Transaction Solutions/Global Head of Tax at Aon. Given their industry focus, the recent developments around Bitfarms Deleverages, Unveils Keel Rebrand as... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Bitfarms Deleverages, Unveils Keel..., Sangha's behind-the-meter model and flexible load capabilities position us to help Aon navigate these market dynamics.

4. Doug Beebe
   Title: Senior Vice President, Clean Energy | Company: Key Equipment Finance | Email: douglas_beebe@key.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Doug Beebe is Senior Vice President, Clean Energy at Key Equipment Finance. Given their industry focus, the recent developments around Bitfarms Deleverages, Unveils Keel Rebrand as... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Bitfarms Deleverages, Unveils Keel..., Sangha's behind-the-meter model and flexible load capabilities position us to help Key Equipment Finance navigate these market dynamics.

5. Peter Hennessy
   Title: Co-founder and Board Director | Company: Enfinity Global | Email: phennessy@enfinityglobal.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Peter Hennessy is Co-founder and Board Director at Enfinity Global. Given their industry focus, the recent developments around Bitfarms Deleverages, Unveils Keel Rebrand as... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Bitfarms Deleverages, Unveils Keel..., Sangha's behind-the-meter model and flexible load capabilities position us to help Enfinity Global navigate these market dynamics.

6. Michael Avidan
   Title: President & VP, Enlight Renewable Energy LLC | Company: Clenera, an Enlight Company | Email: michaela@enlightenergy.us
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Michael Avidan is President & VP, Enlight Renewable Energy LLC at Clenera, an Enlight Company. Given their industry focus, the recent developments around Miner Weekly: ERCOT Hits Reset on Texas' AI and... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Miner Weekly: ERCOT Hits Reset on..., Sangha's behind-the-meter model and flexible load capabilities position us to help Clenera, an Enlight Company navigate these market dynamics.

7. Bill Gallagher
   Title: Senior Vice President, Director Project Finance - Renewable Energy Investments | Company: U.S. Bancorp Community Development Corporation | Email: bill.gallagher@usbank.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Bill Gallagher is Senior Vice President, Director Project Finance - Renewable Energy Investments at U.S. Bancorp Community Development Corporation. Given their industry focus, the recent developments around Miner Weekly: ERCOT Hits Reset on Texas' AI and... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Miner Weekly: ERCOT Hits Reset on..., Sangha's behind-the-meter model and flexible load capabilities position us to help U.S. Bancorp Community Development Corporation navigate these market dynamics.

8. Larry E. Keith
   Title: Vice President & Managing Director of U.S. Renewables | Company: Solvent Energy | Email: lk@jcmontfort.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Larry E. Keith is Vice President & Managing Director of U.S. Renewables at Solvent Energy. Given their industry focus, the recent developments around Miner Weekly: ERCOT Hits Reset on Texas' AI and... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Miner Weekly: ERCOT Hits Reset on..., Sangha's behind-the-meter model and flexible load capabilities position us to help Solvent Energy navigate these market dynamics.

9. Patrick Monino
   Title: President and CEO, Head Renewable Business North America | Company: Eni New Energy US, Inc. | Email: patrick.monino@eniplenitude.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Patrick Monino is President and CEO, Head Renewable Business North America at Eni New Energy US, Inc. Given their industry focus, the recent developments around Miner Weekly: ERCOT Hits Reset on Texas' AI and... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SANGHA VALUE PROP: Given the recent news about Miner Weekly: ERCOT Hits Reset on..., Sangha's behind-the-meter model and flexible load capabilities position us to help Eni New Energy US, Inc. navigate these market dynamics.


DRAFT OUTREACH MESSAGES
────────────────────────────────────────

Draft 1: Chris Brown (Brown Equity Group)
Subject: Bitcoin mining margins squeeze - energy efficiency matters more than ever
Body: Chris, Saw the Bitfarms deleveraging news - margins below $30/PH/s are forcing real operational changes across the industry. At Sangha Renewables, we're helping miners maintain profitability through integrated renewable energy solutions that cut power costs by 40-60%. The operators surviving this downturn are those who control their energy stack. Worth exploring how this applies to Brown Equity's portfolio companies? Best, Spencer
Words: 61 | Hook: Bitfarms Deleverages, Unveils Keel Rebrand as Bitcoin Mining Margins Sink Below $30/PH/s

Draft 2: Carlos Mendez (Crayhill)
Subject: Bitcoin mining margins & energy strategy
Body: Hi Carlos, Saw the Bitfarms deleveraging news - margins dropping below $30/PH/s is putting real pressure on the mining sector. At Sangha Renewables, we're working with mining operations to restructure their energy costs and improve unit economics through renewable integration. Given Crayhill's portfolio focus, curious if you're seeing similar margin compression themes across your investments. Best, Spencer
Words: 57 | Hook: Bitfarms Deleverages, Unveils Keel Rebrand as Bitcoin Mining Margins Sink Below $30/PH/s

Draft 3: Gary Blitz (Aon)
Subject: Bitcoin mining consolidation accelerating
Body: Gary, Bitfarms' recent deleveraging and rebrand signals broader consolidation in bitcoin mining as margins compress below $30/PH/s. Companies are restructuring operations and seeking strategic alternatives. At Sangha Renewables, we're seeing increased interest from miners exploring energy partnerships and operational restructuring to weather this downturn. Would be interested in your perspective on how tax considerations are shaping these transactions. Best, Spencer
Words: 60 | Hook: Bitfarms Deleverages, Unveils Keel Rebrand as Bitcoin Mining Margins Sink Below $30/PH/s

Draft 4: Doug Beebe (Key Equipment Finance)
Subject: Bitcoin mining margins at $30/PH/s - financing challenges ahead
Body: Doug, Saw the Bitfarms deleveraging news - margins dropping below $30/PH/s is creating real pressure across the mining sector. Companies are scrambling to restructure financing while maintaining operations. At Sangha Renewables, we're seeing increased interest in our energy-integrated mining solutions as operators look for ways to reduce power costs and improve unit economics. Would be curious to hear your perspective on how this margin compression is affecting equipment financing demand.
Words: 70 | Hook: Bitfarms Deleverages, Unveils Keel Rebrand as Bitcoin Mining Margins Sink Below $30/PH/s

Draft 5: Michael Avidan (Clenera, an Enlight Company)
Subject: Texas grid dynamics + bitcoin mining
Body: Hi Michael, Saw the recent coverage on ERCOT's queue reset affecting AI and mining projects. At Sangha Renewables, we're working with bitcoin miners who need reliable renewable energy partnerships that can navigate these grid complexities. Given Clenera's Texas presence and renewable expertise, there might be some interesting alignment around flexible load solutions. Would you be open to a brief conversation? Best, Spencer
Words: 63 | Hook: Miner Weekly: ERCOT Hits Reset on Texas' AI and Mining Power Queue

Draft 6: Larry E. Keith (Solvent Energy)
Subject: ERCOT queue reset implications
Body: Larry, Saw the recent ERCOT queue reset news and its potential impact on data center and mining projects in Texas. At Sangha Renewables, we're navigating similar grid interconnection challenges while developing Bitcoin mining operations paired with renewable energy. Would be interested in your perspective on how this affects renewable developers' strategies moving forward. Best regards, Spencer
Words: 57 | Hook: Miner Weekly: ERCOT Hits Reset on Texas' AI and Mining Power Queue

Draft 7: Patrick Monino (Eni New Energy US, Inc.)
Subject: ERCOT queue changes - impact on renewable partnerships
Body: Patrick, Saw the recent ERCOT reset affecting AI and mining power queues in Texas. At Sangha Renewables, we're navigating similar grid interconnection challenges while pairing Bitcoin mining operations with renewable energy projects. Given Eni's North American renewable portfolio, curious about your perspective on these market shifts and whether there might be alignment opportunities. Best regards, Spencer
Words: 57 | Hook: Miner Weekly: ERCOT Hits Reset on Texas' AI and Mining Power Queue


════════════════════════════════════════════════════════════

PART 2: RENEWABLES MARKET DYNAMICS
────────────────────────────────────────

Potential Customers - Solar, Wind, Battery, Hydro IPPs

CUSTOMER/TARGET SNAPSHOT
Target 1: Zelestra | Sector: Solar | Activity: Meta signs solar PPA with Zelestra in Texas for clean energy supply | Opportunity: growth | Why Relevant: Texas solar projects frequently face curtailment due to transmission constraints and negative pricing during peak generation. Sangha can partner with Zelestra to monetize curtailed energy through behind-the-meter mining.
Target 2: Origis Energy | Sector: Solar | Activity: Crux closes $340 million tax equity investment for Origis Energy's Texas utility-scale solar development | Opportunity: growth | Why Relevant: Texas utility-scale solar projects regularly face curtailment and negative pricing due to transmission bottlenecks. Sangha can help Origis maximize returns by monetizing curtailed energy.
Target 3: Stardust Solar | Sector: Solar | Activity: Stardust Solar is developing utility-scale solar projects with focus on long-term sustainability strategy | Opportunity: growth | Why Relevant: Stardust may face grid constraints or curtailment on their utility-scale projects. Sangha can offer behind-the-meter Bitcoin mining to monetize excess generation.
Target 4: Arevon Energy | Sector: Solar | Activity: Arevon Energy is expanding utility-scale solar-plus-storage projects in the U.S. | Opportunity: growth | Why Relevant: Even with storage, solar projects can face curtailment during extended sunny periods when batteries are full. Sangha's behind-the-meter mining can provide additional load.
Target 5: Scatec | Sector: Solar | Activity: Scatec secures 25-year PPA for 120 MW solar facility in Tunisia | Opportunity: growth | Why Relevant: Limited near-term opportunity due to international location and regulatory uncertainties around Bitcoin mining in Tunisia.


DISTRESS SIGNALS:
• ERCOT wind volatility requiring futures hedging
• Texas transmission constraints affecting solar development
• Need for revenue optimization beyond storage arbitrage

GROWTH SIGNALS:
• Major tax equity investments in utility-scale solar
• Corporate tech companies signing large renewable PPAs
• Multi-GWh energy storage deals
• International renewable project development


TOP RENEWABLES NEWS
────────────────────────────────────────

1. Meta Inks Solar Energy Purchase Agreement with Zelestra in Texas - ESG Today
   [high] [opportunity]

   Why it matters: Large corporate PPAs in Texas indicate significant new solar capacity, but ERCOT's grid constraints often lead to curtailment and negative pricing events.
   Sangha opportunity: Texas solar projects frequently face curtailment due to transmission constraints and negative pricing during peak generation. Sangha can partner with Zelestra to monetize curtailed energy through behind-the-meter mining, improving project returns while Meta still receives their contracted clean energy.
   Actionability: Reach out to Zelestra immediately about optimizing their Texas solar project economics through flexible load solutions

2. Enwex ERCOT Onshore Wind Futures Now Live for Trading on Abaxx Exchange - GlobeNewswire
   [high] [opportunity]

   Why it matters: The launch of wind futures trading signals significant price volatility and revenue uncertainty in ERCOT wind generation, suggesting curtailment and negative pricing issues.
   Sangha opportunity: ERCOT wind farms clearly face revenue volatility and curtailment risk, creating perfect conditions for Sangha's flexible load solution. Behind-the-meter mining can provide guaranteed revenue during negative pricing events and curtailment periods, reducing the need for expensive hedging instruments.
   Actionability: Research ERCOT wind farm owners and operators immediately - this futures market launch indicates acute revenue optimization needs

3. Crux closes $340 million tax equity investment for Origis Energy's Texas utility-scale solar development - renewableenergymagazine.com
   [high] [opportunity]

   Why it matters: Large-scale solar development in Texas faces well-documented grid constraints and curtailment issues that could impact investor returns.
   Sangha opportunity: Texas utility-scale solar projects regularly face curtailment and negative pricing due to transmission bottlenecks. Sangha can help Origis maximize returns on this significant investment by monetizing curtailed energy through behind-the-meter mining, protecting investor returns and improving project economics.
   Actionability: Contact Origis Energy development team immediately about revenue optimization for their Texas solar portfolio

4. Stardust Solar Aligns Utility-Scale Project Development with Long-Term Sustainability Strategy - Investing News Network
   [medium] [opportunity]

   Why it matters: Utility-scale solar development indicates significant new capacity coming online that may face grid interconnection delays or curtailment issues.
   Sangha opportunity: Stardust may face grid constraints or curtailment on their utility-scale projects. Sangha can offer behind-the-meter Bitcoin mining to monetize excess generation during peak production periods, improving project economics and providing flexible load management.
   Actionability: Research Stardust Solar's project pipeline and reach out to development team about revenue optimization solutions

5. Utility-Scale Solar-Plus-Storage Project Highlights Arevon Energy's Expansion in U.S. Renewables - TipRanks
   [medium] [opportunity]

   Why it matters: Solar-plus-storage combinations suggest awareness of grid integration challenges and need for additional revenue streams beyond storage arbitrage.
   Sangha opportunity: Even with storage, solar projects can face curtailment during extended sunny periods when batteries are full. Sangha's behind-the-meter mining can provide additional load during these periods, maximizing asset utilization and creating incremental revenue streams.
   Actionability: Add Arevon Energy to target list and research their current project locations for curtailment risk assessment


RENEWABLES OUTREACH RECOMMENDATIONS
────────────────────────────────────────

1. Michael Avidan
   Title: President & VP, Enlight Renewable Energy LLC | Company: Clenera, an Enlight Company | Email: michaela@enlightenergy.us
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Michael Avidan is President & VP, Enlight Renewable Energy LLC at Clenera, an Enlight Company. Given their industry focus, the recent developments around Meta Inks Solar Energy Purchase Agreement with... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SALES ANGLE: Given the recent news about Meta Inks Solar Energy Purchase..., Sangha's behind-the-meter model and flexible load capabilities position us to help Clenera, an Enlight Company navigate these market dynamics.

2. Bill Gallagher
   Title: Senior Vice President, Director Project Finance - Renewable Energy Investments | Company: U.S. Bancorp Community Development Corporation | Email: bill.gallagher@usbank.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Bill Gallagher is Senior Vice President, Director Project Finance - Renewable Energy Investments at U.S. Bancorp Community Development Corporation. Given their industry focus, the recent developments around Meta Inks Solar Energy Purchase Agreement with... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SALES ANGLE: Given the recent news about Meta Inks Solar Energy Purchase..., Sangha's behind-the-meter model and flexible load capabilities position us to help U.S. Bancorp Community Development Corporation navigate these market dynamics.

3. Larry E. Keith
   Title: Vice President & Managing Director of U.S. Renewables | Company: Solvent Energy | Email: lk@jcmontfort.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Larry E. Keith is Vice President & Managing Director of U.S. Renewables at Solvent Energy. Given their industry focus, the recent developments around Meta Inks Solar Energy Purchase Agreement with... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SALES ANGLE: Given the recent news about Meta Inks Solar Energy Purchase..., Sangha's behind-the-meter model and flexible load capabilities position us to help Solvent Energy navigate these market dynamics.

4. Patrick Monino
   Title: President and CEO, Head Renewable Business North America | Company: Eni New Energy US, Inc. | Email: patrick.monino@eniplenitude.com
   Trigger: News-triggered | Last Contact: Never
   WHY REACH OUT NOW: Patrick Monino is President and CEO, Head Renewable Business North America at Eni New Energy US, Inc. Given their industry focus, the recent developments around Meta Inks Solar Energy Purchase Agreement with... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SALES ANGLE: Given the recent news about Meta Inks Solar Energy Purchase..., Sangha's behind-the-meter model and flexible load capabilities position us to help Eni New Energy US, Inc. navigate these market dynamics.

5. Sandeep Arora
   Title: Senior Vice President, Head of Transmission & Markets | Company: REV Renewables | Email: sarora@revrenewables.com
   Trigger: News-triggered | Last Contact: 375 days ago
   WHY REACH OUT NOW: Sandeep Arora is Senior Vice President, Head of Transmission & Markets at REV Renewables. Given their industry focus, the recent developments around Meta Inks Solar Energy Purchase Agreement with... present a relevant touchpoint to discuss how market shifts could affect their business and where Sangha might add value.
   SALES ANGLE: Given the recent news about Meta Inks Solar Energy Purchase..., Sangha's behind-the-meter model and flexible load capabilities position us to help REV Renewables navigate these market dynamics.


RENEWABLES DRAFT OUTREACH MESSAGES
────────────────────────────────────────

Draft 1: Michael Avidan (Clenera, an Enlight Company)
Subject: Behind-the-meter optimization for renewable assets
Body: Hi Michael, With renewed focus on solar PPAs like Meta's recent Zelestra agreement, maximizing asset utilization becomes critical. Sangha helps renewable developers monetize curtailed energy through behind-the-meter Bitcoin mining-creating flexible load that ramps instantly with generation while avoiding grid constraints. Given Clenera's portfolio scale, this could transform economics on projects facing curtailment or transmission limitations. Would you be open to a brief call to explore applications for your pipeline? Best regards, Spencer
Words: 72 | Hook: Meta Inks Solar Energy Purchase Agreement with Zelestra in Texas

Draft 2: Larry E. Keith (Solvent Energy)
Subject: Exploring flexible load solutions for renewable portfolio optimization
Body: Larry, With Meta's recent Texas solar agreement highlighting the growing demand for corporate renewable energy, I'm curious about Solvent Energy's approach to managing curtailment and grid constraints in your portfolio. At Sangha Renewables, we help developers monetize stranded energy through behind-the-meter flexible loads that can instantly ramp up/down with generation variability. Would you be open to a brief call to explore how this might apply to your current projects? Best, Spencer
Words: 71 | Hook: Meta Inks Solar Energy Purchase Agreement with Zelestra in Texas

Draft 3: Patrick Monino (Eni New Energy US, Inc.)
Subject: Monetizing curtailed renewable capacity - exploring synergies
Body: Patrick, With Eni's expanding North American renewable portfolio, you're likely encountering curtailment challenges and grid constraints that impact project economics. We're helping renewables operators turn stranded energy into revenue through behind-the-meter flexible load solutions that ramp instantly with generation variability - essentially converting curtailed capacity into profitable operations without grid dependencies. Would you be open to a brief call to explore potential applications for your projects?
Words: 66 | Hook: Meta Inks Solar Energy Purchase Agreement with Zelestra in Texas

Draft 4: Sandeep Arora (REV Renewables)
Subject: Optimizing curtailed energy economics at REV Renewables
Body: Hi Sandeep, With ERCOT's growing renewable capacity and trading innovations like the new Enwex futures, managing curtailment economics becomes increasingly critical. We've been helping renewables operators monetize stranded energy through flexible, behind-the-meter Bitcoin mining that ramps instantly with your generation curves-turning curtailed MWh into revenue streams without grid constraints. Would you be open to a brief call to explore how this might apply to REV's portfolio? Best regards, Spencer
Words: 70 | Hook: Meta Inks Solar Energy Purchase Agreement with Zelestra in Texas


NEXT STEPS
────────────────────────────────────────
- Review competitor snapshot and flag any concerning moves
- Review renewables targets for sales opportunities
- Review outreach lists and flag any contacts to exclude
- Approve messages or request edits
- Send within 24 hours for time-sensitive opportunities

Market Signal Check: Bitcoin mining industry faces severe profitability crisis with widespread shutdowns and record losses. This creates significant consolidation opportunity favoring lowest-cost operators. Texas regulatory changes add complexity to expansion plans but may limit new competition.
Competitive Posture: Sangha remains well-positioned in the renewable energy mining space.`,

  '2026-02-02': `\u26a1 Weekly Intel: Feb 2, 2026 \u2013 Mining Market Dynamics
============================================================
Generated: Feb 2, 2026 8:37 PM EST

COMPETITOR SNAPSHOT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Key Competitor Actions (Last 24-72 Hours):
\u2022 CleanSpark (CLSK): CleanSpark is expanding data center operations in Texas beyond Bitcoin mining to diversify revenue streams.
  Strategic Read: Competitor diversification in Sangha's key geographic market could impact utility relationship development.
  Risk: CleanSpark expanding in Texas could compete for the same utility partnerships and behind-the-meter opportunities that are core to Sangha's Texas pipeline growth strategy.
  Sangha Implication: CleanSpark's Texas data center push may compete for the same utility partnerships and behind-the-meter sites Sangha targets. However, their split focus between mining and data centers creates opportunities for Sangha to secure pure mining partnerships with utilities seeking dedicated Bitcoin mining load.

\u2022 Bitdeer (BTDR): Bitdeer Technologies faces divided Wall Street analyst opinions despite potential upside, indicating market uncertainty about their strategy.
  Strategic Read: Market uncertainty around Bitdeer suggests lack of clear strategic direction compared to focused competitors.
  Sangha Implication: Bitdeer's unclear strategic direction and divided analyst sentiment suggests they may struggle to compete effectively against Sangha's focused pure-play mining strategy. This creates opportunities for Sangha to capture market share and investor confidence in the Bitcoin mining space.

\u2022 Riot Platforms (RIOT): Riot Platforms entered into a lease agreement with AMD to pivot portions of their operations toward AI data center revenues.
  Strategic Read: Major Bitcoin miner pivoting to AI/HPC represents reduced competition in pure-play mining space.
  Sangha Implication: Riot's pivot away from Bitcoin mining will reduce network difficulty over time, directly increasing Sangha's mining profitability and margins. This validates Sangha's pure-play mining strategy.


Trending Themes:
\u2022 AI infrastructure pivot trend
\u2022 Texas market competition
\u2022 Mining industry consolidation


Our Positioning: Mixed signals - competitors diversifying away from mining opens opportunities, but Texas market competition intensifying.`,

  '2026-01-29': `\u26a1 Weekly Intel: Jan 29, 2026 \u2013 Mining Market Dynamics
============================================================
Generated: Jan 29, 2026 8:49 PM EST

COMPETITOR SNAPSHOT
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

Key Moves (Last 24-72 Hours):
\u2022 Cipher Mining (CIFR): Cipher Mining Turns To AI And Cloud With Amazon AWS Deal - simplywall.st
  Strategic Read: Cipher Mining securing breakthrough cloud partnership with Amazon AWS, accessing massive enterprise AI market through premier hyperscaler.
  Sangha Implication: Cipher Mining securing breakthrough cloud partnership with Amazon AWS, accessing massive enterprise AI market through premier hyperscaler.

\u2022 Hut 8 (HUT): Assessing Hut 8 (HUT) Valuation As AI Infrastructure Pivot Attracts Fresh Institutional Interest - simplywall.st
  Strategic Read: Hut 8's AI infrastructure pivot attracting fresh institutional investment interest, showing successful repositioning strategy.
  Sangha Implication: Hut 8's AI infrastructure pivot attracting fresh institutional investment interest, showing successful repositioning strategy.

\u2022 TeraWulf (WULF): TeraWulf Texas HPC Pivot Recasts Bitcoin Miner As AI Infrastructure Play - simplywall.st
  Strategic Read: TeraWulf establishing Texas HPC operations for AI workloads, competing directly in key geographic and technology markets.
  Sangha Implication: TeraWulf establishing Texas HPC operations for AI workloads, competing directly in key geographic and technology markets.

\u2022 CleanSpark (CLSK): CleanSpark Texas Land Move Puts AI Data Center Ambitions In Focus - simplywall.st
  Strategic Read: CleanSpark expanding into Texas with AI data center focus, entering key geographic market with dual-use infrastructure strategy.
  Sangha Implication: CleanSpark expanding into Texas with AI data center focus, entering key geographic market with dual-use infrastructure strategy.

\u2022 Riot Platforms (RIOT): Riot Platforms Recasts Bitcoin Mining Story With AMD AI Data Center Deal - Yahoo Finance
  Strategic Read: Riot securing major AI infrastructure partnership with AMD, diversifying beyond pure Bitcoin mining into high-growth AI data center market.
  Sangha Implication: Riot securing major AI infrastructure partnership with AMD, diversifying beyond pure Bitcoin mining into high-growth AI data center market.


Trending Themes:
\u2022 Grid stability and demand response
\u2022 Mining industry consolidation
\u2022 AI and data center integration
\u2022 Bitcoin miner to AI infrastructure pivot


Our Positioning: Competitive pressure increasing - several moves require strategic response.

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

TOP NEWS ITEMS
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500


1. Grid reliability projected to decline as data centers drive demand, watchdog says - The Hill
   [credible] [near_term] [high] [risk]

   Why it matters: Growing data center demand threatening grid reliability could trigger regulatory responses affecting all large-load consumers including mining operations.
   Sangha impact: Could result in stricter interconnection requirements or load limitations that impact expansion plans. Behind-the-meter model provides natural hedge against grid-level regulatory changes.
   Actionability: Track NERC and ERCOT policy discussions on data center interconnection rules`,
};

// ─── Report Parser & Modal ──────────────────────────────────────────────────

const TAG_COLORS = {
  credible:    { bg: '#edf7f0', text: '#1a6b3c', border: '#d0e8d8' },
  near_term:   { bg: '#fdf6e8', text: '#b8860b', border: '#f0e0b0' },
  high:        { bg: '#fdedf0', text: '#dc3545', border: '#f0c5cc' },
  risk:        { bg: '#fdedf0', text: '#dc3545', border: '#f0c5cc' },
  opportunity: { bg: '#e8eef5', text: '#2c5282', border: '#c5d5e8' },
  new:         { bg: '#f3eef8', text: '#5b3a8c', border: '#d8cce8' },
};

function parseReport(raw) {
  if (!raw) return null;

  const lines = raw.split('\n');
  const report = {
    title: '',
    generated: '',
    competitorSnapshot: {
      keyMoves: [],
      themes: [],
      positioning: '',
    },
    newsItems: [],
    outreach: {
      stats: { total: 0, highPriority: 0, competitorTriggered: 0, reEngagements: 0 },
      contacts: [],
      draftMessages: [],
    },
    renewables: {
      targets: [],
      distressSignals: [],
      growthSignals: [],
      newsItems: [],
      outreachContacts: [],
      draftMessages: [],
      nextSteps: [],
      marketSignal: '',
      competitivePosture: '',
    },
  };

  // Extract title (first non-empty line)
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.match(/^[=\u2500]+$/)) {
      report.title = trimmed.replace(/^\u26a1\s*/, '');
      break;
    }
  }

  // Extract generated date
  const genMatch = raw.match(/Generated:\s*(.+)/);
  if (genMatch) report.generated = genMatch[1].trim();

  // Find sections by looking for the dividers
  const sectionBreak = '\u2500'.repeat(40);

  // Parse competitor snapshot section
  const compStart = raw.indexOf('COMPETITOR SNAPSHOT');
  const newsStart = raw.indexOf('TOP NEWS ITEMS');

  if (compStart !== -1) {
    const compEnd = newsStart !== -1 ? newsStart : raw.length;
    const compSection = raw.substring(compStart, compEnd);

    // Extract competitor bullet points
    const bulletRegex = /\u2022\s+(.+?)(?=\n\u2022|\nTrending Themes|\nOur Positioning|\n\u2500|$)/gs;
    let match;
    while ((match = bulletRegex.exec(compSection)) !== null) {
      const block = match[1].trim();
      const tickerMatch = block.match(/^(.+?)\s*\(([A-Z]+)\):\s*/);
      const competitor = {
        name: tickerMatch ? tickerMatch[1] : '',
        ticker: tickerMatch ? tickerMatch[2] : '',
        headline: '',
        strategicRead: '',
        sanghaImplication: '',
        risk: '',
      };

      const rest = tickerMatch ? block.substring(tickerMatch[0].length) : block;
      // Check if it's a theme line (no colon fields)
      if (!rest.includes('Strategic Read:') && !rest.includes('Sangha Implication:') && !rest.includes('Risk:')) {
        // It's a trending theme, skip
        continue;
      }

      // Split into headline and fields
      const srIdx = rest.indexOf('Strategic Read:');
      const siIdx = rest.indexOf('Sangha Implication:');
      const riskIdx = rest.indexOf('Risk:');

      if (srIdx !== -1) {
        competitor.headline = rest.substring(0, srIdx).trim();
        const srEnd = riskIdx !== -1 && riskIdx > srIdx ? riskIdx : (siIdx !== -1 ? siIdx : rest.length);
        competitor.strategicRead = rest.substring(srIdx + 'Strategic Read:'.length, srEnd).trim();
      } else {
        competitor.headline = rest.trim();
      }

      if (riskIdx !== -1) {
        const rEnd = siIdx !== -1 && siIdx > riskIdx ? siIdx : rest.length;
        competitor.risk = rest.substring(riskIdx + 'Risk:'.length, rEnd).trim();
      }

      if (siIdx !== -1) {
        competitor.sanghaImplication = rest.substring(siIdx + 'Sangha Implication:'.length).trim();
      }

      if (competitor.name || competitor.headline) {
        report.competitorSnapshot.keyMoves.push(competitor);
      }
    }

    // Extract trending themes
    const themesMatch = compSection.match(/Trending Themes:\n([\s\S]*?)(?=\n\nOur Positioning|\n\u2500|$)/);
    if (themesMatch) {
      const themeLines = themesMatch[1].split('\n').filter(l => l.trim().startsWith('\u2022'));
      report.competitorSnapshot.themes = themeLines.map(l => {
        const text = l.replace(/^\u2022\s*/, '').trim();
        const tagMatch = text.match(/\[([^\]]+)\]/);
        return { text: text.replace(/\s*\[[^\]]+\]\s*/g, '').trim(), tag: tagMatch ? tagMatch[1] : null };
      });
    }

    // Extract positioning
    const posMatch = compSection.match(/Our Positioning:\s*(.+)/);
    if (posMatch) report.competitorSnapshot.positioning = posMatch[1].trim();
  }

  // Parse news items
  if (newsStart !== -1) {
    const newsSection = raw.substring(newsStart);
    const itemRegex = /(\d+)\.\s+(.+?)(?:\n\s+Source:[^\n]*)?(?:\n\s+(\[.+?\]))\n([\s\S]*?)(?=\n\d+\.\s|\n\u2500|$)/g;
    let newsMatch;
    while ((newsMatch = itemRegex.exec(newsSection)) !== null) {
      const num = parseInt(newsMatch[1]);
      const headline = newsMatch[2].trim();
      const tagsStr = newsMatch[3] || '';
      const body = newsMatch[4].trim();

      // Parse tags
      const tags = [];
      const tagRegex = /\[([^\]]+)\]/g;
      let tagMatch;
      while ((tagMatch = tagRegex.exec(tagsStr)) !== null) {
        tags.push(tagMatch[1]);
      }

      // Parse fields from body
      const whyMatch = body.match(/Why it matters:\s*([\s\S]*?)(?=\n\s+Sangha impact:|$)/);
      const sanghaMatch = body.match(/Sangha impact:\s*([\s\S]*?)(?=\n\s+Actionability:|$)/);
      const actionMatch = body.match(/Actionability:\s*([\s\S]*?)$/);

      // Extract source from headline
      const sourceMatch = headline.match(/\s*-\s*([^-]+)$/);
      const source = sourceMatch ? sourceMatch[1].trim() : '';
      const cleanHeadline = sourceMatch ? headline.substring(0, headline.lastIndexOf(' - ')).trim() : headline;

      report.newsItems.push({
        number: num,
        headline: cleanHeadline,
        source,
        tags,
        whyItMatters: whyMatch ? whyMatch[1].trim() : '',
        sanghaImpact: sanghaMatch ? sanghaMatch[1].trim() : '',
        actionability: actionMatch ? actionMatch[1].trim() : '',
      });
    }
  }

  // ─── Parse Recommended Outreach ───
  const outreachStart = raw.indexOf('RECOMMENDED OUTREACH');
  const draftMsgStart = raw.indexOf('DRAFT OUTREACH MESSAGES');
  const part2Start = raw.indexOf('PART 2: RENEWABLES');

  if (outreachStart !== -1) {
    const outreachEnd = draftMsgStart !== -1 ? draftMsgStart : (part2Start !== -1 ? part2Start : raw.length);
    const outreachSection = raw.substring(outreachStart, outreachEnd);

    // Parse stats line
    const statsMatch = outreachSection.match(/Stats:\s*Total Contacts:\s*(\d+)\s*\|\s*High Priority:\s*(\d+)\s*\|\s*Competitor-Triggered:\s*(\d+)\s*\|\s*Re-Engagements:\s*(\d+)/);
    if (statsMatch) {
      report.outreach.stats = {
        total: parseInt(statsMatch[1]),
        highPriority: parseInt(statsMatch[2]),
        competitorTriggered: parseInt(statsMatch[3]),
        reEngagements: parseInt(statsMatch[4]),
      };
    }

    // Parse contact cards
    const contactRegex = /(\d+)\.\s+(.+?)\n\s+Title:\s*(.+?)\s*\|\s*Company:\s*(.+?)\s*\|\s*Email:\s*(.+?)\n\s+Trigger:\s*(.+?)\s*\|\s*Last Contact:\s*(.+?)\n\s+WHY REACH OUT NOW:\s*([\s\S]*?)(?:\n\s+SANGHA VALUE PROP:\s*([\s\S]*?))?(?=\n\n\d+\.\s|\nDRAFT OUTREACH|\nPART 2|\n═|$)/g;
    let contactMatch;
    while ((contactMatch = contactRegex.exec(outreachSection)) !== null) {
      report.outreach.contacts.push({
        name: contactMatch[2].trim(),
        title: contactMatch[3].trim(),
        company: contactMatch[4].trim(),
        email: contactMatch[5].trim(),
        trigger: contactMatch[6].trim(),
        lastContact: contactMatch[7].trim(),
        whyReachOut: contactMatch[8].trim(),
        valueProp: contactMatch[9] ? contactMatch[9].trim() : '',
      });
    }
  }

  // ─── Parse Draft Outreach Messages ───
  if (draftMsgStart !== -1) {
    const draftEnd = part2Start !== -1 ? part2Start : raw.length;
    const draftSection = raw.substring(draftMsgStart, draftEnd);

    const draftRegex = /Draft \d+:\s*(.+?)\s*\((.+?)\)\nSubject:\s*(.+?)\nBody:\s*([\s\S]*?)\nWords:\s*(\d+)\s*\|\s*Hook:\s*(.+?)(?=\n\nDraft \d+|\n\n═|\n\nPART 2|$)/g;
    let draftMatch;
    while ((draftMatch = draftRegex.exec(draftSection)) !== null) {
      report.outreach.draftMessages.push({
        contactName: draftMatch[1].trim(),
        company: draftMatch[2].trim(),
        subject: draftMatch[3].trim(),
        body: draftMatch[4].trim(),
        wordCount: parseInt(draftMatch[5]),
        hook: draftMatch[6].trim(),
      });
    }
  }

  // ─── Parse Renewables Section ───
  if (part2Start !== -1) {
    const renewSection = raw.substring(part2Start);

    // Parse targets
    const targetRegex = /Target \d+:\s*(.+?)\s*\|\s*Sector:\s*(.+?)\s*\|\s*Activity:\s*([\s\S]*?)\s*\|\s*Opportunity:\s*(.+?)\s*\|\s*Why Relevant:\s*([\s\S]*?)(?=\nTarget \d+|\n\nDISTRESS|$)/g;
    let targetMatch;
    while ((targetMatch = targetRegex.exec(renewSection)) !== null) {
      report.renewables.targets.push({
        company: targetMatch[1].trim(),
        sector: targetMatch[2].trim(),
        activity: targetMatch[3].trim(),
        opportunityType: targetMatch[4].trim(),
        whyRelevant: targetMatch[5].trim(),
      });
    }

    // Parse distress signals
    const distressMatch = renewSection.match(/DISTRESS SIGNALS:\n([\s\S]*?)(?=\nGROWTH SIGNALS:|$)/);
    if (distressMatch) {
      report.renewables.distressSignals = distressMatch[1].split('\n')
        .filter(l => l.trim().startsWith('\u2022'))
        .map(l => l.replace(/^\u2022\s*/, '').trim());
    }

    // Parse growth signals
    const growthMatch = renewSection.match(/GROWTH SIGNALS:\n([\s\S]*?)(?=\n\nTOP RENEWABLES|$)/);
    if (growthMatch) {
      report.renewables.growthSignals = growthMatch[1].split('\n')
        .filter(l => l.trim().startsWith('\u2022'))
        .map(l => l.replace(/^\u2022\s*/, '').trim());
    }

    // Parse renewables news
    const renewNewsStart = renewSection.indexOf('TOP RENEWABLES NEWS');
    const renewOutreachStart = renewSection.indexOf('RENEWABLES OUTREACH RECOMMENDATIONS');
    if (renewNewsStart !== -1) {
      const renewNewsEnd = renewOutreachStart !== -1 ? renewOutreachStart : renewSection.length;
      const renewNewsSection = renewSection.substring(renewNewsStart, renewNewsEnd);

      const newsRegex = /(\d+)\.\s+(.+?)(?:\n\s+Source:[^\n]*)?(?:\n\s+(\[.+?\]))\n([\s\S]*?)(?=\n\d+\.\s|\nRENEWABLES OUTREACH|$)/g;
      let rnMatch;
      while ((rnMatch = newsRegex.exec(renewNewsSection)) !== null) {
        const headline = rnMatch[2].trim();
        const tagsStr = rnMatch[3] || '';
        const body = rnMatch[4].trim();
        const tags = [];
        const tagRx = /\[([^\]]+)\]/g;
        let tM;
        while ((tM = tagRx.exec(tagsStr)) !== null) tags.push(tM[1]);

        const whyM = body.match(/Why it matters:\s*([\s\S]*?)(?=\n\s+Sangha opportunity:|$)/);
        const sanghaM = body.match(/Sangha opportunity:\s*([\s\S]*?)(?=\n\s+Actionability:|$)/);
        const actM = body.match(/Actionability:\s*([\s\S]*?)$/);

        const srcMatch = headline.match(/\s*-\s*([^-]+)$/);
        const source = srcMatch ? srcMatch[1].trim() : '';
        const cleanHL = srcMatch ? headline.substring(0, headline.lastIndexOf(' - ')).trim() : headline;

        report.renewables.newsItems.push({
          number: parseInt(rnMatch[1]),
          headline: cleanHL,
          source,
          tags,
          whyItMatters: whyM ? whyM[1].trim() : '',
          sanghaOpportunity: sanghaM ? sanghaM[1].trim() : '',
          actionability: actM ? actM[1].trim() : '',
        });
      }
    }

    // Parse renewables outreach contacts
    if (renewOutreachStart !== -1) {
      const renewDraftStart = renewSection.indexOf('RENEWABLES DRAFT OUTREACH');
      const renewContactEnd = renewDraftStart !== -1 ? renewDraftStart : renewSection.length;
      const renewContactSection = renewSection.substring(renewOutreachStart, renewContactEnd);

      const rcRegex = /(\d+)\.\s+(.+?)\n\s+Title:\s*(.+?)\s*\|\s*Company:\s*(.+?)\s*\|\s*Email:\s*(.+?)\n\s+Trigger:\s*(.+?)\s*\|\s*Last Contact:\s*(.+?)\n\s+WHY REACH OUT NOW:\s*([\s\S]*?)(?:\n\s+SALES ANGLE:\s*([\s\S]*?))?(?=\n\n\d+\.\s|\nRENEWABLES DRAFT|$)/g;
      let rcMatch;
      while ((rcMatch = rcRegex.exec(renewContactSection)) !== null) {
        report.renewables.outreachContacts.push({
          name: rcMatch[2].trim(),
          title: rcMatch[3].trim(),
          company: rcMatch[4].trim(),
          email: rcMatch[5].trim(),
          trigger: rcMatch[6].trim(),
          lastContact: rcMatch[7].trim(),
          whyReachOut: rcMatch[8].trim(),
          salesAngle: rcMatch[9] ? rcMatch[9].trim() : '',
        });
      }
    }

    // Parse renewables draft messages
    const renewDraftStart = renewSection.indexOf('RENEWABLES DRAFT OUTREACH');
    const nextStepsStart = renewSection.indexOf('NEXT STEPS');
    if (renewDraftStart !== -1) {
      const rdEnd = nextStepsStart !== -1 ? nextStepsStart : renewSection.length;
      const rdSection = renewSection.substring(renewDraftStart, rdEnd);

      const rdRegex = /Draft \d+:\s*(.+?)\s*\((.+?)\)\nSubject:\s*(.+?)\nBody:\s*([\s\S]*?)\nWords:\s*(\d+)\s*\|\s*Hook:\s*(.+?)(?=\n\nDraft \d+|\n\nNEXT STEPS|$)/g;
      let rdMatch;
      while ((rdMatch = rdRegex.exec(rdSection)) !== null) {
        report.renewables.draftMessages.push({
          contactName: rdMatch[1].trim(),
          company: rdMatch[2].trim(),
          subject: rdMatch[3].trim(),
          body: rdMatch[4].trim(),
          wordCount: parseInt(rdMatch[5]),
          hook: rdMatch[6].trim(),
        });
      }
    }

    // Parse next steps
    if (nextStepsStart !== -1) {
      const nsSection = renewSection.substring(nextStepsStart);
      const stepLines = nsSection.split('\n').filter(l => l.trim().startsWith('-'));
      report.renewables.nextSteps = stepLines.map(l => l.replace(/^-\s*/, '').trim());

      const mktMatch = nsSection.match(/Market Signal Check:\s*([\s\S]*?)(?=\nCompetitive Posture:|$)/);
      if (mktMatch) report.renewables.marketSignal = mktMatch[1].trim();

      const cpMatch = nsSection.match(/Competitive Posture:\s*([\s\S]*?)$/);
      if (cpMatch) report.renewables.competitivePosture = cpMatch[1].trim();
    }
  }

  return report;
}

function TagBadge({ tag }) {
  const key = tag.toLowerCase().replace(/\s+/g, '_');
  const colors = TAG_COLORS[key] || { bg: '#f5f4f0', text: '#666', border: '#e5e5e0' };
  return (
    <span
      className="inline-flex items-center px-2 py-[2px] rounded-full text-[10px] font-bold uppercase tracking-[0.5px]"
      style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
    >
      {tag}
    </span>
  );
}

// ─── Report Comments ────────────────────────────────────────────────────────

const REACTION_EMOJIS = ['👍', '🔥', '⚠️'];

function ReportCommentsSection({ reportId }) {
  const { user, tokens } = useAuth();
  const [comments, setComments] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [posting, setPosting] = useState(false);
  const [mentionUsers, setMentionUsers] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  const authHeaders = tokens?.accessToken
    ? { Authorization: `Bearer ${tokens.accessToken}` }
    : {};

  const fetchComments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch {}
  }, [reportId]);

  // Initial fetch + 30s polling
  useEffect(() => {
    fetchComments();
    const interval = setInterval(fetchComments, 30000);
    return () => clearInterval(interval);
  }, [fetchComments]);

  // Fetch users for @mention
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}/users`, { headers: authHeaders });
        if (res.ok) {
          const data = await res.json();
          setMentionUsers(data.users || []);
        }
      } catch {}
    })();
  }, [reportId]);

  // Auto-scroll on new comments
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [comments.length]);

  const handlePost = async () => {
    if (!newMessage.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: newMessage.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments(prev => [...prev, data.comment]);
        setNewMessage('');
      }
    } catch {}
    setPosting(false);
  };

  const handleReact = async (commentId, emoji) => {
    try {
      const res = await fetch(`${API_BASE}/v1/report-comments/${reportId}/${commentId}/react`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const data = await res.json();
        setComments(prev => prev.map(c => c.id === commentId ? data.comment : c));
      }
    } catch {}
  };

  const insertMention = (userName) => {
    const cursorPos = inputRef.current?.selectionStart || newMessage.length;
    const textBefore = newMessage.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0) {
      const before = newMessage.slice(0, atIdx);
      const after = newMessage.slice(cursorPos);
      setNewMessage(`${before}@${userName} ${after}`);
    }
    setShowMentions(false);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setNewMessage(val);
    // Check for @mention trigger
    const cursorPos = e.target.selectionStart;
    const textBefore = val.slice(0, cursorPos);
    const atIdx = textBefore.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || textBefore[atIdx - 1] === ' ')) {
      const query = textBefore.slice(atIdx + 1);
      if (!query.includes(' ')) {
        setMentionFilter(query.toLowerCase());
        setShowMentions(true);
        return;
      }
    }
    setShowMentions(false);
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  };

  const formatTime = (dateStr) => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h ago`;
      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) return `${diffDays}d ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  // Highlight @mentions in message text
  const renderMessage = (text) => {
    const parts = text.split(/(@\w+(?:\s\w+)?)/g);
    return parts.map((part, i) =>
      part.startsWith('@')
        ? <span key={i} style={{ color: '#2c5282', fontWeight: 600 }}>{part}</span>
        : part
    );
  };

  const INITIALS_COLORS = ['#2c5282', '#1a6b3c', '#5b3a8c', '#b8860b', '#dc3545', '#0d9488'];
  const getColor = (name) => {
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return INITIALS_COLORS[Math.abs(hash) % INITIALS_COLORS.length];
  };

  const filteredMentions = mentionUsers.filter(u =>
    u.name.toLowerCase().includes(mentionFilter)
  );

  // If no auth (demo mode), show placeholder
  if (!user) {
    return (
      <div style={{ borderTop: '1px solid #e8e8e3', padding: '16px 32px', background: '#fff' }}>
        <div className="flex items-center gap-2" style={{ color: '#999', fontSize: '12px' }}>
          <MessageCircle size={14} />
          <span>Sign in to comment on this report</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: '1px solid #e8e8e3', background: '#fff' }}>
      {/* Section header */}
      <div className="flex items-center gap-2 px-8 pt-4 pb-2">
        <MessageCircle size={14} style={{ color: '#999' }} />
        <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999' }}>
          Team Discussion
        </span>
        {comments.length > 0 && (
          <span style={{ fontSize: '10px', fontWeight: 600, color: '#fff', background: '#1a2e1a', borderRadius: '10px', padding: '1px 7px', minWidth: '18px', textAlign: 'center' }}>
            {comments.length}
          </span>
        )}
      </div>

      {/* Comments list */}
      <div ref={scrollRef} style={{ maxHeight: '240px', overflowY: 'auto', padding: '0 32px' }}>
        {comments.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: '#999', fontSize: '12px', fontStyle: 'italic' }}>
            No comments yet. Start the discussion.
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {comments.map(comment => {
              const color = getColor(comment.user_name);
              return (
                <div key={comment.id} className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: color + '18', color }}
                  >
                    <span style={{ fontSize: '10px', fontWeight: 700 }}>{getInitials(comment.user_name)}</span>
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#1a1a1a' }}>{comment.user_name}</span>
                      <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px', color: '#999', background: '#f5f4f0', padding: '1px 5px', borderRadius: '3px' }}>
                        {comment.user_role}
                      </span>
                      <span style={{ fontSize: '10px', color: '#bbb' }}>{formatTime(comment.created_at)}</span>
                    </div>
                    <p style={{ fontSize: '13px', color: '#333', lineHeight: 1.5, margin: 0 }}>
                      {renderMessage(comment.message)}
                    </p>
                    {/* Reactions */}
                    <div className="flex items-center gap-1 mt-1.5">
                      {REACTION_EMOJIS.map(emoji => {
                        const reacted = (comment.reactions?.[emoji] || []).includes(user.id);
                        const count = (comment.reactions?.[emoji] || []).length;
                        return (
                          <button
                            key={emoji}
                            onClick={() => handleReact(comment.id, emoji)}
                            className="flex items-center gap-1 transition-all"
                            style={{
                              fontSize: '12px', padding: '1px 6px', borderRadius: '12px',
                              background: reacted ? '#e8eef5' : 'transparent',
                              border: count > 0 ? '1px solid #e8e8e3' : '1px solid transparent',
                              cursor: 'pointer', opacity: count > 0 ? 1 : 0.4,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = '#f5f4f0'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = count > 0 ? '1' : '0.4'; e.currentTarget.style.background = reacted ? '#e8eef5' : 'transparent'; }}
                          >
                            <span>{emoji}</span>
                            {count > 0 && <span style={{ fontSize: '10px', fontWeight: 600, color: '#666' }}>{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="relative px-8 py-3" style={{ borderTop: '1px solid #f0eeea' }}>
        {/* @mention dropdown */}
        {showMentions && filteredMentions.length > 0 && (
          <div
            className="absolute bottom-full left-8 right-8 mb-1 rounded-lg shadow-lg overflow-hidden"
            style={{ background: '#fff', border: '1px solid #e8e8e3', zIndex: 10 }}
          >
            {filteredMentions.slice(0, 5).map(u => (
              <button
                key={u.id}
                onClick={() => insertMention(u.name.split(' ')[0])}
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                style={{ fontSize: '12px' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f5f4f0'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: getColor(u.name) + '18', color: getColor(u.name), fontSize: '9px', fontWeight: 700 }}
                >
                  {getInitials(u.name)}
                </div>
                <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{u.name}</span>
                <span style={{ color: '#999', fontSize: '10px' }}>{u.role}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: getColor(user.name) + '18', color: getColor(user.name) }}
          >
            <span style={{ fontSize: '9px', fontWeight: 700 }}>{getInitials(user.name)}</span>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
            placeholder="Add a comment... (use @ to mention)"
            style={{
              flex: 1, fontSize: '13px', padding: '8px 12px', borderRadius: '10px',
              border: '1px solid #e8e8e3', background: '#fafaf8', outline: 'none',
              fontFamily: "'DM Sans', sans-serif",
            }}
            onFocus={e => { e.target.style.borderColor = '#2dd478'; }}
            onBlur={e => { e.target.style.borderColor = '#e8e8e3'; }}
          />
          <button
            onClick={handlePost}
            disabled={!newMessage.trim() || posting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg transition-colors"
            style={{
              fontSize: '11px', fontWeight: 600, color: '#fff', background: '#1a2e1a',
              opacity: !newMessage.trim() || posting ? 0.4 : 1,
              cursor: !newMessage.trim() || posting ? 'default' : 'pointer',
            }}
          >
            <Send size={11} />
            Post
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportViewerModal({ file, onClose }) {
  const dateMatch = file.name.match(/(\d{4}-\d{2}-\d{2})/);
  const dateKey = dateMatch ? dateMatch[1] : null;
  const rawContent = dateKey ? REPORT_CONTENT[dateKey] : null;
  const report = parseReport(rawContent);
  const [toast, setToast] = useState(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Inject Google Fonts
  useEffect(() => {
    if (!document.querySelector('link[data-intel-fonts]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.dataset.intelFonts = '1';
      link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleExport = useCallback(() => {
    if (file.url) {
      window.open(file.url, '_blank', 'noopener,noreferrer');
      showToast('Opened in Google Docs');
    }
  }, [file.url, showToast]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  // Derive sentiment from positioning text
  const getSentimentTags = (report) => {
    if (!report) return [];
    const pos = report.competitorSnapshot.positioning.toLowerCase();
    const tags = [];
    if (pos.includes('opportunit') || pos.includes('open')) tags.push({ label: 'Opportunity', color: '#2c5282', bg: '#e8eef5' });
    if (pos.includes('stable') || pos.includes('advantage')) tags.push({ label: 'Bullish', color: '#1a6b3c', bg: '#edf7f0' });
    if (pos.includes('pressure') || pos.includes('intensif') || pos.includes('competitive')) tags.push({ label: 'Bearish', color: '#dc3545', bg: '#fdedf0' });
    if (pos.includes('mixed') || pos.includes('signal')) tags.push({ label: 'Mixed Signals', color: '#b8860b', bg: '#fdf6e8' });
    if (pos.includes('neutral') || pos.includes('monitor')) tags.push({ label: 'Neutral', color: '#666', bg: '#f5f4f0' });
    if (tags.length === 0) tags.push({ label: 'Monitoring', color: '#666', bg: '#f5f4f0' });
    return tags;
  };

  // Derive stats from report content
  const getStats = (report) => {
    if (!report) return [];
    const moves = report.competitorSnapshot.keyMoves.length;
    const news = report.newsItems.length;
    const outreach = report.outreach.contacts.length;
    const renewTargets = report.renewables.targets.length;
    const stats = [
      { value: moves, label: 'Competitor Moves' },
      { value: news, label: 'News Items' },
    ];
    if (outreach > 0) stats.push({ value: outreach, label: 'Outreach Contacts' });
    if (renewTargets > 0) stats.push({ value: renewTargets, label: 'Renewables Targets' });
    if (stats.length < 3) stats.push({ value: report.competitorSnapshot.themes.length, label: 'Trending Themes' });
    return stats;
  };

  if (!report) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="bg-white rounded-2xl p-8 text-center max-w-md" onClick={e => e.stopPropagation()} style={{ fontFamily: "'DM Sans', sans-serif" }}>
          <p className="text-terminal-muted text-sm">Report content not available.</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-lg bg-[#1a2e1a] text-white text-sm font-semibold">Close</button>
        </div>
      </div>
    );
  }

  const sentimentTags = getSentimentTags(report);
  const stats = getStats(report);
  const positioningIsPositive = report.competitorSnapshot.positioning.toLowerCase().includes('stable') ||
    report.competitorSnapshot.positioning.toLowerCase().includes('opportunit');
  const positioningIsNegative = report.competitorSnapshot.positioning.toLowerCase().includes('pressure') ||
    report.competitorSnapshot.positioning.toLowerCase().includes('intensif');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative w-full max-w-[900px] mx-4 my-6 max-h-[calc(100vh-48px)] flex flex-col rounded-2xl shadow-2xl overflow-hidden"
        style={{ fontFamily: "'DM Sans', sans-serif", background: '#fafaf8' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ─── Header ─── */}
        <div className="shrink-0 px-8 py-6" style={{ background: 'linear-gradient(135deg, #1a2e1a 0%, #1d3a1d 100%)' }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(45, 212, 120, 0.15)' }}>
                  <Zap size={16} style={{ color: '#2dd478' }} />
                </div>
                <span style={{ fontSize: '10px', fontFamily: "'DM Mono', monospace", fontWeight: 500, letterSpacing: '1.5px', color: 'rgba(45, 212, 120, 0.7)', textTransform: 'uppercase' }}>
                  Intelligence Report
                </span>
              </div>
              <h2 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '26px', fontWeight: 400, color: '#fff', lineHeight: 1.2, marginBottom: '8px' }}>
                {report.title}
              </h2>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1.5" style={{ fontSize: '11px', color: 'rgba(255,255,255,0.45)', fontFamily: "'DM Mono', monospace" }}>
                  <Clock size={10} />
                  {report.generated}
                </span>
                <span style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(45, 212, 120, 0.12)', color: '#2dd478', border: '1px solid rgba(45, 212, 120, 0.2)' }}>
                  Intelligence Agent
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ color: 'rgba(255,255,255,0.4)', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; e.currentTarget.style.background = 'transparent'; }}
            >
              <X size={18} />
            </button>
          </div>

          {/* ─── Sentiment Strip ─── */}
          <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontSize: '9px', fontFamily: "'DM Mono', monospace", fontWeight: 500, letterSpacing: '1px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' }}>
              Sentiment
            </span>
            {sentimentTags.map((tag, i) => (
              <span
                key={i}
                style={{
                  fontSize: '10px', fontWeight: 600, padding: '2px 10px', borderRadius: '20px',
                  background: tag.bg, color: tag.color, letterSpacing: '0.3px',
                }}
              >
                {tag.label}
              </span>
            ))}
          </div>
        </div>

        {/* ─── Stats Row ─── */}
        <div className="shrink-0 grid gap-0 border-b" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)`, borderColor: '#e8e8e3' }}>
          {stats.map((stat, i) => (
            <div
              key={i}
              className="flex flex-col items-center justify-center py-4"
              style={{
                background: '#fff',
                borderRight: i < stats.length - 1 ? '1px solid #e8e8e3' : 'none',
              }}
            >
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '28px', fontWeight: 500, color: '#1a2e1a', lineHeight: 1 }}>
                {stat.value}
              </span>
              <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999', marginTop: '4px' }}>
                {stat.label}
              </span>
            </div>
          ))}
        </div>

        {/* ─── Scrollable Content ─── */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-7">

          {/* ─── Competitor Snapshot ─── */}
          <section>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#f3eef8' }}>
                <Shield size={14} style={{ color: '#5b3a8c' }} />
              </div>
              <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                Competitor Snapshot
              </h3>
            </div>

            {report.competitorSnapshot.keyMoves.length > 0 ? (
              <div className="space-y-3">
                {report.competitorSnapshot.keyMoves.map((move, i) => (
                  <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                    <div className="px-5 py-4">
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#e8eef5' }}>
                          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', fontWeight: 500, color: '#2c5282' }}>
                            {move.ticker || '?'}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{move.name}</span>
                            {move.ticker && (
                              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: '#999', background: '#f5f4f0', padding: '1px 6px', borderRadius: '4px' }}>
                                {move.ticker}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: '13px', color: '#1a1a1a', lineHeight: 1.6, marginBottom: '10px' }}>{move.headline}</p>
                          {move.strategicRead && (
                            <div style={{ marginBottom: '8px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2c5282' }}>Strategic Read</span>
                              <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '2px' }}>{move.strategicRead}</p>
                            </div>
                          )}
                          {move.risk && (
                            <div style={{ marginBottom: '8px', padding: '8px 12px', background: '#fef8f8', borderRadius: '8px', borderLeft: '3px solid #dc3545' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#dc3545' }}>Risk</span>
                              <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '2px' }}>{move.risk}</p>
                            </div>
                          )}
                          {move.sanghaImplication && (
                            <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: '8px', borderLeft: '3px solid #1a6b3c' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a6b3c' }}>Sangha Implication</span>
                              <p style={{ fontSize: '12px', color: '#666', lineHeight: 1.6, marginTop: '2px' }}>{move.sanghaImplication}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl p-5" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                <p style={{ fontSize: '13px', color: '#999', fontStyle: 'italic' }}>No significant competitor moves in the last 24-72 hours.</p>
              </div>
            )}

            {/* Trending Themes */}
            {report.competitorSnapshot.themes.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999', display: 'block', marginBottom: '8px' }}>
                  Trending Themes
                </span>
                <div className="flex flex-wrap gap-2">
                  {report.competitorSnapshot.themes.map((theme, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1.5"
                      style={{
                        padding: '6px 14px', borderRadius: '10px', fontSize: '12px', fontWeight: 500,
                        background: '#fff', border: '1px solid #e8e8e3', color: '#1a1a1a',
                      }}
                    >
                      <TrendingUp size={11} style={{ color: '#999' }} />
                      {theme.text}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Positioning */}
            {report.competitorSnapshot.positioning && (
              <div
                className="mt-4 rounded-xl px-5 py-4"
                style={{
                  background: positioningIsPositive ? '#f0fdf4' : positioningIsNegative ? '#fefce8' : '#f5f5f3',
                  border: `1px solid ${positioningIsPositive ? '#d0e8d8' : positioningIsNegative ? '#f0e0b0' : '#e8e8e3'}`,
                }}
              >
                <div className="flex items-center gap-2">
                  <Target size={14} style={{ color: positioningIsPositive ? '#1a6b3c' : positioningIsNegative ? '#b8860b' : '#999' }} />
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999' }}>Our Positioning</span>
                </div>
                <p style={{
                  fontFamily: "'Instrument Serif', serif", fontSize: '15px', fontWeight: 400, lineHeight: 1.5, marginTop: '6px',
                  color: positioningIsPositive ? '#1a6b3c' : positioningIsNegative ? '#92400e' : '#1a1a1a',
                }}>
                  {report.competitorSnapshot.positioning}
                </p>
              </div>
            )}
          </section>

          {/* ─── Divider ─── */}
          <div style={{ height: '1px', background: '#e8e8e3' }} />

          {/* ─── News Items ─── */}
          {report.newsItems.length > 0 && (
            <section>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#e8eef5' }}>
                  <FileText size={14} style={{ color: '#2c5282' }} />
                </div>
                <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                  Top News Items
                </h3>
                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#999', marginLeft: '4px' }}>
                  {report.newsItems.length}
                </span>
              </div>

              <div className="space-y-3">
                {report.newsItems.map((item, i) => {
                  const isRisk = item.tags.includes('risk');
                  const isOpp = item.tags.includes('opportunity');
                  return (
                    <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                      {/* Card accent bar */}
                      <div style={{ height: '3px', background: isRisk ? '#dc3545' : isOpp ? '#2c5282' : '#e8e8e3' }} />
                      {/* Card header */}
                      <div className="px-5 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <span
                              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                              style={{
                                fontFamily: "'DM Mono', monospace", fontSize: '12px', fontWeight: 500,
                                background: isRisk ? '#fdedf0' : isOpp ? '#e8eef5' : '#f5f4f0',
                                color: isRisk ? '#dc3545' : isOpp ? '#2c5282' : '#999',
                              }}
                            >
                              {item.number}
                            </span>
                            <div className="min-w-0">
                              <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4, margin: 0 }}>{item.headline}</h4>
                              {item.source && (
                                <span style={{ fontSize: '11px', color: '#999', display: 'block', marginTop: '2px' }}>{item.source}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                            {item.tags.map((tag, j) => (
                              <TagBadge key={j} tag={tag} />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Card body */}
                      <div className="px-5 pb-4 space-y-3" style={{ borderTop: '1px solid #f0eeea' }}>
                        <div style={{ paddingTop: '12px' }} />
                        {item.whyItMatters && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <AlertTriangle size={10} style={{ color: '#b8860b' }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#b8860b' }}>Why it matters</span>
                            </div>
                            <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.whyItMatters}</p>
                          </div>
                        )}
                        {item.sanghaImpact && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Target size={10} style={{ color: '#1a6b3c' }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a6b3c' }}>Sangha impact</span>
                            </div>
                            <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.sanghaImpact}</p>
                          </div>
                        )}
                        {item.actionability && (
                          <div>
                            <div className="flex items-center gap-1.5 mb-1">
                              <Zap size={10} style={{ color: '#2c5282' }} />
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2c5282' }}>Actionability</span>
                            </div>
                            <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.actionability}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ─── Recommended Outreach ─── */}
          {report.outreach.contacts.length > 0 && (
            <>
              <div style={{ height: '1px', background: '#e8e8e3' }} />
              <section>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#edf7f0' }}>
                    <Mail size={14} style={{ color: '#1a6b3c' }} />
                  </div>
                  <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                    Recommended Outreach
                  </h3>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#999', marginLeft: '4px' }}>
                    {report.outreach.contacts.length}
                  </span>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {[
                    { value: report.outreach.stats.total, label: 'Total Contacts' },
                    { value: report.outreach.stats.highPriority, label: 'High Priority' },
                    { value: report.outreach.stats.competitorTriggered, label: 'Competitor-Triggered' },
                    { value: report.outreach.stats.reEngagements, label: 'Re-Engagements' },
                  ].map((s, i) => (
                    <div key={i} className="text-center py-3 rounded-lg" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                      <div style={{ fontFamily: "'DM Mono', monospace", fontSize: '20px', fontWeight: 500, color: '#1a2e1a' }}>{s.value}</div>
                      <div style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#999', marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Contact Cards */}
                <div className="space-y-3">
                  {report.outreach.contacts.map((contact, i) => (
                    <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                      <div className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{i + 1}. {contact.name}</span>
                            <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{contact.title} at {contact.company}</div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: contact.trigger.includes('News') ? '#e8eef5' : contact.trigger.includes('Competitor') ? '#fdf6e8' : '#f3eef8', color: contact.trigger.includes('News') ? '#2c5282' : contact.trigger.includes('Competitor') ? '#b8860b' : '#5b3a8c' }}>
                              {contact.trigger}
                            </span>
                            <span style={{ fontSize: '10px', color: '#999' }}>{contact.lastContact}</span>
                          </div>
                        </div>
                        <div style={{ padding: '10px 14px', background: '#f8faff', borderRadius: '8px', borderLeft: '3px solid #2c5282', marginBottom: '8px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2c5282' }}>Why Reach Out Now</span>
                          <p style={{ fontSize: '12px', color: '#444', lineHeight: 1.6, marginTop: '4px' }}>{contact.whyReachOut}</p>
                        </div>
                        {contact.valueProp && (
                          <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: '8px', borderLeft: '3px solid #1a6b3c' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#1a6b3c' }}>Sangha Value Prop</span>
                            <p style={{ fontSize: '12px', color: '#444', lineHeight: 1.6, marginTop: '4px' }}>{contact.valueProp}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ─── Draft Outreach Messages ─── */}
          {report.outreach.draftMessages.length > 0 && (
            <>
              <div style={{ height: '1px', background: '#e8e8e3' }} />
              <section>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#e8eef5' }}>
                    <Send size={14} style={{ color: '#2c5282' }} />
                  </div>
                  <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                    Draft Outreach Messages
                  </h3>
                  <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#999', marginLeft: '4px' }}>
                    {report.outreach.draftMessages.length}
                  </span>
                </div>
                <div className="space-y-3">
                  {report.outreach.draftMessages.map((msg, i) => (
                    <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                      <div className="px-5 py-4">
                        <div className="flex items-center justify-between mb-2">
                          <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{msg.contactName}</span>
                          <span style={{ fontSize: '11px', color: '#999' }}>{msg.company}</span>
                        </div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: '#2c5282', marginBottom: '8px' }}>Subject: {msg.subject}</div>
                        <div style={{ padding: '12px', background: '#f9faf8', borderRadius: '8px', fontSize: '12.5px', color: '#444', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                          {msg.body}
                        </div>
                        <div className="flex items-center gap-3 mt-3" style={{ fontSize: '10px', color: '#999' }}>
                          <span>{msg.wordCount} words</span>
                          <span>Hook: {msg.hook}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ─── Part 2: Renewables Market Dynamics ─── */}
          {(report.renewables.targets.length > 0 || report.renewables.newsItems.length > 0) && (
            <>
              <div style={{ height: '3px', background: 'linear-gradient(90deg, #22c55e, #16a34a)', borderRadius: '2px', marginTop: '8px' }} />
              <section>
                <div className="flex items-center gap-2.5 mb-1">
                  <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '22px', fontWeight: 400, color: '#166534', margin: 0 }}>
                    Part 2: Renewables Market Dynamics
                  </h3>
                </div>
                <p style={{ fontSize: '12px', color: '#16a34a', fontStyle: 'italic', marginBottom: '20px' }}>Potential Customers - Solar, Wind, Battery, Hydro IPPs</p>

                {/* Customer/Target Snapshot Table */}
                {report.renewables.targets.length > 0 && (
                  <div style={{ marginBottom: '20px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#999', display: 'block', marginBottom: '10px' }}>
                      Customer / Target Snapshot
                    </span>
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e8e8e3' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: '#f9faf8' }}>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e8e8e3', fontSize: '11px' }}>Company</th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e8e8e3', fontSize: '11px' }}>Sector</th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e8e8e3', fontSize: '11px' }}>Recent Activity</th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e8e8e3', fontSize: '11px' }}>Type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.renewables.targets.map((t, i) => (
                            <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                              <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1a1a1a', borderBottom: '1px solid #f0eeea' }}>{t.company}</td>
                              <td style={{ padding: '10px 14px', borderBottom: '1px solid #f0eeea' }}>
                                <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#edf7f0', color: '#1a6b3c' }}>{t.sector}</span>
                              </td>
                              <td style={{ padding: '10px 14px', color: '#444', lineHeight: 1.5, borderBottom: '1px solid #f0eeea' }}>{t.activity}</td>
                              <td style={{ padding: '10px 14px', borderBottom: '1px solid #f0eeea' }}>
                                <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: t.opportunityType === 'distress' ? '#fdedf0' : '#edf7f0', color: t.opportunityType === 'distress' ? '#dc3545' : '#1a6b3c' }}>{t.opportunityType}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Distress Signals */}
                {report.renewables.distressSignals.length > 0 && (
                  <div style={{ padding: '14px 16px', background: '#fef2f2', borderRadius: '10px', borderLeft: '4px solid #dc3545', marginBottom: '12px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#dc3545', display: 'block', marginBottom: '8px' }}>Distress Signals (Best Opportunities)</span>
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                      {report.renewables.distressSignals.map((s, i) => (
                        <li key={i} style={{ fontSize: '12px', color: '#991b1b', lineHeight: 1.6, marginBottom: '4px' }}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Growth Signals */}
                {report.renewables.growthSignals.length > 0 && (
                  <div style={{ padding: '14px 16px', background: '#f0fdf4', borderRadius: '10px', borderLeft: '4px solid #22c55e', marginBottom: '16px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#166534', display: 'block', marginBottom: '8px' }}>Growth Signals</span>
                    <ul style={{ margin: 0, paddingLeft: '18px' }}>
                      {report.renewables.growthSignals.map((s, i) => (
                        <li key={i} style={{ fontSize: '12px', color: '#166534', lineHeight: 1.6, marginBottom: '4px' }}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Renewables News */}
                {report.renewables.newsItems.length > 0 && (
                  <>
                    <div style={{ height: '1px', background: '#e8e8e3', margin: '8px 0 16px' }} />
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#edf7f0' }}>
                        <FileText size={14} style={{ color: '#16a34a' }} />
                      </div>
                      <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                        Top Renewables News
                      </h3>
                      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '11px', color: '#999', marginLeft: '4px' }}>
                        {report.renewables.newsItems.length}
                      </span>
                    </div>
                    <div className="space-y-3">
                      {report.renewables.newsItems.map((item, i) => (
                        <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3' }}>
                          <div style={{ height: '3px', background: '#22c55e' }} />
                          <div className="px-5 py-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3 min-w-0">
                                <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ fontFamily: "'DM Mono', monospace", fontSize: '12px', fontWeight: 500, background: '#edf7f0', color: '#16a34a' }}>
                                  {item.number}
                                </span>
                                <div className="min-w-0">
                                  <h4 style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4, margin: 0 }}>{item.headline}</h4>
                                  {item.source && <span style={{ fontSize: '11px', color: '#999', display: 'block', marginTop: '2px' }}>{item.source}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                                {item.tags.map((tag, j) => <TagBadge key={j} tag={tag} />)}
                              </div>
                            </div>
                          </div>
                          <div className="px-5 pb-4 space-y-3" style={{ borderTop: '1px solid #f0eeea' }}>
                            <div style={{ paddingTop: '12px' }} />
                            {item.whyItMatters && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <AlertTriangle size={10} style={{ color: '#b8860b' }} />
                                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#b8860b' }}>Why it matters</span>
                                </div>
                                <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.whyItMatters}</p>
                              </div>
                            )}
                            {item.sanghaOpportunity && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Target size={10} style={{ color: '#16a34a' }} />
                                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#16a34a' }}>Sangha opportunity</span>
                                </div>
                                <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.sanghaOpportunity}</p>
                              </div>
                            )}
                            {item.actionability && (
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <Zap size={10} style={{ color: '#2c5282' }} />
                                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#2c5282' }}>Actionability</span>
                                </div>
                                <p style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, paddingLeft: '18px' }}>{item.actionability}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Renewables Outreach Contacts */}
                {report.renewables.outreachContacts.length > 0 && (
                  <>
                    <div style={{ height: '1px', background: '#e8e8e3', margin: '16px 0' }} />
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#edf7f0' }}>
                        <Mail size={14} style={{ color: '#16a34a' }} />
                      </div>
                      <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                        Renewables Outreach
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {report.renewables.outreachContacts.map((contact, i) => (
                        <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3', borderLeft: '3px solid #22c55e' }}>
                          <div className="px-5 py-4">
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div>
                                <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a1a' }}>{i + 1}. {contact.name}</span>
                                <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{contact.title} at {contact.company}</div>
                              </div>
                              <span style={{ fontSize: '10px', color: '#999' }}>{contact.lastContact}</span>
                            </div>
                            <div style={{ padding: '10px 14px', background: '#f8faff', borderRadius: '8px', borderLeft: '3px solid #16a34a', marginBottom: '8px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#166534' }}>Why Reach Out Now</span>
                              <p style={{ fontSize: '12px', color: '#444', lineHeight: 1.6, marginTop: '4px' }}>{contact.whyReachOut}</p>
                            </div>
                            {contact.salesAngle && (
                              <div style={{ padding: '10px 14px', background: '#f0fdf4', borderRadius: '8px', borderLeft: '3px solid #22c55e' }}>
                                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#166534' }}>Sales Angle</span>
                                <p style={{ fontSize: '12px', color: '#444', lineHeight: 1.6, marginTop: '4px' }}>{contact.salesAngle}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Renewables Draft Messages */}
                {report.renewables.draftMessages.length > 0 && (
                  <>
                    <div style={{ height: '1px', background: '#e8e8e3', margin: '16px 0' }} />
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#edf7f0' }}>
                        <Send size={14} style={{ color: '#16a34a' }} />
                      </div>
                      <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '18px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                        Renewables Draft Messages
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {report.renewables.draftMessages.map((msg, i) => (
                        <div key={i} className="rounded-xl overflow-hidden" style={{ background: '#fff', border: '1px solid #e8e8e3', borderLeft: '3px solid #22c55e' }}>
                          <div className="px-5 py-4">
                            <div className="flex items-center justify-between mb-2">
                              <span style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{msg.contactName}</span>
                              <span style={{ fontSize: '11px', color: '#999' }}>{msg.company}</span>
                            </div>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#166534', marginBottom: '8px' }}>Subject: {msg.subject}</div>
                            <div style={{ padding: '12px', background: '#f9faf8', borderRadius: '8px', fontSize: '12.5px', color: '#444', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                              {msg.body}
                            </div>
                            <div className="flex items-center gap-3 mt-3" style={{ fontSize: '10px', color: '#999' }}>
                              <span>{msg.wordCount} words</span>
                              <span>Hook: {msg.hook}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Next Steps */}
                {report.renewables.nextSteps.length > 0 && (
                  <>
                    <div style={{ height: '1px', background: '#e8e8e3', margin: '16px 0' }} />
                    <div className="flex items-center gap-2.5 mb-3">
                      <h3 style={{ fontFamily: "'Instrument Serif', serif", fontSize: '16px', fontWeight: 400, color: '#1a1a1a', margin: 0 }}>
                        Next Steps
                      </h3>
                    </div>
                    <div className="rounded-xl" style={{ background: '#fff', border: '1px solid #e8e8e3', padding: '16px 20px' }}>
                      <ul style={{ margin: 0, paddingLeft: '20px' }}>
                        {report.renewables.nextSteps.map((step, i) => (
                          <li key={i} style={{ fontSize: '12.5px', color: '#444', lineHeight: 1.6, marginBottom: '6px' }}>{step}</li>
                        ))}
                      </ul>
                      {report.renewables.marketSignal && (
                        <div style={{ marginTop: '14px', padding: '12px', background: '#eff6ff', borderRadius: '8px' }}>
                          <p style={{ fontSize: '12px', color: '#1e40af', lineHeight: 1.6, margin: 0 }}>
                            <strong>Market Signal:</strong> {report.renewables.marketSignal}
                          </p>
                          {report.renewables.competitivePosture && (
                            <p style={{ fontSize: '12px', color: '#1e40af', lineHeight: 1.6, margin: '6px 0 0' }}>
                              <strong>Competitive Posture:</strong> {report.renewables.competitivePosture}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        {/* ─── Comments ─── */}
        <ReportCommentsSection reportId={dateKey || file.name} />

        {/* ─── Footer ─── */}
        <div className="shrink-0 px-8 py-4 flex items-center justify-between" style={{ background: '#fff', borderTop: '1px solid #e8e8e3' }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: '10px', color: '#999' }}>
            Generated {report.generated} by Intelligence Agent
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
              style={{ fontSize: '11px', fontWeight: 600, color: '#666', background: '#f5f4f0', border: '1px solid #e8e8e3' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#eee'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#f5f4f0'; }}
            >
              <Printer size={11} />
              Print
            </button>
            {file.url && (
              <button
                onClick={handleExport}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors"
                style={{ fontSize: '11px', fontWeight: 600, color: '#fff', background: '#1a2e1a', border: '1px solid #1a2e1a' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#2a4a2a'; }}
                onMouseLeave={e => { e.currentTarget.style.background = '#1a2e1a'; }}
              >
                <Download size={11} />
                Export to Drive
              </button>
            )}
          </div>
        </div>

        {/* ─── Toast ─── */}
        {toast && (
          <div
            className="absolute bottom-16 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-xl shadow-lg"
            style={{
              background: '#1a2e1a', color: '#2dd478', fontSize: '12px', fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", whiteSpace: 'nowrap',
              animation: 'fadeInUp 0.2s ease-out',
            }}
          >
            {toast}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

// No demo/sample files - only show real uploaded files

// ─── Component ──────────────────────────────────────────────────────────────

export default function FilesDashboard() {
  const { tenant } = useTenant();
  const { tokens } = useAuth();
  const authHeaders = tokens?.accessToken
    ? { Authorization: `Bearer ${tokens.accessToken}` }
    : {};
  const isConstruction = tenant?.settings?.industry === 'construction';
  const isVenture = tenant?.settings?.industry === 'venture';
  const driveRoot = isConstruction ? '/DACP/' : isVenture ? '/Drive/' : '/Sangha/';

  const [folders, setFolders] = useState({});
  const [liveMode, setLiveMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [search, setSearch] = useState('');
  const [totalFiles, setTotalFiles] = useState(0);
  const [viewingReport, setViewingReport] = useState(null);
  const [viewingNewsletter, setViewingNewsletter] = useState(null);
  const [commentCounts, setCommentCounts] = useState({});
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const fileInputRef = useRef(null);

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (selectedFolder) formData.append('folder', selectedFolder);
      const res = await fetch(`${API_BASE}/v1/files/upload`, { method: 'POST', headers: authHeaders, body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      showToast(`Uploaded ${file.name}`, 'success');
      refreshFiles();
    } catch (err) {
      showToast(err.message || 'Upload failed', 'error');
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Fetch comment counts for intel reports
  useEffect(() => {
    const intelFolder = folders['Intelligence Agent'];
    if (!intelFolder) return;
    const reportIds = intelFolder.files
      .filter(f => f.isIntelReport)
      .map(f => {
        const m = f.name.match(/(\d{4}-\d{2}-\d{2})/);
        return m ? m[1] : f.name;
      });
    if (reportIds.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/report-comments/counts/batch?ids=${reportIds.join(',')}`);
        if (res.ok) {
          const data = await res.json();
          setCommentCounts(data.counts || {});
        }
      } catch {}
    })();
  }, [folders, viewingReport]);

  // Format date string for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Format file size
  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Convert API files into folder structure
  const buildFoldersFromApi = (files, categories) => {
    const grouped = {};
    for (const file of files) {
      const cat = file.category || 'Other';
      if (!grouped[cat]) {
        grouped[cat] = { path: `${driveRoot}${cat}/`, files: [] };
      }
      grouped[cat].files.push({
        name: file.name,
        type: file.file_type || 'other',
        owner: '',
        modified: formatDate(file.modified_at),
        agent: true,
        url: file.drive_url || null,
        isDrive: !!file.drive_url,
        size: file.size_bytes,
        category: cat,
      });
    }
    // Sort categories by count (use categories array order)
    if (categories) {
      const ordered = {};
      for (const cat of categories) {
        if (grouped[cat.category]) {
          ordered[cat.category] = grouped[cat.category];
        }
      }
      // Add any remaining
      for (const [k, v] of Object.entries(grouped)) {
        if (!ordered[k]) ordered[k] = v;
      }
      return ordered;
    }
    return grouped;
  };

  // Try to load real files from API
  useEffect(() => {
    let cancelled = false;
    async function fetchFiles() {
      setLoading(true);
      try {
        // First try the tenant files endpoint
        const res = await fetch(`${API_BASE}/v1/files`, { headers: authHeaders });
        if (!res.ok) throw new Error('Files endpoint not available');
        const data = await res.json();
        if (!cancelled && data.files && data.files.length > 0) {
          const grouped = buildFoldersFromApi(data.files, data.categories);
          if (Object.keys(grouped).length > 0) {
            setFolders(grouped);
            setExpandedFolders(new Set(Object.keys(grouped)));
            setSelectedFolder(Object.keys(grouped)[0]);
            setLiveMode(true);
            setTotalFiles(data.total || data.files.length);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Fall through to workspace agent
      }

      // Fallback: try workspace agent (skip for venture - no demo data)
      if (!isVenture) {
        try {
          const res = await fetch(`${API_BASE}/v1/workspace/files`, { headers: authHeaders });
          if (!res.ok) throw new Error('Workspace agent not available');
          const data = await res.json();
          if (!cancelled && data.files && data.files.length > 0) {
            const grouped = {};
            for (const file of data.files) {
              const folder = file.folder || 'Uncategorized';
              if (!grouped[folder]) grouped[folder] = { path: `${driveRoot}${folder}/`, files: [] };
              grouped[folder].files.push({
                name: file.name,
                type: file.type || 'doc',
                owner: file.owner || 'Unknown',
                modified: file.modified || '',
                agent: file.agent || false,
                url: file.url,
              });
            }
            if (Object.keys(grouped).length > 0) {
              setFolders(grouped);
              setExpandedFolders(new Set(Object.keys(grouped)));
              setSelectedFolder(Object.keys(grouped)[0]);
              setLiveMode(true);
            }
          }
        } catch {
          // No workspace agent available
        }
      }
      if (!cancelled) setLoading(false);
    }
    fetchFiles();
    return () => { cancelled = true; };
  }, [isConstruction, isVenture]);

  // Fetch meeting transcripts and inject as a "Meetings" folder
  useEffect(() => {
    async function fetchMeetings() {
      try {
        const res = await fetch(`${API_BASE}/v1/knowledge/recent?type=meeting&limit=50`, { headers: authHeaders });
        if (!res.ok) return;
        const entries = await res.json();
        if (entries.length > 0) {
          const meetingFiles = entries.map(e => ({
            name: e.title || 'Untitled Meeting',
            type: 'meeting',
            owner: e.source_agent || 'Meeting Bot',
            modified: e.recorded_at || e.created_at || '',
            agent: true,
            url: e.drive_url || null,
            knowledgeId: e.id,
            summary: e.summary,
            duration: e.duration_seconds,
          }));
          setFolders(prev => ({
            Meetings: { path: '/Meetings/', files: meetingFiles },
            ...prev,
          }));
        }
      } catch {}
    }
    fetchMeetings();
  }, []);

  // Fetch newsletters and inject as a "Daily Briefs" folder
  useEffect(() => {
    async function fetchNewsletters() {
      try {
        const res = await fetch(`${API_BASE}/v1/estimates/newsletters`, { headers: authHeaders });
        if (!res.ok) return;
        const data = await res.json();
        if (data.newsletters?.length > 0) {
          const briefFiles = data.newsletters.map(n => ({
            name: n.title || 'Daily Intelligence',
            type: 'newsletter',
            owner: 'Coppice AI',
            modified: n.created_at ? new Date(n.created_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '',
            agent: true,
            url: null,
            isNewsletter: true,
            newsletterHtml: n.content,
            knowledgeId: n.id,
          }));
          setFolders(prev => ({
            'Daily Briefs': { path: '/Daily Briefs/', files: briefFiles },
            ...prev,
          }));
        }
      } catch {}
    }
    fetchNewsletters();
  }, []);

  const refreshFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/files`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.files?.length > 0) {
          const grouped = buildFoldersFromApi(data.files, data.categories);
          setFolders(grouped);
          setLiveMode(true);
          setTotalFiles(data.total || data.files.length);
        }
      }
    } catch {}
    setLoading(false);
  };

  // ─── Drive Sync ────────────────────────────────────────────────────────
  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/files/sync-status`, { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        setSyncStatus(data.syncStatus || null);
        if (data.syncStatus?.status === 'running') {
          setSyncing(true);
        } else {
          setSyncing(false);
        }
      }
    } catch {}
  }, [tokens?.accessToken]);

  const handleSyncDrive = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/v1/files/sync-drive`, { method: 'POST', headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'already_running') {
          showToast('Drive sync already running...', 'info');
        } else {
          showToast('Drive sync started', 'success');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Sync failed', 'error');
        setSyncing(false);
      }
    } catch (err) {
      showToast('Failed to start sync', 'error');
      setSyncing(false);
    }
  };

  // Poll sync status while syncing
  useEffect(() => {
    fetchSyncStatus();
    if (!syncing) return;
    const interval = setInterval(async () => {
      await fetchSyncStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [syncing, fetchSyncStatus]);

  // When sync completes, refresh file list
  const prevSyncRef = useRef(null);
  useEffect(() => {
    if (prevSyncRef.current === 'running' && syncStatus?.status === 'completed') {
      refreshFiles();
      showToast(`Drive sync complete - ${syncStatus.files_indexed || 0} files indexed`, 'success');
    }
    prevSyncRef.current = syncStatus?.status || null;
  }, [syncStatus?.status]);

  const toggleFolder = (name) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setSelectedFolder(name);
  };

  const allFiles = useMemo(() => {
    const result = [];
    for (const [, folder] of Object.entries(folders)) {
      for (const file of folder.files) result.push(file);
    }
    return result;
  }, [folders]);

  const filteredFiles = useMemo(() => {
    let files;
    if (search.trim()) {
      const q = search.toLowerCase();
      files = allFiles.filter(f => f.name.toLowerCase().includes(q) || (f.owner && f.owner.toLowerCase().includes(q)));
    } else if (typeFilter !== 'all') {
      files = allFiles;
    } else {
      files = folders[selectedFolder]?.files || [];
    }
    // Apply type filter
    if (typeFilter !== 'all') {
      const typeMap = { sheets: ['sheet', 'xlsx', 'csv'], docs: ['doc', 'docx'], slides: ['slides', 'pptx'], pdfs: ['pdf'] };
      const allowed = typeMap[typeFilter] || [];
      files = files.filter(f => allowed.includes(f.type));
    }
    return files;
  }, [folders, selectedFolder, search, typeFilter, allFiles]);

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-lg border transition-all ${
          toast.type === 'error' ? 'bg-red-50 text-red-700 border-red-200' :
          toast.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' :
          'bg-blue-50 text-blue-700 border-blue-200'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Report Viewer Modal */}
      {viewingReport && (
        <ReportViewerModal
          file={viewingReport}
          onClose={() => setViewingReport(null)}
        />
      )}

      {/* Newsletter Viewer Modal */}
      {viewingNewsletter && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setViewingNewsletter(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e6e1]">
              <div>
                <h3 className="text-sm font-bold text-terminal-text font-heading">{viewingNewsletter.name}</h3>
                <span className="text-[11px] text-terminal-muted">{viewingNewsletter.modified}</span>
              </div>
              <button onClick={() => setViewingNewsletter(null)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#f5f4f0] text-terminal-muted hover:text-terminal-text transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div dangerouslySetInnerHTML={{ __html: viewingNewsletter.newsletterHtml }} />
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-sm font-bold text-terminal-text tracking-[0.3px] font-heading">Files</h2>
        {liveMode && (
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.5px] px-2 py-0.5 rounded-full bg-[#edf7f0] text-[#1a6b3c] border border-[#d0e8d8] font-mono">
            <span className="w-[5px] h-[5px] rounded-full bg-[#1a6b3c] animate-pulse" />
            Live
          </span>
        )}
        {totalFiles > 0 && (
          <span className="text-[11px] text-terminal-muted font-mono">{totalFiles} files</span>
        )}
        <button
          onClick={refreshFiles}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-terminal-muted bg-[#f5f4f0] border border-terminal-border hover:bg-[#eeede8] transition-colors disabled:opacity-50 font-heading"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-[#2c5282] border border-[#1e3a5f] hover:bg-[#1e3a5f] transition-colors disabled:opacity-50 font-heading"
        >
          <Upload size={12} className={uploading ? 'animate-spin' : ''} />
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
        <button
          onClick={handleSyncDrive}
          disabled={syncing}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-terminal-muted bg-[#f5f4f0] border border-terminal-border hover:bg-[#eeede8] transition-colors disabled:opacity-50 font-heading"
          title="Scan your connected Google Drive and index all files for AI context"
        >
          <DriveIcon />
          {syncing ? (
            <>
              <div className="w-3 h-3 rounded-full border-2 border-[#9ca3af] border-t-transparent animate-spin" />
              {syncStatus?.files_found > 0
                ? `${syncStatus.files_indexed || 0}/${syncStatus.files_found}`
                : 'Scanning...'}
            </>
          ) : 'Sync Drive'}
        </button>
        {syncStatus?.last_successful_sync && !syncing && (
          <span className="text-[10px] text-terminal-muted" title={new Date(syncStatus.last_successful_sync).toLocaleString()}>
            Last synced {(() => {
              const mins = Math.round((Date.now() - new Date(syncStatus.last_successful_sync).getTime()) / 60000);
              if (mins < 1) return 'just now';
              if (mins < 60) return `${mins}m ago`;
              if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
              return `${Math.round(mins / 1440)}d ago`;
            })()}
          </span>
        )}
        <div className="flex-1" />
        <div className="relative w-56">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search files..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-[12px] bg-[#f5f4f0] border border-terminal-border text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-terminal-green transition-colors"
          />
        </div>
      </div>

      {/* Type filter tabs removed — folders already organize by type */}

      {Object.keys(folders).length === 0 && !loading ? (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-12 text-center">
          <div className="text-3xl mb-3 opacity-40">📁</div>
          <p className="text-sm font-semibold text-terminal-text mb-1">No files yet</p>
          <p className="text-[12px] text-terminal-muted">Upload files or click "Sync Drive" to import from Google Drive.</p>
        </div>
      ) : (
      <div className="flex gap-5">
        {/* Folder tree sidebar */}
        <div className="w-52 shrink-0">
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
            <div className="px-[14px] py-[10px] border-b border-[#f0eeea]">
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] font-heading">Folders</span>
            </div>
            <div className="py-1">
              {Object.keys(folders).map(name => {
                const isExpanded = expandedFolders.has(name);
                const isSelected = selectedFolder === name && !search.trim();
                return (
                  <button
                    key={name}
                    onClick={() => toggleFolder(name)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] font-medium transition-colors ${
                      isSelected
                        ? 'bg-[rgba(45,212,120,0.06)] text-terminal-text'
                        : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
                    }`}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} className="shrink-0 opacity-40" />
                      : <ChevronRight size={12} className="shrink-0 opacity-40" />
                    }
                    {name === 'Meetings'
                      ? <Mic size={14} className={`shrink-0 ${isSelected ? 'text-[#7c3aed]' : 'opacity-50'}`} />
                      : name === 'Daily Briefs'
                      ? <Newspaper size={14} className={`shrink-0 ${isSelected ? 'text-[#1e3a5f]' : 'opacity-50'}`} />
                      : <FolderOpen size={14} className={`shrink-0 ${isSelected ? 'text-terminal-green' : 'opacity-50'}`} />
                    }
                    <span className="truncate">{name}</span>
                    <span className="ml-auto text-[10px] text-terminal-muted tabular-nums font-mono">
                      {folders[name].files.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* File list */}
        <div className="flex-1 min-w-0">
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-[1fr_100px_140px] gap-2 px-[18px] py-[10px] border-b border-[#f0eeea]">
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] font-heading">Name</span>
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] font-heading">Modified</span>
              <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] text-right font-heading">Actions</span>
            </div>

            {/* Path breadcrumb */}
            {!search.trim() && (
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] font-mono text-terminal-muted">
                  {folders[selectedFolder]?.path}
                </span>
              </div>
            )}
            {search.trim() && (
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] text-terminal-muted">
                  {filteredFiles.length} result{filteredFiles.length !== 1 ? 's' : ''} for "{search}"
                </span>
              </div>
            )}

            {/* Files */}
            {filteredFiles.length === 0 ? (
              <div className="px-[18px] py-10 text-center text-[13px] text-terminal-muted">No files found.</div>
            ) : (
              filteredFiles.map((file, i) => {
                const icon = getFileIcon(file.type);
                const isExternal = file.isDrive || (file.url && file.url.startsWith('http'));
                const isReport = file.name.toLowerCase().includes('report') || file.name.toLowerCase().includes('contact');
                const isEstimate = file.name.toLowerCase().includes('estimate');
                const isPipeline = file.name.toLowerCase().includes('pipeline');
                const isIntelReport = file.isIntelReport === true;
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_100px_140px] gap-2 items-center px-[18px] py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors group"
                  >
                    {/* Name with icon */}
                    <div
                      className="flex items-center gap-2.5 min-w-0 cursor-pointer"
                      onClick={() => {
                        if (file.isNewsletter) {
                          setViewingNewsletter(file);
                        } else if (isIntelReport) {
                          setViewingReport(file);
                        } else if (isExternal) {
                          window.open(file.url, '_blank', 'noopener,noreferrer');
                        } else if (file.url) {
                          window.open(`${FILE_BASE}${file.url}`, '_blank');
                        } else {
                          showToast('Sample file - upload real files with the Upload button above');
                        }
                      }}
                    >
                      <span
                        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={{ background: icon.bg, color: icon.color }}
                      >
                        {icon.letter}
                      </span>
                      <span className="text-[13px] font-medium text-terminal-text truncate group-hover:text-[#2c5282] transition-colors">{file.name}</span>
                      {file.isDrive && (
                        <span className="flex items-center gap-1 text-[9px] font-semibold text-[#666] shrink-0" title="Opens in Google Drive">
                          <DriveIcon />
                        </span>
                      )}
                      {file.agent && (
                        <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f3eef8] text-[#5b3a8c] border-[#d8cce8] shrink-0 font-mono">
                          agent
                        </span>
                      )}
                      {isIntelReport && (() => {
                        const rid = file.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || file.name;
                        const cnt = commentCounts[rid];
                        return cnt > 0 ? (
                          <span className="flex items-center gap-1 text-[10px] font-semibold shrink-0 font-mono" style={{ color: '#1a6b3c' }}>
                            <MessageCircle size={10} />
                            {cnt}
                          </span>
                        ) : null;
                      })()}
                      {file.size > 0 && (
                        <span className="text-[10px] text-terminal-muted shrink-0 font-mono">{formatSize(file.size)}</span>
                      )}
                    </div>

                    {/* Modified */}
                    <span className="text-[12px] text-terminal-muted tabular-nums font-mono">{file.modified}</span>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {(isReport || isPipeline) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const teamEmail = isConstruction ? 'Mpineda@dacpholdings.com' : 'spencer@sanghasystems.com';
                            const subject = encodeURIComponent(`Coppice Report: ${file.name}`);
                            const body = encodeURIComponent(`Hi,\n\nPlease find the latest ${file.name}.\n\n${file.url ? 'View in Drive: ' + file.url + '\n\n' : ''}Generated by Coppice on ${file.modified || new Date().toLocaleDateString()}.\n\nBest,\nCoppice Agent`);
                            window.open(`mailto:${teamEmail}?subject=${subject}&body=${body}`, '_self');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#1a6b3c] bg-[#edf7f0] border border-[#d0e8d8] hover:bg-[#dff0e5] transition-colors font-heading"
                          title="Send to team"
                        >
                          <Send size={9} /> Send
                        </button>
                      )}
                      {isEstimate && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const gcName = file.name.replace(/DACP_Estimate_|\.xlsx/g, '').replace(/_/g, ' ');
                            const subject = encodeURIComponent(`DACP Estimate - ${gcName}`);
                            const body = encodeURIComponent(`Please find attached our estimate for ${gcName}.\n\n${file.url ? 'View: ' + file.url + '\n\n' : ''}Best regards,\nDACP Construction`);
                            window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#2c5282] bg-[#e8eef5] border border-[#c5d5e8] hover:bg-[#dce6f0] transition-colors font-heading"
                          title="Send to GC"
                        >
                          <Mail size={9} /> Send to GC
                        </button>
                      )}
                      {isIntelReport ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingReport(file);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#1a6b3c] bg-[#edf7f0] border border-[#d0e8d8] hover:bg-[#dff0e5] transition-colors font-heading"
                        >
                          View Report <FileText size={9} />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isExternal) {
                              window.open(file.url, '_blank', 'noopener,noreferrer');
                            } else if (file.url) {
                              window.open(`${FILE_BASE}${file.url}`, '_blank');
                            } else {
                              showToast('Sample file - upload real files with the Upload button above');
                            }
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-[#2c5282] hover:bg-[#e8eef5] transition-colors font-heading"
                        >
                          Open <ExternalLink size={9} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
