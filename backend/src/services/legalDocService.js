/**
 * Legal Document Service - NDA and MSA template generation
 *
 * Generates well-formatted markdown legal documents from templates.
 * Returns content that can be saved to Google Docs via workspace tools.
 */

const TODAY = () => new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * Generate a legal document from a template.
 * @param {{ template: string, party_a: string, party_b: string, effective_date?: string,
 *           duration_months?: number, governing_state?: string, additional_terms?: string,
 *           services_description?: string, payment_terms?: string }} params
 * @returns {{ content: string, title: string, template_used: string }}
 */
export function generateLegalDoc(params) {
  const {
    template,
    party_a,
    party_b,
    effective_date = TODAY(),
    duration_months = 24,
    governing_state = 'Texas',
    additional_terms = '',
    services_description = '',
    payment_terms = 'Net 30',
  } = params;

  switch (template) {
    case 'nda_mutual':
      return {
        content: buildMutualNDA({ party_a, party_b, effective_date, duration_months, governing_state, additional_terms }),
        title: `Mutual NDA - ${stripState(party_a)} & ${stripState(party_b)}`,
        template_used: 'nda_mutual',
      };
    case 'nda_one_way':
      return {
        content: buildOneWayNDA({ party_a, party_b, effective_date, duration_months, governing_state, additional_terms }),
        title: `NDA - ${stripState(party_a)} (Disclosing) & ${stripState(party_b)} (Receiving)`,
        template_used: 'nda_one_way',
      };
    case 'msa':
      return {
        content: buildMSA({ party_a, party_b, effective_date, duration_months, governing_state, additional_terms, services_description, payment_terms }),
        title: `Master Service Agreement - ${stripState(party_a)} & ${stripState(party_b)}`,
        template_used: 'msa',
      };
    default:
      throw new Error(`Unknown template: ${template}. Available: nda_mutual, nda_one_way, msa`);
  }
}

function stripState(party) {
  return party.replace(/,?\s*\b[A-Z]{2}\b$/, '').replace(/,?\s*\b\w+\s*(State|state)\b$/, '').trim();
}

// ─── Mutual NDA ──────────────────────────────────────────────────────────────

