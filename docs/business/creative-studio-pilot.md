# SHAH CAT Creative Studio: 30-day outside-customer pilot v0.1

**Status:** Design and local software prototype only (2026-10-29 KST). **No sales, customers, cash receipts or operational approvals have been verified by this document.** Related: [Issue #94](https://github.com/istars8370/shah-cat/issues/94), v1.2 WP-B / F11 (draft plan PR #96).

## Why this precedes SHAH utility

The first test is whether an independent customer buys and approves AI-assisted content **without owning SHAH**. The service must support KRW payment by an otherwise authorized business process; this repository does not accept payments. SHAH membership, SCC non-tradable AI service credits, lock-up, staking and creator token rewards are proposals, not features of the pilot. Token transfers or SHAH price changes are not revenue.

## 30-day decision experiment — targets, not results

| Stage | Target | Evidence before claiming completion |
| --- | --- | --- |
| Prospecting | 10 outside contacts | Dated contact log; exclude internal team and duplicate contacts |
| Discovery | 5 completed interviews | Customer problem and willingness-to-pay notes with consent |
| Samples | 3 reviewed samples | Rights source, labor hours, revision history and reviewer sign-off |
| Sales | 2 external paid orders | Actual funds received, receipt/invoice, signed scope and customer acceptance |
| Economics | Every paid order unit-economics review | Cash costs, hourly labor, fees, refunds and contribution, including losses |
| Retention | Ask all paid customers about re-order | Actual reorders separate from stated intentions |

**External test segments (hypotheses):** local small businesses, Web3 communities, independent musicians/artists. An internal SHAH CAT or Tide community promotional piece is **not** outside paid revenue unless the buyer is genuinely external, pays an independent invoice and the relationship is disclosed.

## Pilot offers (not published promises)

| Hypothesis | Deliverables per month | Quote range to test | Acceptance | Revision |
| --- | --- | ---: | --- | --- |
| Start | Four posts plus two banners | KRW 90,000–150,000 | Dimensions/copy/brand rights approved | One round |
| Growth | Eight posts plus two short videos | KRW 290,000–490,000 | Video captions/audio rights and source approvals | One round |
| Studio later | Repeat assets plus approval workflow | Individual quote | Procurement, model spend and support clarified | Contract-based |

For v0.1 **only text copy and image-prompt drafts are implemented**; banner/short-form production and full order workflow are human-operated outside this application. The product ranges are experimental price hypotheses; do not automatically take orders or advertise unavailable deliverables.

## Human-led operating procedure

1. **Intake:** record service, platform, buyer type, intended rights, delivery date, budget, named reviewer and revision limit in a **private** record.
2. **Verify:** source rights for all images, fonts, logos, music, faces, personal data and AI tool commercial usage terms. Record rights owner and permission evidence. Reject if uncertain.
3. **Produce:** approved operator uses local Studio text draft (demo is **not AI**) or authorized provider, tracking actual work hours/model cost and output version. **No unattended publishing.**
4. **Review:** independent reviewer checks assertions, brand compliance, likeness, data protection, platform rules, copyright, sizes, captions and agreed specification.
5. **Deliver:** customer explicitly approves final assets; any new scope/revisions require documented agreement. Sign-off is human; not inferred from GitHub PR approval.
6. **Settle:** keep receipt, cash costs, worker remuneration, card/API fees, revisions, refunds, taxes and contribution in the private ledger. Separate related-party work and conflict approvals.
7. **Learn:** request repeat-purchase feedback, summarize anonymous weekly KPIs and decide continue/revise/stop.

## Private ledger and contribution model

Public file `creative-studio-orders.template.csv` contains **headers only**. Never add actual customer rows to public GitHub. Store order entries privately with controlled access, backup, permission to use collected information, and an agreed retention/deletion policy.

Required fields: `order_id`, `service`, `price_krw`, `paid_krw`, `cash_cost_krw`, `labor_hours`, `labor_rate_krw`, `labor_cost_krw`, `fee_krw`, `revisions`, `refund_krw`, `contribution_krw`, `external_customer_flag`, `rights_checked`, `delivery_accepted`, `conflict_declared`, `consent_recorded`. Keep proof links and personal identities **only** in controlled private storage, never in this template.

**Contribution (KRW) = paid_krw − refund_krw − cash_cost_krw − (labor_hours × labor_rate_krw) − fee_krw.** Ratio = contribution / (paid − refund); if net paid is zero, ratio is undefined. The UI calculator implements this simplified equation; taxes, fixed costs and unrecorded future revisions are excluded and must be considered separately.

**Scenario only:** A package receives KRW 300,000 with KRW 80,000 cash tools/service cost, 5 hours × KRW 30,000 labor, KRW 10,000 fees and no refund → contribution KRW 60,000 (20%). This is an illustration, **not an actual sale**. A KRW 20,000 optional token membership benefit would reduce contribution to KRW 40,000 if it has actual KRW 20,000 cost; do not treat token transfers as external paid orders.

## Weekly decision scorecard

| Week | Outside contacts | Interviews | Samples approved | Paid outside orders | Net KRW received | Direct+labor+fee KRW | Refund KRW | Contribution KRW | Repeat order (actual/intent) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W1 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| W2 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| W3 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| W4 | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

**Continue (candidate, not automatic):** at least two independently evidenced paid outside orders, accepted delivery, positive repeatable contribution after labor, clean rights evidence and manageable revisions. **Revise:** contacts/interviews show demand but paid orders or margin miss; test offer/pricing/labor process before automation. **Stop/hold:** repeated losses, unlicensable content, customer data concerns, no permission to operate, unreliable delivery or conflicts lacking independent review. Any real commercial operation must satisfy contracts, business registration, tax, invoicing and applicable law.

## Acceptance and gating

- [x] Written customer hypothesis, offer ranges, human quality workflow and 30-day goals
- [x] Blank private-ledger **schema** and contribution formula, no private records
- [x] Local text studio, demo mode, optional consent-gated AI adapter, quote calculator and unit tests (review PR evidence for tested status)
- [ ] Verified prospect interviews and real receipts — **NOT DONE**
- [ ] Validated commercial licenses for each real order — **NOT DONE**
- [ ] Customer delivery approvals and repeat purchase evidence — **NOT DONE**
- [ ] Independent reviewer approval and external production release — **NOT DONE**

No claim of Mainnet, SHAH payment, wallet signature, staking, SCC issuance, automated reward, or public SaaS launch is made by this pilot.
