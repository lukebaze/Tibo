# CTI Expert Command Reference

Commands are organized by AEAD case lifecycle phase.

## 1. Acquire
Collect raw intelligence from open sources:
- `/case [target]` — Full autonomous investigation running all applicable vectors.
- `/sweep [target]` — Multi-vector recon across domains, handles, emails, or IPs.
- `/query [subject]` — Builds 12–15 precision search engine dorks.
- `/username [handle]` — Enumerates handle across 3000+ public platforms.
- `/phone [number]` — Carrier, line type, reputation, and public associations.
- `/email-deep [email]` — Account footprints, breach history, mail infrastructure.
- `/subdomain [domain]` — Certificate transparency logs, passive enumeration.
- `/breach-deep [email]` — Breach lookup with credential context.
- `/threat-check [target]` — Threat intelligence scoring on IP/domain/URL/hash.
- `/scam-check [domain]` — Phishing, scam, and fraudulent domain analysis.
- `/vuln-check [query]` — CVE and vulnerability lookup (NVD + CIRCL).
- `/docleak [target]` — Multi-platform document and credential leak sweep.
- `/dns-history [domain]` — Historical DNS record changes (A, NS, MX).
- `/cert-history [domain]` — SSL/TLS certificate timeline from CT logs.

## 2. Enrich
Expand leads and discover latent connections:
- `/branch [data]` — Expand a discovered identifier laterally.
- `/timeline [subject]` — Assemble dated event sequence.
- `/crossref` — Detect shared identifiers across subjects.
- `/link-subjects [A] [B]` — Define connection between two subjects.
- `/show-connections` — Display all logged connections.
- `/graph` — Full relationship map.
- `/pathfind [A] [B]` — Discover connection path between subjects.

## 3. Assess
Score risk and verify evidence:
- `/exposure [target]` — Composite exposure score (0–100).
- `/threat-model` — Build threat model from validated findings.
- `/signatures` — Surface recurring behavioral patterns.
- `/validate` — Quality audit score (0–100).
- `/verify-finding [id]` — Re-check sources for a specific finding.
- `/blind-spots` — Prioritized investigation gap analysis.

## 4. Deliver
Package intelligence artifacts:
- `/report` — Technical intelligence summary (.md + .docx + optional .html).
- `/report brief` — Single-page executive brief.
- `/report legal` — Chain-of-custody evidence format.
- `/report ioc` — STIX 2.1 or flat IOC export.
- `/workspace save [name]` — Persist case state.
- `/workspace open [name]` — Resume saved case.
