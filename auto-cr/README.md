# Archyl Auto Change Request GitHub Action

Automatically create an Architecture Change Request in Archyl when code is merged to main. Analyzes the merge diff, detects architecture-relevant changes, and files a CR for architect review.

## Usage

### On every push to main

```yaml
on:
  push:
    branches: [main]

jobs:
  auto-cr:
    runs-on: ubuntu-latest
    steps:
      - uses: archyl-com/actions/auto-cr@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: 'your-project-uuid'
```

### With commit comment

```yaml
- uses: archyl-com/actions/auto-cr@v1
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    organization-id: ${{ secrets.ARCHYL_ORG_ID }}
    project-id: 'your-project-uuid'
    comment-on-commit: 'true'
```

### Combined with generate-context and drift-score

```yaml
on:
  push:
    branches: [main]

jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: archyl-com/actions/generate-context@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: 'your-project-uuid'

      - uses: archyl-com/actions/auto-cr@v1
        id: cr
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: 'your-project-uuid'
          comment-on-commit: 'true'

      - uses: archyl-com/actions/drift-score@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: 'your-project-uuid'

      - name: Report
        if: steps.cr.outputs.status == 'created'
        run: echo "CR created with ${{ steps.cr.outputs.changes-detected }} changes"
```

### Use outputs in subsequent steps

```yaml
- uses: archyl-com/actions/auto-cr@v1
  id: cr
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    organization-id: ${{ secrets.ARCHYL_ORG_ID }}
    project-id: 'your-project-uuid'

- name: Notify on Slack
  if: steps.cr.outputs.status == 'created'
  run: |
    echo "Change Request ${{ steps.cr.outputs.request-id }} created with ${{ steps.cr.outputs.changes-detected }} architecture changes"
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | | Archyl API key with write scope |
| `organization-id` | Yes | | Archyl organization UUID |
| `project-id` | Yes | | Archyl project UUID |
| `api-url` | No | `https://api.archyl.com` | API base URL (for self-hosted) |
| `github-token` | No | `${{ github.token }}` | GitHub token for diff access and commit comments |
| `base-ref` | No | Auto-detected | Base ref to compare against |
| `comment-on-commit` | No | `false` | Post a comment on the merge commit with the CR link |

## Outputs

| Output | Description |
|---|---|
| `request-id` | UUID of the created Change Request |
| `changes-detected` | Number of architecture-relevant changes found |
| `status` | `created`, `skipped` (no changes), or `failed` |

## Architecture-relevant file patterns

The action detects changes in the following file types:

| Category | Patterns |
|----------|----------|
| Dependencies | `go.mod`, `package.json`, `Cargo.toml`, `pyproject.toml`, `requirements.txt` |
| Containers / Docker | `Dockerfile`, `docker-compose*.yml` |
| API Contracts | `*.proto`, `openapi.yaml/json`, `swagger.yaml/json`, `schema.graphql` |
| Events / Messaging | `kafka*`, `rabbitmq*`, `nats*`, `*queue*`, `*event*` |
| Infrastructure | `terraform/**`, `k8s/**`, `helm/**` |
| Service Entry Points | `cmd/*/main.go`, `src/main.*`, `app.*`, `server.*` |

## How it works

1. Fetches the diff between the before/after commits of the push event
2. Scans changed files against architecture-relevant patterns
3. Fetches the current C4 model from Archyl to match affected elements
4. Creates a Change Request with a structured description
5. Adds suggested element changes (create/update/delete) to the CR
6. Optionally comments on the merge commit with the CR link

If no architecture-relevant changes are detected, the action skips CR creation and reports `status: skipped`.

## Job Summary

The action writes a GitHub Actions job summary showing detected changes grouped by category, with links to the created Change Request.