function buildMutualNDA({ party_a, party_b, effective_date, duration_months, governing_state, additional_terms }) {
  return `# MUTUAL NON-DISCLOSURE AGREEMENT

**Effective Date:** ${effective_date}

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of the Effective Date by and between:

**Party A:** ${party_a} ("First Party")
**Party B:** ${party_b} ("Second Party")

(each a "Party" and collectively, the "Parties")

## 1. PURPOSE

The Parties wish to explore a potential business relationship ("Purpose") and, in connection therewith, may disclose to each other certain confidential and proprietary information. This Agreement sets forth the terms under which such information will be disclosed and protected.

## 2. DEFINITION OF CONFIDENTIAL INFORMATION

"Confidential Information" means any and all non-public information disclosed by either Party (the "Disclosing Party") to the other Party (the "Receiving Party"), whether orally, in writing, electronically, or by any other means, including but not limited to:

- Business plans, strategies, and financial information
- Technical data, trade secrets, know-how, and inventions
- Customer and supplier lists and related information
- Marketing plans and proprietary software
- Any other information designated as "confidential" or that reasonably should be understood to be confidential

## 3. OBLIGATIONS OF RECEIVING PARTY

The Receiving Party agrees to:

a) Hold all Confidential Information in strict confidence;
b) Not disclose Confidential Information to any third party without the prior written consent of the Disclosing Party;
c) Use Confidential Information solely for the Purpose;
d) Limit access to Confidential Information to those employees, agents, or advisors who have a need to know and who are bound by confidentiality obligations at least as restrictive as those contained herein;
e) Protect Confidential Information using at least the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care.

## 4. EXCLUSIONS

Confidential Information does not include information that:

a) Is or becomes publicly available through no fault of the Receiving Party;
b) Was known to the Receiving Party prior to disclosure, as documented by written records;
c) Is independently developed by the Receiving Party without use of or reference to the Confidential Information;
d) Is rightfully received from a third party without restriction on disclosure.

## 5. REQUIRED DISCLOSURES

The Receiving Party may disclose Confidential Information to the extent required by law, regulation, or court order, provided that the Receiving Party gives the Disclosing Party prompt written notice of such requirement (to the extent legally permitted) and cooperates with the Disclosing Party's efforts to obtain a protective order.

## 6. TERM AND TERMINATION

This Agreement shall remain in effect for a period of **${duration_months} months** from the Effective Date. Either Party may terminate this Agreement upon thirty (30) days' written notice. The obligations of confidentiality shall survive termination for a period of two (2) years.

## 7. RETURN OF MATERIALS

Upon termination or at the Disclosing Party's request, the Receiving Party shall promptly return or destroy all Confidential Information and any copies thereof, and certify in writing that it has done so.

## 8. NO LICENSE OR WARRANTY

Nothing in this Agreement grants either Party any rights to the other Party's Confidential Information, except the limited right to review such information for the Purpose. ALL CONFIDENTIAL INFORMATION IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND.

## 9. REMEDIES

Each Party acknowledges that a breach of this Agreement may cause irreparable harm for which monetary damages would be inadequate. Accordingly, either Party may seek equitable relief, including injunction and specific performance, in addition to any other available remedies.

## 10. GOVERNING LAW

This Agreement shall be governed by and construed in accordance with the laws of the State of **${governing_state}**, without regard to its conflict of laws principles.

## 11. MISCELLANEOUS

a) This Agreement constitutes the entire agreement between the Parties regarding the subject matter hereof.
b) This Agreement may not be amended except by a written instrument signed by both Parties.
c) Neither Party may assign this Agreement without the prior written consent of the other Party.
d) If any provision is found unenforceable, the remaining provisions shall continue in full force and effect.
${additional_terms ? `\n## 12. ADDITIONAL TERMS\n\n${additional_terms}\n` : ''}
---

**IN WITNESS WHEREOF**, the Parties have executed this Agreement as of the Effective Date.

**${party_a}**

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

**${party_b}**

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________`;
}

// ─── One-Way NDA ─────────────────────────────────────────────────────────────

function buildOneWayNDA({ party_a, party_b, effective_date, duration_months, governing_state, additional_terms }) {
  return `# NON-DISCLOSURE AGREEMENT (ONE-WAY)

**Effective Date:** ${effective_date}

This Non-Disclosure Agreement ("Agreement") is entered into as of the Effective Date by and between:

**Disclosing Party:** ${party_a}
**Receiving Party:** ${party_b}

## 1. PURPOSE

The Disclosing Party intends to disclose certain confidential and proprietary information to the Receiving Party for the purpose of evaluating a potential business relationship ("Purpose").

## 2. DEFINITION OF CONFIDENTIAL INFORMATION

"Confidential Information" means any and all non-public information disclosed by the Disclosing Party to the Receiving Party, whether orally, in writing, electronically, or by any other means, including but not limited to business plans, financial information, technical data, trade secrets, customer lists, marketing strategies, and proprietary software.

## 3. OBLIGATIONS OF RECEIVING PARTY

The Receiving Party agrees to:

a) Hold all Confidential Information in strict confidence;
b) Not disclose Confidential Information to any third party without the prior written consent of the Disclosing Party;
c) Use Confidential Information solely for the Purpose;
d) Limit access to Confidential Information to those employees and advisors who have a need to know and who are bound by confidentiality obligations;
e) Protect Confidential Information using at least the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care.

## 4. EXCLUSIONS

Confidential Information does not include information that:

a) Is or becomes publicly available through no fault of the Receiving Party;
b) Was known to the Receiving Party prior to disclosure;
c) Is independently developed by the Receiving Party without reference to the Confidential Information;
d) Is rightfully received from a third party without restriction.

