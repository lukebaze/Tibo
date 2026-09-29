# STRIDE + OWASP Security Checklist

Reference checklist for `ak:security` audits. Use during Step 6 (STRIDE Analysis) and Step 7 (OWASP Top 10 Check).

---

## STRIDE Checklist

### Spoofing (Authentication)
- [ ] All endpoints require authentication (unless intentionally public)
- [ ] Passwords hashed with bcrypt/argon2 — not MD5 or SHA1
- [ ] JWT tokens have expiration (`exp`) and are validated server-side
- [ ] Session management uses `Secure`, `HttpOnly`, `SameSite` cookie flags
- [ ] Multi-factor auth available for sensitive operations
- [ ] OAuth/OIDC flows use `state` parameter to prevent CSRF
- [ ] Default credentials removed from all services and dependencies

### Tampering (Integrity)
- [ ] Input validation on all user-supplied data (type, length, format)
- [ ] Parameterized queries used — no string concatenation for SQL/NoSQL
- [ ] CSRF tokens present on all state-changing forms
- [ ] Request signing for API-to-API calls (HMAC or mTLS)
- [ ] File uploads validated for type (magic bytes), size, and content
- [ ] Deserialization of untrusted data avoided or sandboxed
- [ ] HTTP methods restricted per endpoint (no GET for mutations)

### Repudiation (Logging)
- [ ] Authentication events logged: login, logout, failures
- [ ] Authorization failures logged with user/resource context
- [ ] Data modification events logged with actor and timestamp
- [ ] Logs do not contain sensitive data (passwords, tokens, PII)
- [ ] Log integrity protected — append-only storage or centralized sink
- [ ] Logs retained per compliance requirements (90 days minimum)

### Information Disclosure
- [ ] Error messages do not leak stack traces in production
- [ ] API responses exclude internal IDs, system paths, or version strings
- [ ] Sensitive data encrypted at rest (AES-256 or equivalent)
- [ ] All transport uses TLS 1.2+ — no HTTP for sensitive endpoints
- [ ] No hardcoded secrets in source code (see Secret Patterns below)
- [ ] `.env` files and credential files listed in `.gitignore`
- [ ] API responses filtered to minimum necessary fields (no over-fetching)

### Denial of Service
- [ ] Rate limiting on authentication and sensitive endpoints
- [ ] Request body size limits configured at server/gateway level
- [ ] Pagination enforced on all list endpoints (no unbounded queries)
- [ ] Timeouts set on all external API and database calls
- [ ] Connection pools sized and cleaned up properly
- [ ] Regex patterns reviewed for catastrophic backtracking (ReDoS)
- [ ] Background jobs have concurrency limits and dead-letter queues

### Elevation of Privilege
- [ ] Role-based access control (RBAC) enforced server-side, not client-side
- [ ] Horizontal privilege checks: user A cannot access user B's resources (IDOR)
- [ ] Admin endpoints have separate, stricter auth middleware
- [ ] Privilege escalation paths require re-authentication
- [ ] Service accounts use principle of least privilege
- [ ] Third-party integrations scoped to minimum required permissions

---

## OWASP Top 10 Quick Reference

| # | Category | What to Check |
|---|----------|---------------|
| A01 | Broken Access Control | Missing auth checks, IDOR vulnerabilities, CORS misconfiguration, path traversal |
| A02 | Cryptographic Failures | Weak hashing (MD5/SHA1), plaintext storage, missing TLS, weak cipher suites |
| A03 | Injection | SQL, NoSQL, OS command, LDAP, template injection via unsanitized input |
| A04 | Insecure Design | Missing threat model, business logic flaws, no abuse-case testing |
| A05 | Security Misconfiguration | Default credentials, verbose error pages, unnecessary features/ports enabled |
| A06 | Vulnerable Components | Outdated dependencies, known CVEs, unpatched libraries |
| A07 | Auth Failures | Brute force possible, credential stuffing, session fixation, weak tokens |
| A08 | Data Integrity Failures | Unsigned updates, unverified deserialization, CI/CD pipeline compromise |
| A09 | Logging Failures | Missing security event logs, no alerting, insufficient monitoring coverage |
| A10 | SSRF | Unvalidated user-supplied URLs, internal service access via fetch/curl |

---

## Secret & Vulnerability Patterns

For the full catalog of high-confidence and medium-confidence secret regex patterns, credential formats, and false-positive exclusion rules, see `secret-patterns.md`.

For code vulnerability patterns (SQL injection, XSS, command injection, path traversal, insecure randomness, dangerous deserialization), see `vulnerability-patterns.md`.
