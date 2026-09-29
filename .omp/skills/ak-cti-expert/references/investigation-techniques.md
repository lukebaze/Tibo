# CTI Investigation Techniques & Subject Registry

## Subject & Connection Model

Subject Types:
- **Person**: Full name, aliases, online handles, phone, email, public records.
- **Organization**: Company, domain, subsidiaries, infrastructure, tenant IDs.
- **Domain / Infrastructure**: Domain, DNS, SSL certs, IP addresses, ASNs, mail servers.
- **Artifact**: File hash, leaked document, PGP key, code repository.
- **Credential / Secret**: Leaked passwords, exposed API tokens, compromised database entries.

## Investigation Techniques

1. **Domain & Subdomain Reconnaissance**:
   - Certificate transparency searching (crt.sh, CT logs).
   - Passive DNS historical records.
   - Mail server configuration (SPF, DKIM, DMARC) and tenant identifiers.
2. **Identity & Username Correlation**:
   - Platform availability probes across developer, social, and gaming networks.
   - Cross-referencing usernames with PGP keys and Git commit author metadata.
3. **Leak & Document Intelligence**:
   - Filetype-specific dork queries (`filetype:pdf`, `filetype:xlsx`, `filetype:env`, `filetype:sql`).
   - Document metadata extraction (author names, software versions, internal paths).
4. **Threat & Vulnerability Scoring**:
   - CVE mapping against disclosed software stacks.
   - Ransomware victim monitoring and darknet paste site checks.
