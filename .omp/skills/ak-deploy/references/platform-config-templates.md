# Deployment Doc Template

After a successful deploy, update the existing owning deployment document
discovered through repository navigation, and only when the operational contract
changed. Create one only when the project has none and the information is worth
keeping. Route the change through the project's documentation workflow
(`/ak:docs update`) for the route-record schema.

- Record the retrieval route, never a credential value.
- Classify dashboard URLs, account or project ids, and vault locators against the repository's audience before recording them. When that audience is public, inaccessible, or unverifiable, keep the detail in an approved restricted owner and record a non-sensitive pointer plus a blocker instead; never create a public fallback.
- Redact incidental secrets and personal data, including from any example, receipt, or diff.
- Keep observed state out of the document.

```markdown
# Deployment

## Platform
[Platform name] — [URL to dashboard]

## Production URL
[https://your-app.example.com]

## Deploy Command
\`\`\`bash
[deploy command here]
\`\`\`

## Environment Variables
| Variable | Source of value |
|---|---|
| `DATABASE_URL` | secret store or broker entry (record the locator, not the value) |
| `API_TOKEN` | deploy platform secret store |

## Custom Domain
[Steps to configure custom domain, if applicable]

## Rollback
\`\`\`bash
[rollback command — e.g., vercel rollback, fly releases, etc.]
\`\`\`

## Troubleshooting
[Common issues and solutions]
```
