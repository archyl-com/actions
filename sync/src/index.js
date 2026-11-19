const core = require("@actions/core");
const { HttpClient } = require("@actions/http-client");
const { load } = require("./source");

async function run() {
  const apiUrl = core.getInput("api-url", { required: false }) || "https://api.archyl.com";
  const apiKey = core.getInput("api-key", { required: true });
  const projectId = core.getInput("project-id", { required: true });
  const file = core.getInput("file") || "archyl.yaml";
  const prune = core.getBooleanInput("prune");
  const force = core.getBooleanInput("force");
  if (force && !prune) {
    core.setFailed("force only applies to prune");
    return;
  }

  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();

  let source;
  try {
    source = load(workspace, file);
  } catch (err) {
    core.setFailed(err.code === "ENOENT" ? `File not found: ${file}` : err.message);
    return;
  }

  const sent = Object.keys(source.files).length;
  core.info(
    `Syncing ${file}${sent > 0 ? ` and ${sent} other file${sent > 1 ? "s" : ""}` : ""} to Archyl project ${projectId}`
  );

  const base = apiUrl.replace(/\/+$/, "");
  const url = `${base}/api/v1/projects/${projectId}/dsl/ingest`;

  const http = new HttpClient("archyl-sync-action");
  const body = { content: source.content, path: source.path };
  if (sent > 0) {
    body.files = source.files;
  }
  if (prune) {
    body.prune = true;
    body.force = force;
  }

  let response;
  try {
    response = await http.postJson(url, body, { "X-API-Key": apiKey });
  } catch (err) {
    // The client throws on a refusal and keeps the server's answer aside.
    const reason = (err.result && err.result.error) || err.message;
    const hint =
      err.statusCode === 409 && prune && !force ? ". Nothing was synced; set force: true if the file is right." : "";
    core.setFailed(`Archyl API returned ${err.statusCode || "an error"}: ${reason}${hint}`);
    return;
  }

  const result = response.result && response.result.import;
  for (const warning of (result && result.warnings) || []) {
    core.warning(warning);
  }
  if (!result) {
    core.info("Sync completed (no import details returned)");
    return;
  }

  const pruned = result.pruned || [];
  core.setOutput("pruned", pruned.length);
  for (const entry of pruned) {
    core.info(`Deleted ${entry.elementType} ${entry.elementName}`);
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

  let summary = parts.length > 0 ? `Created: ${parts.join(", ")}` : "No new elements created";
  if (pruned.length > 0) {
    summary += `. Deleted: ${pruned.length} object${pruned.length > 1 ? "s" : ""}`;
  }
  core.setOutput("summary", summary);
  core.info(summary);

  // A server that does not know the option synced the file and deleted nothing.
  if (prune && !result.pruneRan) {
    core.setFailed("This Archyl server cannot prune yet: the file was synced, nothing was deleted.");
  }
}

run().catch((err) => {
  core.setFailed(err.message);
});
