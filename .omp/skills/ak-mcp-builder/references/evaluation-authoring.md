# Testing and evaluation

Two layers: protocol checks prove the server works; task evaluations prove an LLM can
use it to finish realistic work. Registration or a clean `tools/list` proves neither.

## 1. Protocol checks with MCP Inspector

Inspector 2.x requires Node ≥ 22.19. Put the mode flag first; server `-e` variables go
after the target command.

```bash
# stdio: list tools, then call one
npx @modelcontextprotocol/inspector --cli node build/index.js -e EXAMPLE_API_KEY=$EXAMPLE_API_KEY --method tools/list
npx @modelcontextprotocol/inspector --cli node build/index.js -e EXAMPLE_API_KEY=$EXAMPLE_API_KEY \
  --method tools/call --tool-name example_search_users --tool-arg query=ana --tool-arg limit=2

# Python server
npx @modelcontextprotocol/inspector --cli uv run example_mcp.py -e EXAMPLE_API_KEY=$EXAMPLE_API_KEY --method tools/list

# Streamable HTTP
npx @modelcontextprotocol/inspector --cli --server-url http://127.0.0.1:3000/mcp --transport http --method tools/list
```

`--strict` fails on protocol violations; `--tui` opens a terminal UI; no mode flag opens the
browser UI. Check at least:

- every tool has a title, description, `inputSchema`, accurate annotations, and
  `outputSchema` when it returns structured data;
- a valid call returns `structuredContent` that matches the schema plus a text block;
- invalid arguments, upstream 404/403/429, and timeouts return `isError: true` with an
  actionable message and no secrets;
- pagination returns `has_more`/`next_offset` and respects the size limit;
- destructive tools elicit confirmation when the client supports it and otherwise refuse
  until called with `confirm=true` (a model claim, gated by the host's approval policy);
- HTTP: foreign `Origin` gets `403`; missing token `401`; missing scope `403`.

Automate the same cases in the project's test suite: in-process `Client(mcp)` for Python
(`python-server.md`), or an SDK `Client` over stdio/HTTP for TypeScript. Stub the upstream
API; never test destructive paths against production data.

## 2. Task evaluations

Write 10 question/answer pairs that an agent must solve with the server's tools.

### Question rules

- **Independent**: no question depends on another's answer or side effects.
- **Read-only**: solvable with non-destructive, idempotent calls only.
- **Realistic and complex**: tasks a person would actually delegate, requiring several
  (sometimes dozens of) calls, multi-hop reasoning, paging, or older data.
- **Not keyword lookups**: paraphrase instead of quoting target titles or names.
- **Stress the outputs**: touch IDs, names, timestamps, URLs, and large result sets so
  verbose or lossy responses show up as failures.
- **Some ambiguity allowed**, but exactly one defensible answer.
- **Stable**: use closed history (ended threads, shipped projects, fixed time windows).
  Never count live state such as open issues, reactions, or members.

### Answer rules

- One value checked by exact string comparison: a name, ID, number, date, URL, boolean,
  or multiple-choice letter. State the format in the question ("Use YYYY-MM-DD",
  "Answer True or False").
- Prefer human-readable values over opaque IDs.
- No lists or objects unless order and format are forced and unambiguous.

### Examples

Good (multi-hop, stable, single value):

```xml
<qa_pair>
  <question>Find the repository archived in Q3 2023 that had previously been the organization's most forked project. What was its primary language?</question>
  <answer>Python</answer>
</qa_pair>
```

Poor: "How many open issues are assigned to engineering?" (changes over time);
"Who created the PR titled 'Add authentication feature'?" (single keyword search);
"List all Python repositories." (unordered list, hard to compare).

### Process

1. List the tools and read their schemas.
2. Explore real data with read-only calls to find stable, interesting facts.
3. Draft 10 questions following the rules above.
4. Solve every question yourself through the server; replace wrong answers and drop any
   question that needs a write or destructive call.
5. Save as XML:

```xml
<evaluation>
  <qa_pair>
    <question>...</question>
    <answer>...</answer>
  </qa_pair>
</evaluation>
```

`scripts/example_evaluation.xml` shows the format.

## 3. Running the harness

`scripts/evaluation.py` runs each question through Claude with the server's tools attached,
compares the final `<response>` to the answer, and reports accuracy, duration, tool calls,
the agent's approach summary, and its feedback on the tools.

```bash
pip install -r scripts/requirements.txt   # anthropic + mcp v2
export ANTHROPIC_API_KEY=...               # from the user's environment; never hard-code

# stdio server
python scripts/evaluation.py -t stdio -c node -a build/index.js -e EXAMPLE_API_KEY=$EXAMPLE_API_KEY -o report.md evaluation.xml
python scripts/evaluation.py -t stdio -c uv -a run example_mcp.py -e EXAMPLE_API_KEY=$EXAMPLE_API_KEY -o report.md evaluation.xml

# Streamable HTTP server (start it first; the harness does not)
python scripts/evaluation.py -t http -u http://127.0.0.1:3000/mcp -H "Authorization: Bearer $MCP_TOKEN" -o report.md evaluation.xml
```

`python scripts/evaluation.py --help` is the authority for transports, options, and the
default model; pass `-m <model>` to choose one from the live provider catalog. `-t sse`
exists only for legacy servers. The harness starts stdio servers itself and stops them when
it finishes; stop any HTTP server you started for the run.

## 4. Iterate

- Read the per-task feedback first: unclear names, missing parameters, and oversized
  responses are the usual causes of failures.
- Fix descriptions, schemas, pagination, or error text (`tool-design.md`), then rerun the
  same file and compare accuracy and tool-call counts.
- Connection failures: check the command and arguments (stdio), or the URL, headers, and
  Origin/Host validation (HTTP). Timeouts: shrink default page sizes and response bodies
  before blaming the model.
