# Archyl Drift Score GitHub Action

Compute architecture drift score in Archyl from your CI pipeline. Measures how accurately your C4 model reflects the actual codebase.

## Usage

### On every push to main

```yaml
on:
  push:
    branches: [main]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: archyl-com/actions/drift-score@v1
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: 'your-project-uuid'
```

### With quality gate (fail if score drops below 70%)

```yaml
- uses: archyl-com/actions/drift-score@v1
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    organization-id: ${{ secrets.ARCHYL_ORG_ID }}
    project-id: 'your-project-uuid'
    threshold: '70'
```

### Weekly scheduled check

```yaml
on:
  schedule:
    - cron: '0 8 * * 1' # Every Monday at 8am

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: archyl-com/actions/drift-score@v1
        id: drift
        with:
          api-key: ${{ secrets.ARCHYL_API_KEY }}
          organization-id: ${{ secrets.ARCHYL_ORG_ID }}
          project-id: 'your-project-uuid'

      - name: Report score
        run: echo "Drift score is ${{ steps.drift.outputs.score }}%"
```

### Use outputs in subsequent steps

```yaml
- uses: archyl-com/actions/drift-score@v1
  id: drift
  with:
    api-key: ${{ secrets.ARCHYL_API_KEY }}
    organization-id: ${{ secrets.ARCHYL_ORG_ID }}
    project-id: 'your-project-uuid'

- name: Comment on PR
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `## Architecture Drift Score: ${{ steps.drift.outputs.score }}%\n\n` +
              `- Matched: ${{ steps.drift.outputs.matched-count }}\n` +
              `- Missing: ${{ steps.drift.outputs.missing-in-code }}\n` +
              `- New: ${{ steps.drift.outputs.new-in-code }}\n` +
              `- Total: ${{ steps.drift.outputs.total-elements }}`
      })
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | | Archyl API key with write scope |
| `organization-id` | Yes | | Archyl organization UUID |
| `project-id` | Yes | | Archyl project UUID |
| `api-url` | No | `https://api.archyl.com` | API base URL (for self-hosted) |
| `threshold` | No | `0` | Minimum score (0-100). Fails the action if below. `0` = never fail. |
| `poll-interval` | No | `5` | Seconds between polls while computing |
| `poll-timeout` | No | `300` | Maximum seconds to wait |

## Outputs

| Output | Description |
|---|---|
| `score` | Drift score (0-100) |
| `score-id` | UUID of the drift score record |
| `total-elements` | Total elements compared |
| `matched-count` | Elements that match |
| `missing-in-code` | Documented elements not found in code |
| `new-in-code` | Code elements not documented |
| `status` | `completed` or `failed` |

## Job Summary

The action automatically writes a GitHub Actions job summary with a table showing the drift breakdown and a score interpretation (Excellent/Good/Fair/Poor/Critical).
