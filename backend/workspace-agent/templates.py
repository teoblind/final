"""Template library for common document types."""

import re
from typing import Optional
from pydantic import BaseModel


class DocumentTemplate(BaseModel):
    id: str
    tenant_id: Optional[str] = None  # None = platform-wide
    type: str  # "slides" | "sheet" | "doc"
    name: str
    description: str
    structure: dict
    variables: list[str]


# ─── Sangha (Mining) Templates ──────────────────────────────────────────────

SANGHA_TEMPLATES = {
    # Slides
    "weekly_briefing": DocumentTemplate(
        id="weekly_briefing",
        tenant_id="sangha",
        type="slides",
        name="Weekly Executive Briefing",
        description="8-slide weekly operations summary for leadership",
        variables=["week_number", "date_range", "hashrate", "revenue", "curtailment_savings", "risk_flags"],
        structure={
            "slides": [
                {"layout": "title", "title": "Weekly Executive Briefing", "subtitle": "Week {{week_number}} — {{date_range}}"},
                {"layout": "title_body", "title": "KPI Snapshot", "body": "Hashrate: {{hashrate}}\nRevenue: {{revenue}}\nUptime: {{uptime}}"},
                {"layout": "title_body", "title": "Fleet Status", "body": "{{fleet_summary}}"},
                {"layout": "title_body", "title": "Revenue Breakdown", "body": "{{revenue_breakdown}}"},
                {"layout": "title_body", "title": "Curtailment Events", "body": "{{curtailment_summary}}\nTotal savings: {{curtailment_savings}}"},
                {"layout": "title_body", "title": "Market Outlook", "body": "{{market_outlook}}"},
                {"layout": "title_body", "title": "Risk Flags", "body": "{{risk_flags}}"},
                {"layout": "title_body", "title": "Action Items", "body": "{{action_items}}"},
            ],
        },
    ),
    "investor_update": DocumentTemplate(
        id="investor_update",
        tenant_id="sangha",
        type="slides",
        name="Investor Update Monthly",
        description="12-slide monthly investor update with financials and market analysis",
        variables=["month", "year", "revenue", "net_margin", "hashrate", "hashprice"],
        structure={
            "slides": [
                {"layout": "title", "title": "Investor Update", "subtitle": "{{month}} {{year}}"},
                {"layout": "title_body", "title": "Executive Summary", "body": "{{executive_summary}}"},
                {"layout": "title_body", "title": "P&L Summary", "body": "{{pnl_summary}}"},
                {"layout": "title_body", "title": "Fleet Utilization", "body": "{{fleet_utilization}}"},
                {"layout": "title_body", "title": "Hashprice Analysis", "body": "{{hashprice_analysis}}"},
                {"layout": "title_body", "title": "Market Conditions", "body": "{{market_conditions}}"},
                {"layout": "title_body", "title": "Insurance Progress", "body": "{{insurance_progress}}"},
                {"layout": "title_body", "title": "Pipeline", "body": "{{pipeline_summary}}"},
                {"layout": "title_body", "title": "Team", "body": "{{team_updates}}"},
                {"layout": "blank", "title": "Appendix"},
            ],
        },
    ),
    "site_review": DocumentTemplate(
        id="site_review",
        tenant_id="sangha",
        type="slides",
        name="Site Review",
        description="6-slide site performance review",
        variables=["site_name", "hashrate", "uptime", "issues"],
        structure={
            "slides": [
                {"layout": "title", "title": "Site Review: {{site_name}}"},
                {"layout": "title_body", "title": "Site Overview", "body": "{{site_overview}}"},
                {"layout": "title_body", "title": "Performance Metrics", "body": "{{performance_metrics}}"},
                {"layout": "title_body", "title": "Issues", "body": "{{issues}}"},
                {"layout": "title_body", "title": "Recommendations", "body": "{{recommendations}}"},
                {"layout": "title_body", "title": "Timeline", "body": "{{timeline}}"},
            ],
        },
    ),
    "prospect_pitch": DocumentTemplate(
        id="prospect_pitch",
        tenant_id="sangha",
        type="slides",
        name="Prospect Pitch",
        description="5-slide pitch deck for new site prospects",
        variables=["prospect_name", "asset_type", "region"],
        structure={
            "slides": [
                {"layout": "title", "title": "{{prospect_name}}", "subtitle": "Behind-the-Meter Opportunity"},
                {"layout": "title_body", "title": "The Problem", "body": "{{problem_statement}}"},
                {"layout": "title_body", "title": "Our Solution", "body": "{{solution}}"},
                {"layout": "title_body", "title": "Case Study", "body": "{{case_study}}"},
                {"layout": "title_body", "title": "Next Steps", "body": "{{next_steps}}"},
            ],
        },
    ),
    # Sheets
    "monthly_pnl": DocumentTemplate(
        id="monthly_pnl",
        tenant_id="sangha",
        type="sheet",
        name="Monthly P&L",
        description="Revenue, energy costs, pool fees, maintenance, net margin by site",
        variables=["month", "year"],
        structure={
            "sheets": [{
                "name": "P&L",
                "headers": ["Site", "Revenue", "Energy Cost", "Pool Fees", "Maintenance", "Net Margin", "Margin %"],
                "formatting": {
                    "header_bold": True,
                    "currency_columns": [1, 2, 3, 4, 5],
                    "percentage_columns": [6],
                },
            }],
        },
    ),
    "fleet_inventory": DocumentTemplate(
        id="fleet_inventory",
        tenant_id="sangha",
        type="sheet",
        name="Fleet Inventory",
        description="Model, count, hashrate, efficiency, breakeven, age, location",
        variables=["date"],
        structure={
            "sheets": [{
                "name": "Fleet",
                "headers": ["Model", "Count", "Hashrate (TH/s)", "Efficiency (J/TH)", "Breakeven ($/MWh)", "Avg Age (months)", "Location"],
                "formatting": {"header_bold": True, "currency_columns": [4]},
            }],
        },
    ),
    "lead_pipeline": DocumentTemplate(
        id="lead_pipeline",
        tenant_id="sangha",
        type="sheet",
        name="Lead Pipeline Tracker",
        description="Contact, company, asset, region, stage, last activity, notes",
        variables=[],
        structure={
            "sheets": [{
                "name": "Pipeline",
                "headers": ["Contact", "Company", "Asset Type", "Region", "Stage", "Last Activity", "Notes"],
                "formatting": {"header_bold": True},
            }],
        },
    ),
    "pool_comparison": DocumentTemplate(
        id="pool_comparison",
        tenant_id="sangha",
        type="sheet",
        name="Pool Comparison",
        description="Pool name, fee, payout model, hashrate share, monthly earnings, net difference",
        variables=["date"],
        structure={
            "sheets": [{
                "name": "Pools",
                "headers": ["Pool", "Fee %", "Payout Model", "Hashrate (PH/s)", "Monthly Earnings", "Net Difference"],
                "formatting": {"header_bold": True, "currency_columns": [4, 5], "percentage_columns": [1]},
            }],
        },
    ),
    # Docs
    "daily_ops_report": DocumentTemplate(
        id="daily_ops_report",
        tenant_id="sangha",
        type="doc",
        name="Daily Operations Report",
        description="Daily summary of operations, alerts, and action items",
        variables=["date", "hashrate", "uptime", "alerts"],
        structure={
            "content": "# Daily Operations Report — {{date}}\n\n## Fleet Summary\n{{fleet_summary}}\n\n## Alerts\n{{alerts}}\n\n## Action Items\n{{action_items}}",
        },
    ),
    "meeting_summary": DocumentTemplate(
        id="meeting_summary",
        tenant_id="sangha",
        type="doc",
        name="Meeting Summary",
        description="Attendees, agenda, decisions, action items, transcript excerpt",
        variables=["meeting_title", "date", "attendees"],
        structure={
            "content": "# {{meeting_title}}\n\n**Date:** {{date}}\n**Attendees:** {{attendees}}\n\n## Agenda\n{{agenda}}\n\n## Decisions\n{{decisions}}\n\n## Action Items\n{{action_items}}\n\n## Transcript Excerpt\n{{transcript}}",
        },
    ),
    "curtailment_report": DocumentTemplate(
        id="curtailment_report",
        tenant_id="sangha",
        type="doc",
        name="Curtailment Event Report",
        description="Trigger, machines affected, duration, savings, recommendations",
        variables=["date", "site", "trigger_price", "duration", "savings"],
        structure={
            "content": "# Curtailment Event Report\n\n**Date:** {{date}}\n**Site:** {{site}}\n\n## Trigger\n{{trigger_details}}\n\n## Impact\n- Machines paused: {{machines_paused}}\n- Duration: {{duration}}\n- Savings: {{savings}}\n\n## Recommendations\n{{recommendations}}",
        },
    ),
    "insurance_term_sheet": DocumentTemplate(
        id="insurance_term_sheet",
        tenant_id="sangha",
        type="doc",
        name="Insurance Term Sheet Draft",
        description="Draft insurance term sheet for underwriter review",
        variables=["counterparty", "coverage_amount", "premium"],
        structure={
            "content": "# Insurance Term Sheet — DRAFT\n\n**Counterparty:** {{counterparty}}\n**Coverage:** {{coverage_amount}}\n**Premium:** {{premium}}\n\n## Terms\n{{terms}}\n\n## Conditions\n{{conditions}}\n\n## Exclusions\n{{exclusions}}",
        },
    ),
}

