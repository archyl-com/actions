# Archyl GitLab CI Template

Integrate [Archyl](https://archyl.com) architecture checks into your GitLab CI/CD pipeline.

## Quick Start

Add the following to your `.gitlab-ci.yml`:

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/archyl-com/actions/main/ci-templates/gitlab/.archyl-ci.yml'

stages:
  - test
  - deploy
```

This gives you three jobs automatically:

| Job | Trigger | Stage | Description |
|-----|---------|-------|-------------|
| `archyl:conformance` | Merge requests | `test` | Checks architecture conformance rules against changed files |
| `archyl:drift-score` | Merge requests | `test` | Computes architecture drift score with quality gate |
| `archyl:generate-context` | Push to default branch | `deploy` | Generates `archyl.txt` and commits it back |

## Required CI/CD Variables

Set these in **Settings > CI/CD > Variables** (mark as masked/protected as appropriate):

| Variable | Description | Required |
|----------|-------------|----------|
| `ARCHYL_API_KEY` | Archyl API key with write scope | Yes |
| `ARCHYL_ORG_ID` | Archyl organization UUID | Yes |
| `ARCHYL_PROJECT_ID` | Archyl project UUID | Yes |

## Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ARCHYL_API_URL` | `https://api.archyl.com` | Archyl API base URL |
| `ARCHYL_DRIFT_THRESHOLD` | `0` | Minimum drift score (0-100). The job fails if below this. |
| `ARCHYL_CONTEXT_FILE` | `archyl.txt` | Output file path for generated context |
| `GITLAB_TOKEN` | `$CI_JOB_TOKEN` | Token for posting MR comments. Use a project/group access token for better permissions. |

## Examples

### Run only conformance checks

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/archyl-com/actions/main/ci-templates/gitlab/.archyl-ci.yml'

stages:
  - test

# Disable drift and context jobs
archyl:drift-score:
  rules:
    - when: never

archyl:generate-context:
  rules:
    - when: never
```

### Set a drift threshold

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/archyl-com/actions/main/ci-templates/gitlab/.archyl-ci.yml'

variables:
  ARCHYL_DRIFT_THRESHOLD: "70"

stages:
  - test
  - deploy
```

### Use a local copy of the template

```yaml
include:
  - local: '.archyl-ci.yml'

stages:
  - test
  - deploy
```

## MR Comments

Both `archyl:conformance` and `archyl:drift-score` post results as merge request notes. This requires either:

- The default `CI_JOB_TOKEN` (works if your project allows job token access to the API)
- A `GITLAB_TOKEN` variable set to a project or group access token with `api` scope

## Requirements

- No Node.js needed -- the template uses `curl` and `jq` on Alpine Linux.
- Git access for `archyl:generate-context` to push commits back.