## 5. REQUIRED DISCLOSURES

The Receiving Party may disclose Confidential Information to the extent required by law, regulation, or court order, provided that the Receiving Party gives the Disclosing Party prompt written notice and cooperates with efforts to obtain a protective order.

## 6. TERM AND TERMINATION

This Agreement shall remain in effect for **${duration_months} months** from the Effective Date. The Disclosing Party may terminate this Agreement at any time upon written notice. Confidentiality obligations survive termination for two (2) years.

## 7. RETURN OF MATERIALS

Upon termination or request, the Receiving Party shall promptly return or destroy all Confidential Information and certify in writing that it has done so.

## 8. NO LICENSE OR WARRANTY

Nothing in this Agreement grants the Receiving Party any rights to the Confidential Information beyond the limited right to review it for the Purpose. ALL CONFIDENTIAL INFORMATION IS PROVIDED "AS IS."

## 9. REMEDIES

The Receiving Party acknowledges that breach may cause irreparable harm. The Disclosing Party may seek equitable relief in addition to any other available remedies.

## 10. GOVERNING LAW

This Agreement shall be governed by the laws of the State of **${governing_state}**, without regard to conflict of laws principles.

## 11. MISCELLANEOUS

a) This Agreement constitutes the entire agreement regarding its subject matter.
b) Amendments must be in writing and signed by both Parties.
c) Assignment requires prior written consent.
d) Severability applies to unenforceable provisions.
${additional_terms ? `\n## 12. ADDITIONAL TERMS\n\n${additional_terms}\n` : ''}
---

**IN WITNESS WHEREOF**, the Parties have executed this Agreement as of the Effective Date.

**${party_a}** (Disclosing Party)

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

**${party_b}** (Receiving Party)

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________`;
}

// ─── Master Service Agreement ────────────────────────────────────────────────

function buildMSA({ party_a, party_b, effective_date, duration_months, governing_state, additional_terms, services_description, payment_terms }) {
  return `# MASTER SERVICE AGREEMENT

**Effective Date:** ${effective_date}

This Master Service Agreement ("Agreement") is entered into as of the Effective Date by and between:

**Client:** ${party_a} ("Client")
**Service Provider:** ${party_b} ("Provider")

(each a "Party" and collectively, the "Parties")

## 1. SERVICES

${services_description
    ? `The Provider shall perform the following services ("Services"):\n\n${services_description}`
    : 'The Provider shall perform services as described in one or more Statements of Work ("SOW") executed pursuant to this Agreement. Each SOW shall be incorporated by reference and subject to the terms of this Agreement.'}

## 2. TERM AND TERMINATION

**2.1 Term.** This Agreement shall commence on the Effective Date and continue for **${duration_months} months** ("Initial Term"), unless terminated earlier in accordance with this Section. After the Initial Term, this Agreement shall automatically renew for successive one-year periods unless either Party provides sixty (60) days' written notice of non-renewal.

**2.2 Termination for Convenience.** Either Party may terminate this Agreement upon sixty (60) days' prior written notice.

**2.3 Termination for Cause.** Either Party may terminate this Agreement immediately upon written notice if the other Party materially breaches this Agreement and fails to cure such breach within thirty (30) days after receiving written notice.

**2.4 Effect of Termination.** Upon termination, the Provider shall deliver all work product completed through the termination date, and the Client shall pay for all Services performed through such date.

## 3. COMPENSATION AND PAYMENT

**3.1 Fees.** The Client shall pay the Provider the fees set forth in the applicable SOW or as otherwise agreed in writing.

**3.2 Payment Terms.** Unless otherwise specified, payment is due **${payment_terms}** from receipt of invoice.

**3.3 Expenses.** Pre-approved expenses shall be reimbursed at cost upon submission of receipts.

**3.4 Late Payments.** Undisputed amounts not paid when due shall bear interest at 1.5% per month or the maximum rate permitted by law, whichever is less.

## 4. INDEPENDENT CONTRACTOR

