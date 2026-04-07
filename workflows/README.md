# Archyl Reusable Workflows

Pre-built reusable workflows that combine Archyl actions into a single call. Drop one file in your repo and get full architecture governance.

## `archyl-pr.yml` -- Pull Request Checks

Runs **conformance check** and **drift score** in parallel on every pull request.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `organization-id` | Yes | -- | Archyl organization UUID |
| `project-id` | Yes | -- | Archyl project UUID |
| `drift-threshold` | No | `0` | Minimum drift score (0-100). Set to 0 to never fail. |
| `fail-on` | No | `error` | Conformance severity that fails: `error`, `warning`, or `none` |
| `comment-on-pr` | No | `true` | Post summary comments on the PR |
| `max-file-lines` | No | `200` | Max lines per file for conformance check |
| `chunk-size` | No | `20` | Files per conformance API call |

### Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `api-key` | Yes | Archyl API key with write scope |

### Usage

```yaml
# .github/workflows/architecture.yml
name: Architecture
on:
  pull_request:
    branches: [main]

jobs:
  pr-checks:
    uses: archyl-com/actions/.github/workflows/archyl-pr.yml@v1
    with:
      organization-id: ${{ vars.ARCHYL_ORG_ID }}
      project-id: ${{ vars.ARCHYL_PROJECT_ID }}
      drift-threshold: 70
    secrets:
      api-key: ${{ secrets.ARCHYL_API_KEY }}
```

---

## `archyl-main.yml` -- Main Branch Updates

Runs **generate-context**, **sync**, and **release** after merges to main. Each job is independently toggleable.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `organization-id` | Yes | -- | Archyl organization UUID |
| `project-id` | Yes | -- | Archyl project UUID |
| `generate-context` | No | `true` | Generate and auto-commit `archyl.txt` |
| `context-format` | No | `markdown` | Output format: `markdown` or `full` |
| `sync` | No | `false` | Sync `archyl.yaml` to Archyl |
| `sync-file` | No | `archyl.yaml` | Path to the archyl.yaml file |
| `release` | No | `false` | Create a release in Archyl |
| `release-status` | No | `deployed` | Release status |
| `release-environment` | No | -- | Target environment name |

### Secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `api-key` | Yes | Archyl API key with write scope |

### Usage

```yaml
# .github/workflows/architecture.yml
name: Architecture
on:
  push:
    branches: [main]

jobs:
  main-update:
    uses: archyl-com/actions/.github/workflows/archyl-main.yml@v1
    with:
      organization-id: ${{ vars.ARCHYL_ORG_ID }}
      project-id: ${{ vars.ARCHYL_PROJECT_ID }}
      sync: true
    secrets:
      api-key: ${{ secrets.ARCHYL_API_KEY }}
```

---

## Full Example: Single Workflow File

Combine both reusable workflows into one file for complete architecture governance:

```yaml
# .github/workflows/architecture.yml
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
      generate-context: true
      sync: true
      release: true
    secrets:
      api-key: ${{ secrets.ARCHYL_API_KEY }}
```

## Setup

1. Create an API key in Archyl (Settings > API Keys) with write scope
2. Add `ARCHYL_API_KEY` as a repository secret
3. Add `ARCHYL_ORG_ID` and `ARCHYL_PROJECT_ID` as repository variables
4. Copy one of the examples above into `.github/workflows/architecture.yml`
