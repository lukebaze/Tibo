# Environment and dependencies

<!-- verified against hyperframes @ 0.8.77 on 2026-09-26 -->

## Node.js 22+

`hyperframes` requires Node.js 22 or newer.

```bash
node --version
# Node 22+? Good. Otherwise:
nvm install 22
nvm use 22
```

## FFmpeg and FFprobe

Both are required on `PATH`: the local render pipeline captures frames in
headless Chrome and encodes with FFmpeg, and FFprobe inspects media (and
verifies render output). Most FFmpeg packages ship both binaries.

```bash
# macOS
brew install ffmpeg

# Debian/Ubuntu
sudo apt-get update && sudo apt-get install -y ffmpeg

# Windows
winget install --id Gyan.FFmpeg -e

# verify
ffmpeg -version
ffprobe -version
```

To use a binary outside `PATH`, set `HYPERFRAMES_FFMPEG_PATH`.

## Chrome

The renderer needs a headless Chrome. `hyperframes browser ensure` finds or
downloads one; `hyperframes doctor --json` reports every dependency (it always
exits 0, so gate on the payload's `.ok` field).

## Verify prerequisites at once

```bash
node scripts/verify-prereqs.mjs
```

Checks Node, FFmpeg, and FFprobe. Prints `READY` and exits 0 when all checks
pass; otherwise exits non-zero with the specific remediation command for
whichever check failed. Add `--json` for machine-readable output.

## Optional: HeyGen cloud credentials

Local rendering (Chrome + FFmpeg on this machine) does not require an API
key. HeyGen credentials are needed only for the separate `hyperframes cloud
render` command (see
[references/render-workflow.md](render-workflow.md#optional-remotecloud-render)).
The CLI resolves them in this order: `HEYGEN_API_KEY`, then the alias
`HYPERFRAMES_API_KEY`, then `~/.heygen/credentials` written by
`hyperframes auth login` (`auth status` / `auth logout` manage it).

```bash
export HEYGEN_API_KEY="<your-key>"
```

Store it via the project's existing secret-management convention (e.g.
`.agentkit/.env`, `~/.agentkit/.env`) rather than committing it. Never print
or log the key value.