The Provider is an independent contractor. Nothing in this Agreement creates an employment, partnership, or agency relationship. The Provider is solely responsible for its taxes, insurance, and compliance with applicable laws.

## 5. CONFIDENTIALITY

**5.1** Each Party agrees to hold in confidence all Confidential Information received from the other Party. "Confidential Information" means non-public information disclosed by either Party that is designated as confidential or that reasonably should be understood to be confidential.

**5.2** Standard exclusions apply (publicly known, independently developed, previously known, received from third party).

**5.3** Confidentiality obligations survive termination for two (2) years.

## 6. INTELLECTUAL PROPERTY

**6.1 Work Product.** All work product created by the Provider specifically for the Client under this Agreement ("Work Product") shall be the sole property of the Client upon full payment. The Provider assigns all rights, title, and interest in the Work Product to the Client.

**6.2 Pre-Existing IP.** The Provider retains all rights to its pre-existing intellectual property, tools, and methodologies. The Provider grants the Client a non-exclusive, perpetual license to use any pre-existing IP incorporated into the Work Product.

## 7. REPRESENTATIONS AND WARRANTIES

**7.1** The Provider represents that: (a) it has the authority to enter into this Agreement; (b) the Services shall be performed in a professional manner consistent with industry standards; (c) the Work Product shall not infringe any third party's intellectual property rights.

**7.2** THE PROVIDER MAKES NO OTHER WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

## 8. LIMITATION OF LIABILITY

**8.1** NEITHER PARTY SHALL BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO THIS AGREEMENT.

**8.2** EACH PARTY'S TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE TOTAL FEES PAID OR PAYABLE UNDER THIS AGREEMENT DURING THE TWELVE (12) MONTHS PRECEDING THE CLAIM.

**8.3** The limitations in this Section shall not apply to: (a) breaches of confidentiality obligations; (b) indemnification obligations; (c) willful misconduct or gross negligence.

## 9. INDEMNIFICATION

**9.1** The Provider shall indemnify and hold harmless the Client from claims arising from: (a) Provider's negligence or willful misconduct; (b) infringement of third-party IP rights by the Work Product; (c) Provider's violation of applicable laws.

**9.2** The Client shall indemnify and hold harmless the Provider from claims arising from Client's use of the Work Product in a manner not contemplated by this Agreement.

## 10. INSURANCE

The Provider shall maintain commercially reasonable insurance coverage, including general liability and professional liability insurance, throughout the term of this Agreement.

## 11. GOVERNING LAW AND DISPUTE RESOLUTION

**11.1** This Agreement shall be governed by and construed in accordance with the laws of the State of **${governing_state}**, without regard to conflict of laws principles.

**11.2** Any dispute arising under this Agreement shall first be subject to good faith negotiation for thirty (30) days. If unresolved, disputes shall be submitted to binding arbitration in ${governing_state} under the rules of the American Arbitration Association.

## 12. MISCELLANEOUS

a) **Entire Agreement.** This Agreement, together with all SOWs, constitutes the entire agreement between the Parties.
b) **Amendments.** Modifications must be in writing and signed by both Parties.
c) **Assignment.** Neither Party may assign without prior written consent, except in connection with a merger or acquisition.
d) **Severability.** If any provision is unenforceable, the remaining provisions continue in full force.
e) **Waiver.** Failure to enforce any provision is not a waiver of future enforcement.
f) **Notices.** All notices shall be in writing and delivered to the addresses specified below.
g) **Force Majeure.** Neither Party is liable for delays caused by events beyond reasonable control.
${additional_terms ? `\n## 13. ADDITIONAL TERMS\n\n${additional_terms}\n` : ''}
---

**IN WITNESS WHEREOF**, the Parties have executed this Agreement as of the Effective Date.

**${party_a}** (Client)

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________

**${party_b}** (Service Provider)

Signature: _________________________
Name: _________________________
Title: _________________________
Date: _________________________`;
}
