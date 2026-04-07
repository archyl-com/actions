# Archyl Bitbucket Pipelines Template

Integrate [Archyl](https://archyl.com) architecture checks into your Bitbucket Pipelines.

## Quick Start

Copy the contents of `archyl-pipelines.yml` into your `bitbucket-pipelines.yml`, or merge the relevant sections.

### Minimal example

```yaml
image: alpine:3.20

pipelines:
  pull-requests:
    '**':
      - step:
          name: "Archyl Conformance Check"
          script:
            - apk add --no-cache curl jq git
            - # ... (see archyl-pipelines.yml for full script)

      - step:
          name: "Archyl Drift Score"
          script:
            - apk add --no-cache curl jq
            - # ... (see archyl-pipelines.yml for full script)

  branches:
    main:
      - step:
          name: "Archyl Generate Context"
          script:
            - apk add --no-cache curl jq git
            - # ... (see archyl-pipelines.yml for full script)
```

## Required Repository Variables

Set these in **Repository settings > Repository variables** (check "Secured" for sensitive values):

| Variable | Description | Secured |
|----------|-------------|---------|
| `ARCHYL_API_KEY` | Archyl API key with write scope | Yes |
| `ARCHYL_ORG_ID` | Archyl organization UUID | No |
| `ARCHYL_PROJECT_ID` | Archyl project UUID | No |

## Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ARCHYL_API_URL` | `https://api.archyl.com` | Archyl API base URL |
| `ARCHYL_DRIFT_THRESHOLD` | `0` | Minimum drift score (0-100). The step fails if below this. |
| `ARCHYL_CONTEXT_FILE` | `archyl.txt` | Output file path for generated context |
| `BITBUCKET_ACCESS_TOKEN` | *(none)* | OAuth/app password for posting PR comments |

## Steps

| Step | Trigger | Description |
|------|---------|-------------|
| Archyl Conformance Check | Pull requests | Validates architecture conformance rules against changed files |
| Archyl Drift Score | Pull requests | Computes drift score and enforces threshold |
| Archyl Generate Context | Push to `main` | Generates `archyl.txt` and commits it back |

## PR Comments

To post results as PR comments, set a `BITBUCKET_ACCESS_TOKEN` repository variable with an OAuth token or app password that has `pullrequest:write` scope.

Bitbucket's built-in `BITBUCKET_PR_ID` and `BITBUCKET_REPO_FULL_NAME` variables are used automatically.

## Customization

### Run only specific steps

Remove the steps you don't need from your `bitbucket-pipelines.yml`. Each step is independent.

### Change the target branch for context generation

Replace `main` under `branches:` with your default branch name:

```yaml
  branches:
    develop:
      - step:
          name: "Archyl Generate Context"
          # ...
```

### Set a drift threshold

Add the variable in your repository settings:

```
ARCHYL_DRIFT_THRESHOLD = 70
```

## Requirements

- No Node.js needed -- uses `curl` and `jq` on Alpine Linux.
- Git access for the context generation step to push commits back.
