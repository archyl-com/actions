# Archyl CI Templates

CI/CD templates for integrating [Archyl](https://archyl.com) architecture checks into platforms beyond GitHub Actions.

## Platforms

| Platform | Template | Documentation |
|----------|----------|---------------|
| **GitLab CI** | [`.archyl-ci.yml`](./gitlab/.archyl-ci.yml) | [README](./gitlab/README.md) |
| **Bitbucket Pipelines** | [`archyl-pipelines.yml`](./bitbucket/archyl-pipelines.yml) | [README](./bitbucket/README.md) |
| **GitHub Actions** | [Parent directory](../) | [README](../README.md) |

## What's Included

Each template provides three jobs:

| Job | Trigger | Description |
|-----|---------|-------------|
| **Conformance Check** | Pull/Merge requests | Validates architecture rules against changed files and posts results as comments |
| **Drift Score** | Pull/Merge requests | Computes architecture drift score with configurable quality gate |
| **Generate Context** | Push to default branch | Generates `archyl.txt` for AI agents and commits it back |

## Design Principles

- **Lightweight**: Uses `curl` + `jq` only -- no Node.js or other runtimes required
- **Consistent**: Same API calls and behavior across all platforms
- **Self-contained**: Each template is a single file that can be included or copied
- **Production-ready**: Proper error handling, timeouts, and exit codes

## Required Variables

All templates require the same core variables:

| Variable | Description |
|----------|-------------|
| `ARCHYL_API_KEY` | API key with write scope (Settings > API Keys) |
| `ARCHYL_ORG_ID` | Organization UUID from the Archyl dashboard |
| `ARCHYL_PROJECT_ID` | Project UUID from the Archyl dashboard |

See each platform's README for setup instructions.
