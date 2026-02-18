const core = require("@actions/core");
const { HttpClient } = require("@actions/http-client");

async function run() {
  const apiUrl = core.getInput("api-url", { required: false }) || "https://api.archyl.com";
  const apiKey = core.getInput("api-key", { required: true });
  const projectId = core.getInput("project-id", { required: true });
  const version = core.getInput("version") || process.env.GITHUB_REF_NAME || "";
  const status = core.getInput("status") || "deployed";
  const changelog = core.getInput("changelog") || "";
  const environment = core.getInput("environment") || "";
  const sourceUrl =
    core.getInput("source-url") ||
    `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  if (!version) {
    core.setFailed("No version provided and GITHUB_REF_NAME is not set");
    return;
  }

  const body = { version, status, source: "github_action" };
  if (changelog) body.changelog = changelog;
  if (environment) body.environment = environment;
  if (sourceUrl) body.sourceUrl = sourceUrl;

  const url = `${apiUrl.replace(/\/+$/, "")}/api/v1/projects/${projectId}/releases/ingest`;

  const http = new HttpClient("archyl-release-action");
  const response = await http.postJson(url, body, {
    "X-API-Key": apiKey,
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    core.setFailed(`Archyl API returned ${response.statusCode}: ${JSON.stringify(response.result)}`);
    return;
  }

  const releaseId = response.result && response.result.id;
  if (releaseId) {
    core.setOutput("release-id", releaseId);
    core.info(`Release created: ${releaseId}`);
  } else {
    core.info("Release created (no ID returned)");
  }
}

run().catch((err) => {
  core.setFailed(err.message);
});
