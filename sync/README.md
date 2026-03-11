# Archyl Sync GitHub Action

Automatically sync your `archyl.yaml` architecture file with Archyl whenever it changes.

## Usage

### On push to main

```yaml
name: Sync Architecture
on:
  push:
    branches: [main]
    paths: ['archyl.yaml']

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: archyl-com/actions/sync@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          project-id: 'your-project-uuid'
```

### With custom file path

```yaml
- uses: archyl-com/actions/sync@v1
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    project-id: 'your-project-uuid'
    file: 'docs/archyl.yaml'
```

### Monorepo with multiple projects

```yaml
name: Sync Architecture
on:
  push:
    branches: [main]
    paths:
      - 'archyl.yaml'
      - 'services/*/archyl.yaml'

jobs:
  sync-main:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: archyl-com/actions/sync@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          project-id: 'your-project-uuid'

  sync-payments:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: archyl-com/actions/sync@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          project-id: 'payments-project-uuid'
          file: 'services/payments/archyl.yaml'
```

### Using the summary output

```yaml
- uses: archyl-com/actions/sync@v1
  id: sync
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    project-id: 'your-project-uuid'

- run: echo "${{ steps.sync.outputs.summary }}"
```

### Self-hosted Archyl

```yaml
- uses: archyl-com/actions/sync@v1
  with:
    api-url: 'https://archyl.your-company.com'
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    project-id: 'your-project-uuid'
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | | Archyl API key with write scope |
| `project-id` | Yes | | Archyl project UUID |
| `api-url` | No | `https://api.archyl.com` | API base URL (for self-hosted) |
| `file` | No | `archyl.yaml` | Path to the YAML file relative to repo root |

## Outputs

| Output | Description |
|---|---|
| `systems-created` | Number of systems created |
| `containers-created` | Number of containers created |
| `components-created` | Number of components created |
| `relationships-created` | Number of relationships created |
| `summary` | Human-readable summary of the sync result |

## Alternative: curl

```bash
curl -X POST \
  -H "X-API-Key: $ARCHYL_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content\": $(cat archyl.yaml | jq -Rs .)}" \
  https://api.archyl.com/api/v1/projects/$PROJECT_ID/dsl/ingest
```
