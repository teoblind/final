#!/usr/bin/env python3
"""
Quick heuristic classifier for Sangha HubSpot contacts.
Uses domain patterns and company name keywords to classify contacts
without needing an LLM. Writes results back via HubSpot batch API.
"""

import json
import os
import time
import urllib.request

API_KEY = os.environ.get("HUBSPOT_API_KEY", "")
BASE = "https://api.hubapi.com"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}

PROPERTIES = [
    "firstname", "lastname", "email", "company", "jobtitle", "industry",
    "sangha_industry", "sangha_reason_to_contact", "sangha_email_type",
]

# Domain keyword -> (industry, reason, materials)
DOMAIN_RULES = {
    # Energy
    "energy": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "power": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "solar": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "wind": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "utility": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "electric": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "renewable": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "grid": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    "watt": ("Renewable Energy", "Potential IPP Client", "General Newsletter"),
    # Mining / Crypto
    "mining": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "bitcoin": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "btc": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "crypto": ("Bitcoin services", "Marketing Opportunities", "General Newsletter"),
    "blockchain": ("Bitcoin services", "Marketing Opportunities", "General Newsletter"),
    "hash": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "miner": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "blockstream": ("Bitcoin services", "Marketing Opportunities", "General Newsletter"),
    "marathon": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "riot": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "cleanspark": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "bitdeer": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "terawulf": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "hut8": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "iris": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "cipher": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "core": ("Bitcoin mining", "Potential IPP Client", "General Newsletter"),
    "blockvolution": ("Bitcoin services", "Marketing Opportunities", "General Newsletter"),
    "luxor": ("Bitcoin services", "Technical Support", "General Newsletter"),
    # Investment / Finance
    "capital": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "ventures": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "invest": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "fund": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "equity": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "asset": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "partners": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "advisory": ("Investment/Finance", "Advisor", "Investment Teaser"),
    "wealth": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "finance": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "fidelity": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "goldman": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "morgan": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "bank": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    # Insurance
    "insurance": ("Insurance", "Marketing Opportunities", "General Marketing"),
    "insur": ("Insurance", "Marketing Opportunities", "General Marketing"),
    "underwrite": ("Insurance", "Marketing Opportunities", "General Marketing"),
    "marsh": ("Insurance", "Marketing Opportunities", "General Marketing"),
    # Legal
    "law": ("Legal", "Advisor", "General Newsletter"),
    "legal": ("Legal", "Advisor", "General Newsletter"),
    "counsel": ("Legal", "Advisor", "General Newsletter"),
    "attorney": ("Legal", "Advisor", "General Newsletter"),
    # Engineering
    "engineer": ("Engineering", "Technical Support", "General Newsletter"),
    "design": ("Engineering", "Technical Support", "General Newsletter"),
    # Construction
    "construct": ("Construction", "Marketing Opportunities", "General Marketing"),
    "build": ("Construction", "Marketing Opportunities", "General Marketing"),
    # Real Estate
    "realty": ("Real Estate", "Marketing Opportunities", "General Marketing"),
    "property": ("Real Estate", "Marketing Opportunities", "General Marketing"),
    "estate": ("Real Estate", "Marketing Opportunities", "General Marketing"),
    # SaaS
    "software": ("SaaS - Web 2", "Technical Support", "General Newsletter"),
    "saas": ("SaaS - Web 2", "Technical Support", "General Newsletter"),
    "cloud": ("SaaS - Web 2", "Technical Support", "General Newsletter"),
    "tech": ("SaaS - Web 2", "Technical Support", "General Newsletter"),
    "app": ("SaaS - Web 2", "Technical Support", "General Newsletter"),
    # Electrical Equipment
    "electrical": ("Electrical Equipment", "Technical Support", "General Newsletter"),
    "transformer": ("Electrical Equipment", "Technical Support", "General Newsletter"),
    "switchgear": ("Electrical Equipment", "Technical Support", "General Newsletter"),
    # Operations
    "operations": ("Operations Management", "Technical Support", "General Newsletter"),
    "logistics": ("Operations Management", "Technical Support", "General Newsletter"),
    # Known companies
    "sangha": ("Renewable Energy", "Friend", "General Newsletter"),
    "ventureaviator": ("Investment/Finance", "Investment - DevCo", "Investment Teaser"),
    "boltonstjohns": ("Legal", "Advisor", "General Newsletter"),
}

# Generic email domains - classify as Other with minimal info
GENERIC_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "me.com", "live.com", "msn.com", "protonmail.com", "mail.com"}


