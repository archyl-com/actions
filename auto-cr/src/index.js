const core = require("@actions/core");
const github = require("@actions/github");
const { HttpClient } = require("@actions/http-client");

// File patterns that indicate architecture-relevant changes
const ARCHITECTURE_PATTERNS = [
  // New services / packages
  { pattern: /^(.*\/)?go\.mod$/, category: "dependency", label: "Go module" },
  { pattern: /^(.*\/)?package\.json$/, category: "dependency", label: "Node.js package" },
  { pattern: /^(.*\/)?Cargo\.toml$/, category: "dependency", label: "Rust crate" },
  { pattern: /^(.*\/)?pyproject\.toml$/, category: "dependency", label: "Python project" },
  { pattern: /^(.*\/)?requirements\.txt$/, category: "dependency", label: "Python requirements" },

  // Containers / infrastructure
  { pattern: /^(.*\/)?Dockerfile$/, category: "container", label: "Dockerfile" },
  { pattern: /^(.*\/)?docker-compose[^/]*\.ya?ml$/, category: "container", label: "Docker Compose" },

  // API contracts
  { pattern: /^(.*\/)?.*\.proto$/, category: "api", label: "Protobuf definition" },
  { pattern: /^(.*\/)?openapi\.(ya?ml|json)$/, category: "api", label: "OpenAPI spec" },
  { pattern: /^(.*\/)?swagger\.(ya?ml|json)$/, category: "api", label: "Swagger spec" },
  { pattern: /^(.*\/)?schema\.graphql$/, category: "api", label: "GraphQL schema" },

  // Event / messaging config
  { pattern: /^(.*\/)?kafka[^/]*/, category: "event", label: "Kafka config" },
  { pattern: /^(.*\/)?rabbitmq[^/]*/, category: "event", label: "RabbitMQ config" },
  { pattern: /^(.*\/)?nats[^/]*/, category: "event", label: "NATS config" },
  { pattern: /^(.*\/)?(.*queue.*|.*event.*)/, category: "event", label: "Event/queue config" },

  // Infrastructure
  { pattern: /^(.*\/)?terraform\//, category: "infra", label: "Terraform config" },
  { pattern: /^(.*\/)?k8s\//, category: "infra", label: "Kubernetes manifest" },
  { pattern: /^(.*\/)?helm\//, category: "infra", label: "Helm chart" },

  // Service entry points
  { pattern: /^(.*\/)?cmd\/[^/]+\/main\.go$/, category: "service", label: "Go service entry point" },
  { pattern: /^(.*\/)?src\/main\..*$/, category: "service", label: "Service entry point" },
  { pattern: /^(.*\/)?app\..*$/, category: "service", label: "App entry point" },
  { pattern: /^(.*\/)?server\..*$/, category: "service", label: "Server entry point" },
];

async function run() {
  const apiUrl = (core.getInput("api-url") || "https://api.archyl.com").replace(/\/+$/, "");
  const apiKey = core.getInput("api-key", { required: true });
  const organizationId = core.getInput("organization-id", { required: true });
  const projectId = core.getInput("project-id", { required: true });
  const githubToken = core.getInput("github-token");
  const baseRef = core.getInput("base-ref");
  const commentOnCommit = core.getInput("comment-on-commit") === "true";

  const http = new HttpClient("archyl-auto-cr-action");
  const headers = {
    "X-API-Key": apiKey,
    "X-Organization-ID": organizationId,
    "Content-Type": "application/json",
  };

  const octokit = github.getOctokit(githubToken);
  const context = github.context;

  // Step 1: Get the diff from the push event
  core.info("Fetching commit diff...");

  const before = baseRef || context.payload.before;
  const after = context.payload.after || context.sha;

  if (!before || !after) {
    core.setFailed("Could not determine before/after commits. Ensure this runs on a push event or provide base-ref.");
    core.setOutput("status", "failed");
    return;
  }

  let diff;
  try {
    const comparison = await octokit.rest.repos.compareCommits({
      owner: context.repo.owner,
      repo: context.repo.repo,
      base: before,
      head: after,
    });
    diff = comparison.data;
  } catch (err) {
    core.setFailed(`Failed to fetch diff: ${err.message}`);
    core.setOutput("status", "failed");
    return;
  }

  const files = diff.files || [];
  core.info(`Found ${files.length} changed files across ${diff.commits.length} commits.`);

  // Step 2: Detect architecture-relevant changes
  const archChanges = detectArchitectureChanges(files);

  if (archChanges.length === 0) {
    core.info("No architecture-relevant changes detected. Skipping CR creation.");
    core.setOutput("request-id", "");
    core.setOutput("changes-detected", "0");
    core.setOutput("status", "skipped");

    await core.summary
      .addHeading("Architecture Change Request: Skipped")
      .addRaw("No architecture-relevant file changes detected in this push.\n")
      .write();

    return;
  }

  core.info(`Detected ${archChanges.length} architecture-relevant changes.`);

  // Step 3: Fetch current C4 model from Archyl
  core.info("Fetching current C4 model from Archyl...");

  let agentContext = null;
  try {
    const contextUrl = `${apiUrl}/api/v1/projects/${projectId}/agent/context?format=full`;
    const contextResponse = await http.getJson(contextUrl, headers);

    if (contextResponse.statusCode >= 200 && contextResponse.statusCode < 300) {
      agentContext = contextResponse.result;
    } else {
      core.warning(`Failed to fetch C4 model (${contextResponse.statusCode}). Proceeding without element matching.`);
    }
  } catch (err) {
    core.warning(`Failed to fetch C4 model: ${err.message}. Proceeding without element matching.`);
  }

  // Step 4: Match changes against C4 elements
  const elements = extractElements(agentContext);
  const matchedElements = matchAgainstModel(archChanges, elements);

  // Step 5: Build Change Request description
  const description = buildDescription(archChanges, matchedElements, diff, before, after);

  // Step 6: Build suggested changes for the CR
  const suggestedChanges = buildSuggestedChanges(archChanges, matchedElements, elements);

  // Step 7: Create the Change Request via API
  core.info("Creating Change Request in Archyl...");

  let requestId;
  try {
    const crUrl = `${apiUrl}/api/v1/projects/${projectId}/requests`;
    const crBody = {
      title: `Auto-detected architecture changes from ${after.substring(0, 7)}`,
      description,
    };

    const crResponse = await http.postJson(crUrl, crBody, headers);

    if (crResponse.statusCode < 200 || crResponse.statusCode >= 300) {
      core.setFailed(`Failed to create Change Request: ${crResponse.statusCode} ${JSON.stringify(crResponse.result)}`);
      core.setOutput("status", "failed");
      return;
    }

    requestId = crResponse.result && crResponse.result.data && crResponse.result.data.id;
    if (!requestId) {
      core.setFailed("No request ID returned from Change Request creation");
      core.setOutput("status", "failed");
      return;
    }

    core.info(`Change Request created: ${requestId}`);
  } catch (err) {
    core.setFailed(`Failed to create Change Request: ${err.message}`);
    core.setOutput("status", "failed");
    return;
  }

  // Step 8: Add changes to the CR. The API takes one change per call.
  let addedChanges = 0;
  const changesUrl = `${apiUrl}/api/v1/requests/${requestId}/changes`;

  for (const change of suggestedChanges) {
    try {
      const changeResponse = await http.postJson(changesUrl, change, headers);

      if (changeResponse.statusCode >= 200 && changeResponse.statusCode < 300) {
        addedChanges++;
      } else {
        core.warning(
          `Failed to add change for ${change.elementType} "${change.elementData.name || change.elementId}": ${changeResponse.statusCode}`
        );
      }
    } catch (err) {
      core.warning(`Failed to add change to CR: ${err.message}`);
    }
  }

  if (addedChanges > 0) {
    core.info(`Added ${addedChanges} suggested change(s) to the CR.`);
  }

  // Step 9: Set outputs
  core.setOutput("request-id", requestId);
  core.setOutput("changes-detected", String(archChanges.length));
  core.setOutput("status", "created");

  // Step 10: Write job summary
  core.info("");
  core.info("====================================");
  core.info(`  Change Request created: ${requestId}`);
  core.info(`  Architecture changes:   ${archChanges.length}`);
  core.info(`  Suggested CR changes:   ${addedChanges}`);
  core.info("====================================");
  core.info("");

  const categoryGroups = groupByCategory(archChanges);
  const summaryRows = Object.entries(categoryGroups).map(([cat, items]) => [
    categoryLabel(cat),
    String(items.length),
    items.map((i) => `\`${i.file}\``).join(", "),
  ]);

  await core.summary
    .addHeading("Architecture Change Request Created")
    .addRaw(`**Request ID:** \`${requestId}\`\n\n`)
    .addRaw(`**Commits:** ${before.substring(0, 7)}...${after.substring(0, 7)} (${diff.commits.length} commits)\n\n`)
    .addTable([
      [
        { data: "Category", header: true },
        { data: "Count", header: true },
        { data: "Files", header: true },
      ],
      ...summaryRows,
    ])
    .addRaw(`\n**Total architecture-relevant changes:** ${archChanges.length}\n`)
    .addRaw(`**Suggested element updates:** ${addedChanges}\n\n`)
    .addRaw("---\n*Powered by [Archyl](https://archyl.com) — Architecture Intelligence for AI-Native Teams*\n")
    .write();

  // Step 11: Optionally comment on merge commit
  if (commentOnCommit && githubToken) {
    try {
      let body = `## Architecture Change Request Created\n\n`;
      body += `An architecture change request has been automatically filed in Archyl.\n\n`;
      body += `**Request ID:** \`${requestId}\`\n`;
      body += `**Changes detected:** ${archChanges.length}\n\n`;
      body += `| Category | Count |\n|----------|-------|\n`;
      for (const [cat, items] of Object.entries(categoryGroups)) {
        body += `| ${categoryLabel(cat)} | ${items.length} |\n`;
      }
      body += `\n---\n*Powered by [Archyl](https://archyl.com) — Architecture Intelligence for AI-Native Teams*`;

      await octokit.rest.repos.createCommitComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        commit_sha: after,
        body,
      });

      core.info("Posted comment on merge commit.");
    } catch (err) {
      core.warning(`Failed to comment on commit: ${err.message}`);
    }
  }

  core.info("Done.");
}

/**
 * Detect architecture-relevant file changes from the diff.
 */
function detectArchitectureChanges(files) {
  const changes = [];
  const seen = new Set();

  for (const file of files) {
    const filename = file.filename;

    for (const rule of ARCHITECTURE_PATTERNS) {
      if (rule.pattern.test(filename) && !seen.has(filename)) {
        seen.add(filename);
        changes.push({
          file: filename,
          status: file.status, // added, removed, modified, renamed
          category: rule.category,
          label: rule.label,
          additions: file.additions,
          deletions: file.deletions,
        });
        break;
      }
    }
  }

  // Detect new top-level directories (potential new services)
  const newDirs = new Set();
  for (const file of files) {
    if (file.status === "added") {
      const parts = file.filename.split("/");
      if (parts.length >= 2) {
        newDirs.add(parts[0]);
      }
    }
  }

  // Check if any removed files suggest deleted directories
  const removedDirs = new Set();
  for (const file of files) {
    if (file.status === "removed") {
      const parts = file.filename.split("/");
      if (parts.length >= 2) {
        removedDirs.add(parts[0]);
      }
    }
  }

  return changes;
}

/**
 * Match detected changes against the current C4 model elements.
 */
function matchAgainstModel(archChanges, elements) {
  const matched = [];

  for (const change of archChanges) {
    const pathParts = change.file.split("/").filter(Boolean);

    for (const element of elements) {
      const nameLC = element.name.toLowerCase();

      for (const part of pathParts) {
        if (part.toLowerCase() === nameLC || nameLC.includes(part.toLowerCase())) {
          matched.push({
            change,
            element,
            matchedOn: part,
          });
          break;
        }
      }
    }
  }

  return matched;
}

/**
 * Extract all named elements from the agent context response. `elementType` is the
 * C4 level the element sits at, which is what the Change Request API expects;
 * `type` is the element's own kind (database, application, ...) and is display only.
 */
function extractElements(agentContext) {
  const model = (agentContext && agentContext.c4Model) || {};
  const elements = [];

  const levels = [
    ["system", model.systems],
    ["container", model.containers],
    ["component", model.components],
  ];

  for (const [elementType, list] of levels) {
    for (const element of list || []) {
      if (!element.name) continue;
      elements.push({
        id: element.id,
        name: element.name,
        type: element.type,
        elementType,
        description: element.description,
        isExternal: element.isExternal === true,
      });
    }
  }

  return elements;
}

/**
 * Build a markdown description for the Change Request.
 */
function buildDescription(archChanges, matchedElements, diff, before, after) {
  const categoryGroups = groupByCategory(archChanges);

  let md = `## Auto-detected Architecture Changes\n\n`;
  md += `**Source:** GitHub push \`${before.substring(0, 7)}...${after.substring(0, 7)}\` (${diff.commits.length} commits)\n\n`;

  md += `### Changed Files\n\n`;
  for (const [cat, items] of Object.entries(categoryGroups)) {
    md += `**${categoryLabel(cat)}:**\n`;
    for (const item of items) {
      const statusIcon = item.status === "added" ? "+" : item.status === "removed" ? "-" : "~";
      md += `- \`[${statusIcon}]\` \`${item.file}\` — ${item.label}\n`;
    }
    md += `\n`;
  }

  if (matchedElements.length > 0) {
    md += `### Affected C4 Elements\n\n`;
    const seen = new Set();
    for (const match of matchedElements) {
      const key = match.element.id || match.element.name;
      if (seen.has(key)) continue;
      seen.add(key);
      md += `- **${match.element.name}** (${match.element.type}) — matched via \`${match.matchedOn}\`\n`;
    }
    md += `\n`;
  }

  md += `### Suggested Updates\n\n`;
  md += `Review the changes above and update the C4 model accordingly. `;
  md += `This Change Request was auto-generated and may require architect review.\n`;

  return md;
}

/**
 * Build structured changes for the CR API. Each entry is one `POST /requests/:id/changes`
 * body: an operation, the C4 level it applies to, and the element payload.
 *
 * Only changes the API can actually apply on merge are emitted: a create needs its
 * parent element, and an update or a delete needs the ID of an existing element.
 * Everything else stays in the CR description for the reviewer to act on.
 */
function buildSuggestedChanges(archChanges, matchedElements, elements) {
  const changes = [];
  const primarySystem = elements.find((e) => e.elementType === "system" && !e.isExternal);
  const elementsByName = new Map(elements.map((e) => [e.name.toLowerCase(), e]));

  for (const change of archChanges) {
    const elementName = extractServiceName(change.file);
    const existing = elementsByName.get(elementName.toLowerCase());

    if (change.status === "added" && (change.category === "container" || change.category === "service")) {
      if (existing || !primarySystem) continue;
      changes.push({
        operation: "create",
        elementType: "container",
        elementData: {
          name: elementName,
          description: `New ${change.label} detected: \`${change.file}\``,
          containerType: "service",
          systemId: primarySystem.id,
        },
      });
    } else if (change.status === "removed" && (change.category === "container" || change.category === "service")) {
      if (!existing) continue;
      changes.push({
        operation: "delete",
        elementType: existing.elementType,
        elementId: existing.id,
        elementData: {},
      });
    } else if (change.category === "dependency" && change.status === "added") {
      const container = findParentContainer(change.file, elements);
      if (existing || !container) continue;
      changes.push({
        operation: "create",
        elementType: "component",
        elementData: {
          name: elementName,
          description: `New dependency manifest detected: \`${change.file}\``,
          componentType: "module",
          containerId: container.id,
        },
      });
    }
    // API contract and event/messaging changes are reported in the description only:
    // a relationship needs source and target element IDs, which a file diff cannot give.
  }

  // Add updates for matched elements
  const updated = new Set();

  for (const match of matchedElements) {
    if (!match.element.id || updated.has(match.element.id)) continue;
    updated.add(match.element.id);
    changes.push({
      operation: "update",
      elementType: match.element.elementType,
      elementId: match.element.id,
      elementData: {
        description: `Modified file \`${match.change.file}\` affects this element`,
      },
    });
  }

  return changes;
}

/**
 * Find the container a file most likely belongs to, by matching its path segments
 * against known container names.
 */
function findParentContainer(filepath, elements) {
  const parts = filepath.split("/").filter(Boolean).map((p) => p.toLowerCase());

  return elements.find(
    (e) => e.elementType === "container" && parts.includes(e.name.toLowerCase())
  );
}

/**
 * Extract a service/component name from a file path.
 */
function extractServiceName(filepath) {
  const parts = filepath.split("/").filter(Boolean);

  // For cmd/X/main.go, return X
  const cmdIdx = parts.indexOf("cmd");
  if (cmdIdx !== -1 && cmdIdx + 1 < parts.length) {
    return parts[cmdIdx + 1];
  }

  // For files in a directory, return the parent directory name
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  // Fallback to filename without extension
  const base = parts[parts.length - 1];
  return base.replace(/\.[^.]+$/, "");
}

function groupByCategory(changes) {
  const groups = {};
  for (const change of changes) {
    if (!groups[change.category]) {
      groups[change.category] = [];
    }
    groups[change.category].push(change);
  }
  return groups;
}

function categoryLabel(category) {
  const labels = {
    dependency: "Dependencies",
    container: "Containers / Docker",
    api: "API Contracts",
    event: "Events / Messaging",
    infra: "Infrastructure",
    service: "Service Entry Points",
  };
  return labels[category] || category;
}

run().catch((err) => {
  core.setOutput("status", "failed");
  core.setFailed(err.message);
});
