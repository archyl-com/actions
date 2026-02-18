# Archyl Release GitHub Action

Automatically create releases in Archyl from your GitHub Actions workflows.

## Usage

### On tag push

```yaml
on:
  push:
    tags: ['v*']

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: archyl-com/actions/release@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          project-id: 'your-project-uuid'
          environment: 'production'
```

### On GitHub release published

Changelog supports multiline content with any special characters (quotes, markdown, etc.):

```yaml
on:
  release:
    types: [published]

jobs:
  track:
    runs-on: ubuntu-latest
    steps:
      - uses: archyl-com/actions/release@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          project-id: 'your-project-uuid'
          version: ${{ github.event.release.tag_name }}
          changelog: ${{ github.event.release.body }}
          environment: 'production'
```

### With inline multiline changelog

```yaml
- uses: archyl-com/actions/release@v1
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    project-id: 'your-project-uuid'
    version: 'v1.2.0'
    changelog: |
      ## What's Changed
      - Fixed "login" bug with special characters
      - Improved users' dashboard performance
      - Added `retry` mechanism for API calls
    environment: 'production'
```

### Manual trigger

```yaml
on:
  workflow_dispatch:
    inputs:
      version:
        description: 'Version to release'
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Deploy
        run: echo "deploying..."

      - uses: archyl-com/actions/release@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          project-id: 'your-project-uuid'
          version: ${{ github.event.inputs.version }}
          status: 'deployed'
          environment: 'staging'
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | | Archyl API key with write scope |
| `project-id` | Yes | | Archyl project UUID |
| `api-url` | No | `https://api.archyl.com` | API base URL (for self-hosted) |
| `version` | No | `GITHUB_REF_NAME` | Release version |
| `status` | No | `deployed` | Release status |
| `changelog` | No | | Release notes |
| `environment` | No | | Target environment (auto-created if missing) |
| `source-url` | No | Current run URL | Link back to source |

## Outputs

| Output | Description |
|---|---|
| `release-id` | UUID of the created release |

## Alternative: curl

```bash
# Simple release
curl -X POST \
  -H "X-API-Key: $ARCHYL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"version":"v1.0.0","status":"deployed","environment":"production"}' \
  https://api.archyl.com/api/v1/projects/$PROJECT_ID/releases/ingest

# With multiline changelog (use jq to safely build JSON)
jq -n \
  --arg version "v1.0.0" \
  --arg status "deployed" \
  --arg env "production" \
  --arg changelog "$(cat CHANGELOG.md)" \
  '{version:$version,status:$status,environment:$env,changelog:$changelog}' \
| curl -X POST \
  -H "X-API-Key: $ARCHYL_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- \
  https://api.archyl.com/api/v1/projects/$PROJECT_ID/releases/ingest
```