# ─── DACP (Construction) Templates ──────────────────────────────────────────

DACP_TEMPLATES = {
    # Slides
    "job_proposal": DocumentTemplate(
        id="job_proposal",
        tenant_id="dacp",
        type="slides",
        name="Job Proposal",
        description="Project overview, scope, pricing, timeline, team, references",
        variables=["project_name", "gc_name", "total_price"],
        structure={
            "slides": [
                {"layout": "title", "title": "{{project_name}}", "subtitle": "Proposal for {{gc_name}}"},
                {"layout": "title_body", "title": "Project Overview", "body": "{{project_overview}}"},
                {"layout": "title_body", "title": "Scope of Work", "body": "{{scope}}"},
                {"layout": "title_body", "title": "Pricing", "body": "{{pricing}}"},
                {"layout": "title_body", "title": "Timeline", "body": "{{timeline}}"},
                {"layout": "title_body", "title": "References", "body": "{{references}}"},
            ],
        },
    ),
    "qbr": DocumentTemplate(
        id="qbr",
        tenant_id="dacp",
        type="slides",
        name="Quarterly Business Review",
        description="Revenue, win rate, active jobs, margin analysis, pipeline",
        variables=["quarter", "year"],
        structure={
            "slides": [
                {"layout": "title", "title": "Quarterly Business Review", "subtitle": "Q{{quarter}} {{year}}"},
                {"layout": "title_body", "title": "Revenue", "body": "{{revenue_summary}}"},
                {"layout": "title_body", "title": "Win Rate", "body": "{{win_rate_analysis}}"},
                {"layout": "title_body", "title": "Active Jobs", "body": "{{active_jobs}}"},
                {"layout": "title_body", "title": "Margin Analysis", "body": "{{margin_analysis}}"},
                {"layout": "title_body", "title": "Pipeline", "body": "{{pipeline}}"},
            ],
        },
    ),
    # Sheets
    "estimate_workbook": DocumentTemplate(
        id="estimate_workbook",
        tenant_id="dacp",
        type="sheet",
        name="Estimate Workbook",
        description="Scope items, quantities, unit costs, totals, markup, grand total",
        variables=["project_name", "gc_name"],
        structure={
            "sheets": [{
                "name": "Estimate",
                "headers": ["Item", "Description", "Quantity", "Unit", "Unit Cost", "Total", "Markup %", "Bid Price"],
                "formatting": {
                    "header_bold": True,
                    "currency_columns": [4, 5, 7],
                    "percentage_columns": [6],
                },
            }],
        },
    ),
    "job_cost_tracker": DocumentTemplate(
        id="job_cost_tracker",
        tenant_id="dacp",
        type="sheet",
        name="Job Cost Tracker",
        description="Estimated vs actual: materials, labor, equipment, margin",
        variables=["job_number", "project_name"],
        structure={
            "sheets": [
                {
                    "name": "Summary",
                    "headers": ["Category", "Estimated", "Actual", "Variance", "Variance %"],
                    "formatting": {"header_bold": True, "currency_columns": [1, 2, 3], "percentage_columns": [4]},
                },
                {
                    "name": "Detail",
                    "headers": ["Date", "Category", "Vendor", "Description", "Amount", "PO #"],
                    "formatting": {"header_bold": True, "currency_columns": [4]},
                },
            ],
        },
    ),
    "bid_log": DocumentTemplate(
        id="bid_log",
        tenant_id="dacp",
        type="sheet",
        name="Bid Log",
        description="GC, project, scope, bid amount, status, win/loss, competitor pricing",
        variables=["year"],
        structure={
            "sheets": [{
                "name": "Bids",
                "headers": ["GC", "Project", "Scope", "Bid Amount", "Status", "Result", "Competitor Low", "Margin %"],
                "formatting": {
                    "header_bold": True,
                    "currency_columns": [3, 6],
                    "percentage_columns": [7],
                    "conditional_formatting": [
                        {"column": 7, "rule": "less_than", "value": 0.08, "color": "#fbeae8"},
                    ],
                },
            }],
        },
    ),
    # Docs
    "bid_response_letter": DocumentTemplate(
        id="bid_response_letter",
        tenant_id="dacp",
        type="doc",
        name="Bid Response Letter",
        description="Formal bid response letter to general contractor",
        variables=["gc_name", "project_name", "bid_amount", "date"],
        structure={
            "content": "# Bid Response\n\n**To:** {{gc_name}}\n**Project:** {{project_name}}\n**Date:** {{date}}\n\nDear {{gc_contact}},\n\nPlease find enclosed our bid for the {{scope}} scope of work on {{project_name}}.\n\n## Bid Amount: {{bid_amount}}\n\n{{bid_details}}\n\n## Inclusions\n{{inclusions}}\n\n## Exclusions\n{{exclusions}}\n\n## Schedule\n{{schedule}}\n\nSincerely,\n{{sender_name}}\nDACP Foundations",
        },
    ),
    "field_report_summary": DocumentTemplate(
        id="field_report_summary",
        tenant_id="dacp",
        type="doc",
        name="Field Report Summary",
        description="Daily field report with progress, issues, and photos",
        variables=["job_number", "date", "superintendent"],
        structure={
            "content": "# Field Report — {{job_number}}\n\n**Date:** {{date}}\n**Superintendent:** {{superintendent}}\n\n## Work Completed\n{{work_completed}}\n\n## Materials Used\n{{materials}}\n\n## Issues / Delays\n{{issues}}\n\n## Tomorrow's Plan\n{{tomorrow_plan}}",
        },
    ),
    "change_order": DocumentTemplate(
        id="change_order",
        tenant_id="dacp",
        type="doc",
        name="Change Order Request",
        description="Formal change order request with cost and schedule impact",
        variables=["co_number", "job_number", "project_name", "amount"],
        structure={
            "content": "# Change Order Request #{{co_number}}\n\n**Job:** {{job_number}} — {{project_name}}\n**Date:** {{date}}\n\n## Description of Change\n{{description}}\n\n## Cost Impact: {{amount}}\n{{cost_breakdown}}\n\n## Schedule Impact\n{{schedule_impact}}\n\n## Justification\n{{justification}}",
        },
    ),
    "weather_delay_claim": DocumentTemplate(
        id="weather_delay_claim",
        tenant_id="dacp",
        type="doc",
        name="Weather Delay Claim",
        description="Formal weather delay claim with documentation",
        variables=["job_number", "date_range", "days_claimed"],
        structure={
            "content": "# Weather Delay Claim\n\n**Job:** {{job_number}}\n**Period:** {{date_range}}\n**Days Claimed:** {{days_claimed}}\n\n## Weather Events\n{{weather_events}}\n\n## Impact on Work\n{{work_impact}}\n\n## Supporting Documentation\n{{documentation}}",
        },
    ),
}

