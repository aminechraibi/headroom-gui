# headroom-gui

A monitoring dashboard for [Headroom](https://github.com/chopratejas/headroom) — the AI-agent context compression proxy that reduces LLM token usage by 60–95%.

## What is Headroom?

Headroom sits between your AI agent and the LLM. It intercepts tool call results and compresses them before they reach the model, cutting costs and extending effective context windows. Compression is reversible (CCR mode) — the original is cached for 5 minutes and retrieved on demand.

## What is headroom-gui?

A web dashboard that connects to a running Headroom instance and displays live metrics:

- **Overview** — at-a-glance health status and key numbers
- **Liveness / Readiness** — animated status indicators for `/livez` and `/readyz`
- **Health** — aggregate health checks for all subsystems
- **Stats** — tokens saved, cost savings, compression ratios, latency histograms
- **History** — time-series area charts (session / hourly / daily / weekly / monthly)
- **Metrics** — parsed Prometheus output with visual bar indicators

Auto-refreshes every 5 seconds. Zero runtime dependencies — uses only Node.js built-ins.

## Requirements

- **Node.js** ≥ 18
- **Headroom** running (see below)

## Quick Start

**1. Start Headroom first**

```bash
headroom proxy
# default: http://127.0.0.1:8787
```

**2. Start the dashboard**

```bash
npx headroom-gui start
```

Open **http://localhost:3000** in your browser.

**3. Stop the dashboard**

```bash
npx headroom-gui stop
```

## Commands

| Command | Description |
|---|---|
| `headroom-gui start` | Start dashboard in background |
| `headroom-gui stop` | Stop background server |
| `headroom-gui status` | Show running state |

## Options

| Flag | Default | Description |
|---|---|---|
| `--port <n>` | `3000` | Port for the GUI server |
| `--proxy-port <n>` | `8787` | Port Headroom is listening on |
| `--proxy-host <h>` | `127.0.0.1` | Host Headroom is listening on |

**Example — Headroom on a non-default port:**

```bash
headroom proxy --port 9000
headroom-gui start --proxy-port 9000
```

**Example — Dashboard on a different port:**

```bash
headroom-gui start --port 4000
# open http://localhost:4000
```

## Environment Variables

| Variable | Description |
|---|---|
| `HEADROOM_GUI_PORT` | GUI port (overridden by `--port`) |
| `HEADROOM_PROXY_PORT` | Headroom port (overridden by `--proxy-port`) |
| `HEADROOM_PROXY_HOST` | Headroom host (overridden by `--proxy-host`) |

## Architecture

```
Browser  ──→  headroom-gui (Node.js HTTP, :3000)
                  │
                  ├── GET /          → serves index.html (Tailwind SPA)
                  └── GET /api/*     → proxied to Headroom (:8787)
                                            │
                                            ├── /livez
                                            ├── /readyz
                                            ├── /health
                                            ├── /stats
                                            ├── /stats-history
                                            └── /metrics
```

The built-in proxy eliminates CORS issues — the browser only ever talks to the same origin (localhost:3000).

State files are stored in `~/.headroom-gui/` (PID, port, log).

## Publish to npm

```bash
npm publish --access public
```

Users can then run `npx headroom-gui start` without installing globally.
