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

  let c4Model = null;
  try {
    const contextUrl = `${apiUrl}/api/v1/projects/${projectId}/agent-context`;
    const contextResponse = await http.postJson(contextUrl, { format: "full" }, headers);

    if (contextResponse.statusCode >= 200 && contextResponse.statusCode < 300) {
      c4Model = contextResponse.result;
    } else {
      core.warning(`Failed to fetch C4 model (${contextResponse.statusCode}). Proceeding without element matching.`);
    }
  } catch (err) {
    core.warning(`Failed to fetch C4 model: ${err.message}. Proceeding without element matching.`);
  }

  // Step 4: Match changes against C4 elements
  const matchedElements = c4Model ? matchAgainstModel(archChanges, c4Model) : [];

  // Step 5: Build Change Request description
  const description = buildDescription(archChanges, matchedElements, diff, before, after);

  // Step 6: Build suggested changes for the CR
  const suggestedChanges = buildSuggestedChanges(archChanges, matchedElements);

  // Step 7: Create the Change Request via API
  core.info("Creating Change Request in Archyl...");

  let requestId;
  try {
    const crUrl = `${apiUrl}/api/v1/projects/${projectId}/requests`;
    const crBody = {
      title: `Auto-detected architecture changes from ${after.substring(0, 7)}`,
      description,
      type: "architecture_update",
    };

    const crResponse = await http.postJson(crUrl, crBody, headers);

    if (crResponse.statusCode < 200 || crResponse.statusCode >= 300) {
      core.setFailed(`Failed to create Change Request: ${crResponse.statusCode} ${JSON.stringify(crResponse.result)}`);
      core.setOutput("status", "failed");
      return;
    }

    requestId = crResponse.result && crResponse.result.id;
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

  // Step 8: Add changes to the CR
  if (suggestedChanges.length > 0) {
    try {
      const changesUrl = `${apiUrl}/api/v1/projects/${projectId}/requests/${requestId}/changes`;
      const changesResponse = await http.postJson(changesUrl, { changes: suggestedChanges }, headers);

      if (changesResponse.statusCode >= 200 && changesResponse.statusCode < 300) {
        core.info(`Added ${suggestedChanges.length} suggested changes to the CR.`);
      } else {
        core.warning(`Failed to add changes to CR: ${changesResponse.statusCode}`);
      }
    } catch (err) {
      core.warning(`Failed to add changes to CR: ${err.message}`);
    }
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
  core.info(`  Suggested CR changes:   ${suggestedChanges.length}`);
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
    .addRaw(`**Suggested element updates:** ${suggestedChanges.length}\n\n`)
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
function matchAgainstModel(archChanges, c4Model) {
  const matched = [];

  // Extract element names from the model for fuzzy matching
  const elements = extractElements(c4Model);

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
 * Extract all named elements from the C4 model response.
 */
function extractElements(c4Model) {
  const elements = [];

  if (!c4Model) return elements;

  const walk = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
      return;
    }
    if (obj.name && obj.type) {
      elements.push({
        name: obj.name,
        type: obj.type,
        id: obj.id,
        description: obj.description,
      });
    }
    for (const val of Object.values(obj)) {
      if (typeof val === "object") walk(val);
    }
  };

  walk(c4Model);
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
 * Build structured changes for the CR API.
 */
function buildSuggestedChanges(archChanges, matchedElements) {
  const changes = [];

  for (const change of archChanges) {
    if (change.status === "added" && (change.category === "container" || change.category === "service")) {
      const dirName = extractServiceName(change.file);
      changes.push({
        type: "create",
        elementType: "container",
        elementName: dirName,
        description: `New ${change.label} detected: \`${change.file}\``,
      });
    } else if (change.status === "removed" && (change.category === "container" || change.category === "service")) {
      const dirName = extractServiceName(change.file);
      changes.push({
        type: "delete",
        elementType: "container",
        elementName: dirName,
        description: `Removed ${change.label}: \`${change.file}\``,
      });
    } else if (change.category === "api") {
      changes.push({
        type: change.status === "added" ? "create" : "update",
        elementType: "relationship",
        elementName: extractServiceName(change.file),
        description: `${change.status === "added" ? "New" : "Modified"} API contract: \`${change.file}\``,
      });
    } else if (change.category === "event") {
      changes.push({
        type: change.status === "added" ? "create" : "update",
        elementType: "relationship",
        elementName: extractServiceName(change.file),
        description: `${change.status === "added" ? "New" : "Modified"} event/messaging config: \`${change.file}\``,
      });
    } else if (change.category === "dependency" && change.status === "added") {
      changes.push({
        type: "create",
        elementType: "component",
        elementName: extractServiceName(change.file),
        description: `New dependency manifest detected: \`${change.file}\``,
      });
    }
  }

  // Add updates for matched elements
  for (const match of matchedElements) {
    const alreadyTracked = changes.some(
      (c) => c.elementName.toLowerCase() === match.element.name.toLowerCase()
    );
    if (!alreadyTracked) {
      changes.push({
        type: "update",
        elementType: match.element.type,
        elementName: match.element.name,
        description: `Modified file \`${match.change.file}\` affects this element`,
      });
    }
  }

  return changes;
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
