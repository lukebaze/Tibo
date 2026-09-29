# CTI External Tool Cascade

The CTI skill utilizes available OSINT and collection tools in a prioritized cascade.

## Collection Cascade

1. **Browser Automation**: `ak:agent-browser` (when installed) for JavaScript-heavy platforms, screenshot evidence, and infinite scroll.
2. **Direct Web Fetch**: Fetch public endpoints and APIs directly via native tools.
3. **Search Engine Queries**: Use structured dork queries via search tools.
4. **Fallback Notice**: Tool limitations are logged as collection gaps in the intelligence report—never as case blockers.

## Tool Safety

- Never perform active exploitation, credential testing, or unauthorized scanning.
- Only inspect publicly available open-source intelligence and public CT logs.
