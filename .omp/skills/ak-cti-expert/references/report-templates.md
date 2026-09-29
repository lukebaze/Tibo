# CTI Report Templates & Deliverables

Every investigation automatically delivers structured intelligence reports.

## Standard Formats

| Format | File Types | Target Audience |
|---|---|---|
| **Technical INTSUM** | `.md`, `.docx`, optional `.html` | Security teams, SOC/IR analysts |
| **Executive Brief** | `.md`, `.docx`, optional `.html` | Leadership, CISOs, management |
| **Legal Evidence** | `.md`, `.docx` | Compliance officers, legal counsel |
| **IOC Export** | `.json`, `.csv`, `.stix` | SIEM, SOAR, firewall ingestion |

## File Export Naming

Reports auto-save to the case workspace:
- `CTI-REPORT-<CASE-ID>-<YYYY-MM-DD>.md`
- `CTI-REPORT-<CASE-ID>-<YYYY-MM-DD>.docx`
- `CTI-REPORT-<CASE-ID>-<YYYY-MM-DD>.html` (when `--format html` is requested)
- `CTI-REPORT-<CASE-ID>-<YYYY-MM-DD>.json`

## Confidence Scoring & Invariants

1. **Analytical Confidence Levels**:
   - **CONFIRMED**: Backed by 2+ independent authoritative sources or cryptographic proof.
   - **PROBABLE**: Strong correlation with corroborating metadata; single reliable source.
   - **POSSIBLE**: Plausible hypothesis; circumstantial link without verification.
2. **Attribution Boundaries**: Never state an unconfirmed actor attribution as a fact.
3. **Data Redaction**: Strip personal credentials, internal IP ranges, and private PII before publication.