def classify_contact(contact):
    """Classify a single contact using heuristics. Returns None if can't classify."""
    props = contact.get("properties", {})
    email = props.get("email", "") or ""
    company = (props.get("company", "") or "").lower()
    title = (props.get("jobtitle", "") or "").lower()

    # Skip already classified
    if props.get("sangha_industry"):
        return None

    domain = email.split("@")[1].lower() if "@" in email else ""
    domain_name = domain.split(".")[0] if domain else ""

    # Skip generic email domains unless we have company info
    if domain in GENERIC_DOMAINS and not company:
        # Can't classify with just a gmail address and no company
        return {
            "id": contact["id"],
            "industry": "Other",
            "reason": "Other",
            "materials": "General Newsletter",
        }

    # Check domain keywords
    search_text = f"{domain_name} {company} {title}".lower()

    for keyword, (industry, reason, materials) in DOMAIN_RULES.items():
        if keyword in search_text:
            # Refine reason based on title
            if "ceo" in title or "founder" in title or "partner" in title or "president" in title:
                if industry == "Investment/Finance":
                    reason = "Investment - DevCo"
                elif industry in ("Renewable Energy", "Bitcoin mining"):
                    reason = "Potential IPP Client"
            elif "engineer" in title or "developer" in title or "technical" in title:
                reason = "Technical Support"
            elif "marketing" in title or "communications" in title:
                reason = "Marketing Opportunities"
            elif "legal" in title or "counsel" in title or "attorney" in title:
                reason = "Advisor"
                industry = "Legal"

            return {
                "id": contact["id"],
                "industry": industry,
                "reason": reason,
                "materials": materials,
            }

    # If we have a company domain but no keyword match, classify as Other
    if domain and domain not in GENERIC_DOMAINS:
        return {
            "id": contact["id"],
            "industry": "Other",
            "reason": "Other",
            "materials": "General Newsletter",
        }

    # Generic email, no company - minimal classification
    return {
        "id": contact["id"],
        "industry": "Other",
        "reason": "Other",
        "materials": "General Newsletter",
    }


def fetch_contacts(after=None):
    """Fetch a page of contacts from HubSpot."""
    url = f"{BASE}/crm/v3/objects/contacts?limit=100&properties={','.join(PROPERTIES)}"
    if after:
        url += f"&after={after}"

    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def batch_update(updates):
    """Batch update contact classifications in HubSpot."""
    inputs = []
    for u in updates:
        props = {}
        if u.get("industry"):
            props["sangha_industry"] = u["industry"]
        if u.get("reason"):
            props["sangha_reason_to_contact"] = u["reason"]
        if u.get("materials"):
            props["sangha_email_type"] = u["materials"]
        inputs.append({"id": u["id"], "properties": props})

    body = json.dumps({"inputs": inputs}).encode()
    req = urllib.request.Request(
        f"{BASE}/crm/v3/objects/contacts/batch/update",
        data=body,
        headers=HEADERS,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  Batch update error: {e.code} - {e.read().decode()[:200]}")
        return None


def main():
    total_fetched = 0
    total_classified = 0
    total_skipped = 0
    after = None
    batch = []

    industry_counts = {}

    while True:
        data = fetch_contacts(after)
        contacts = data.get("results", [])
        if not contacts:
            break

        total_fetched += len(contacts)

        for contact in contacts:
            result = classify_contact(contact)
            if result is None:
                total_skipped += 1
                continue

            batch.append(result)
            ind = result["industry"]
            industry_counts[ind] = industry_counts.get(ind, 0) + 1

            # Send batch when we hit 100
            if len(batch) >= 100:
                print(f"  Sending batch of {len(batch)} updates... (fetched: {total_fetched})")
                resp = batch_update(batch)
                if resp:
                    total_classified += len(batch)
                batch = []
                time.sleep(0.2)  # Rate limiting

        # Check for next page
        paging = data.get("paging", {})
        after = paging.get("next", {}).get("after")
        if not after:
            break

        print(f"Fetched {total_fetched} contacts so far, classified {total_classified}, cursor: {after}")
        time.sleep(0.1)

    # Send remaining batch
    if batch:
        print(f"  Sending final batch of {len(batch)} updates...")
        resp = batch_update(batch)
        if resp:
            total_classified += len(batch)

    print(f"\n=== DONE ===")
    print(f"Total fetched: {total_fetched}")
    print(f"Total classified: {total_classified}")
    print(f"Skipped (already classified): {total_skipped}")
    print(f"\nBy industry:")
    for ind, count in sorted(industry_counts.items(), key=lambda x: -x[1]):
        print(f"  {ind:30s} {count}")


if __name__ == "__main__":
    main()
