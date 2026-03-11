const core = require("@actions/core");
const { HttpClient } = require("@actions/http-client");
const fs = require("fs");
const path = require("path");

async function run() {
  const apiUrl = core.getInput("api-url", { required: false }) || "https://api.archyl.com";
  const apiKey = core.getInput("api-key", { required: true });
  const projectId = core.getInput("project-id", { required: true });
  const file = core.getInput("file") || "archyl.yaml";

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  const filePath = path.resolve(workspace, file);

  if (!fs.existsSync(filePath)) {
    core.setFailed(`File not found: ${filePath}`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) {
    core.setFailed(`File is empty: ${filePath}`);
    return;
  }

  core.info(`Syncing ${file} to Archyl project ${projectId}`);

  const base = apiUrl.replace(/\/+$/, "");
  const url = `${base}/api/v1/projects/${projectId}/dsl/ingest`;

  const http = new HttpClient("archyl-sync-action");
  const response = await http.postJson(url, { content }, {
    "X-API-Key": apiKey,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    core.setFailed(`Archyl API returned ${response.statusCode}: ${JSON.stringify(response.result)}`);
    return;
  }

  const result = response.result && response.result.import;
  if (!result) {
    core.info("Sync completed (no import details returned)");
    return;
  }

  core.setOutput("systems-created", result.systemsCreated || 0);
  core.setOutput("containers-created", result.containersCreated || 0);
  core.setOutput("components-created", result.componentsCreated || 0);
  core.setOutput("relationships-created", result.relationshipsCreated || 0);

  const parts = [];
  if (result.systemsCreated) parts.push(`${result.systemsCreated} systems`);
  if (result.containersCreated) parts.push(`${result.containersCreated} containers`);
  if (result.componentsCreated) parts.push(`${result.componentsCreated} components`);
  if (result.codeElementsCreated) parts.push(`${result.codeElementsCreated} code elements`);
  if (result.relationshipsCreated) parts.push(`${result.relationshipsCreated} relationships`);
  if (result.technologiesCreated) parts.push(`${result.technologiesCreated} technologies`);
  if (result.overlaysCreated) parts.push(`${result.overlaysCreated} overlays`);
  if (result.adrsCreated) parts.push(`${result.adrsCreated} ADRs`);
  if (result.docsCreated) parts.push(`${result.docsCreated} docs`);
  if (result.eventsCreated) parts.push(`${result.eventsCreated} events`);
  if (result.apiContractsCreated) parts.push(`${result.apiContractsCreated} API contracts`);
  if (result.environmentsCreated) parts.push(`${result.environmentsCreated} environments`);
  if (result.releasesCreated) parts.push(`${result.releasesCreated} releases`);

  const summary = parts.length > 0 ? `Created: ${parts.join(", ")}` : "No new elements created";
  core.setOutput("summary", summary);
  core.info(summary);
}

run().catch((err) => {
  core.setFailed(err.message);
});