# ─── Combined template registry ─────────────────────────────────────────────

TEMPLATES: dict[str, DocumentTemplate] = {**SANGHA_TEMPLATES, **DACP_TEMPLATES}


def get_template(template_id: str, tenant_id: Optional[str] = None) -> Optional[DocumentTemplate]:
    """Retrieve a template by ID, optionally filtered by tenant."""
    tmpl = TEMPLATES.get(template_id)
    if tmpl and tenant_id and tmpl.tenant_id and tmpl.tenant_id != tenant_id:
        return None
    return tmpl


def fill_template(template: DocumentTemplate, data: dict) -> dict:
    """Replace {{variable}} placeholders in template structure with data values."""
    structure_str = str(template.structure)
    for key, value in data.items():
        structure_str = structure_str.replace("{{" + key + "}}", str(value))
    # Remove any unfilled placeholders
    structure_str = re.sub(r"\{\{[^}]+\}\}", "", structure_str)
    return eval(structure_str)  # Safe here as structure is from our own templates


def list_templates(tenant_id: Optional[str] = None) -> list[DocumentTemplate]:
    """List all available templates, optionally filtered by tenant."""
    results = []
    for tmpl in TEMPLATES.values():
        if tenant_id is None or tmpl.tenant_id is None or tmpl.tenant_id == tenant_id:
            results.append(tmpl)
    return results
