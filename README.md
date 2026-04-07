# Archyl GitHub Actions

A collection of GitHub Actions for integrating [Archyl](https://archyl.com) — the Architecture Intelligence Platform — into your CI/CD pipeline.

## Available Actions

| Action | Description |
|--------|-------------|
| **[conformance-check](./conformance-check)** | Run architecture conformance rules against changed files. Annotates violations inline on PRs and blocks merges on rule violations. |
| **[drift-score](./drift-score)** | Compute architecture drift score and optionally enforce a quality gate. Supports PR comments. |
| **[generate-context](./generate-context)** | Generate an `archyl.txt` file with architecture context optimized for AI agents (Claude Code, Cursor, Codex). |
| **[release](./release)** | Automatically create releases in Archyl from your GitHub Actions workflows. |
| **[sync](./sync)** | Sync an `archyl.yaml` DSL file to Archyl to keep architecture definitions in code. |
| **[auto-cr](./auto-cr)** | Automatically create Architecture Change Requests from merge diffs. Detects new services, dependencies, API changes, and more. |

## Quick Start

### Architecture governance on every PR

```yaml
name: Architecture
on:
  pull_request:
    branches: [main]

jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Check conformance rules against changed files
      - name: Conformance check
        uses: archyl-com/actions/conformance-check@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: ${{ vars.ARCHYL_PROJECT_ID }}

      # Compute drift score with quality gate
      - name: Drift score
        uses: archyl-com/actions/drift-score@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: ${{ vars.ARCHYL_PROJECT_ID }}
          threshold: '70'
          comment-on-pr: 'true'
```

### Keep `archyl.txt` up to date for AI agents

```yaml
name: Update Architecture Context
on:
  push:
    branches: [main]

jobs:
  context:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: archyl-com/actions/generate-context@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: ${{ vars.ARCHYL_PROJECT_ID }}
          commit: 'true'
```

### Track releases

```yaml
- uses: archyl-com/actions/release@v1
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    project-id: ${{ vars.ARCHYL_PROJECT_ID }}
    version: ${{ github.ref_name }}
    status: 'deployed'
```

## How It All Fits Together

```
Developer/Agent pushes code
        │
        ▼
┌─────────────────────────┐
│  conformance-check      │  ← Blocks PRs that violate architecture rules
│  drift-score            │  ← Measures doc-vs-code alignment
└─────────────────────────┘
        │
        ▼ (merge to main)
┌─────────────────────────┐
│  generate-context       │  ← Updates archyl.txt for AI agents
│  auto-cr                │  ← Files Change Request from merge diff
│  sync                   │  ← Syncs archyl.yaml to Archyl
│  release                │  ← Tracks deployment in Archyl
└─────────────────────────┘
        │
        ▼
  AI agents read archyl.txt
  before their next task
```

## Reusable Workflows

For a faster setup, use the reusable workflows that combine multiple actions:

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **[archyl-pr](./workflows/archyl-pr.yml)** | `pull_request` | Runs conformance-check + drift-score in parallel |
| **[archyl-main](./workflows/archyl-main.yml)** | `push` to main | Runs generate-context, sync, and release |

```yaml
# .github/workflows/architecture.yml — one file, full coverage
name: Architecture
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  pr-checks:
    if: github.event_name == 'pull_request'
    uses: archyl-com/actions/.github/workflows/archyl-pr.yml@v1
    with:
      organization-id: ${{ vars.ARCHYL_ORG_ID }}
      project-id: ${{ vars.ARCHYL_PROJECT_ID }}
      drift-threshold: 70
    secrets:
      api-key: ${{ secrets.ARCHYL_API_KEY }}

  main-update:
    if: github.event_name == 'push'
    uses: archyl-com/actions/.github/workflows/archyl-main.yml@v1
    with:
      organization-id: ${{ vars.ARCHYL_ORG_ID }}
      project-id: ${{ vars.ARCHYL_PROJECT_ID }}
    secrets:
      api-key: ${{ secrets.ARCHYL_API_KEY }}
```

See [workflows/README.md](./workflows/README.md) for full input/secret reference.

## Other CI Platforms

Not on GitHub? We provide ready-to-use templates for other platforms:

| Platform | Template | Features |
|----------|----------|----------|
| **GitLab CI** | [ci-templates/gitlab](./ci-templates/gitlab) | Conformance, drift score, context generation via `include:` |
| **Bitbucket Pipelines** | [ci-templates/bitbucket](./ci-templates/bitbucket) | Conformance, drift score, context generation |

These templates use `curl` + `jq` to call the Archyl API directly — no Node.js required.

## Requirements

- An [Archyl](https://archyl.com) account with API access
- An API key with write scope (Settings > API Keys)
- Organization ID and Project ID from the Archyl dashboard
