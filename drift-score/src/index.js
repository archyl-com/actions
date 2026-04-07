const core = require("@actions/core");
const github = require("@actions/github");
const { HttpClient } = require("@actions/http-client");

async function run() {
  const apiUrl = (core.getInput("api-url") || "https://api.archyl.com").replace(/\/+$/, "");
  const apiKey = core.getInput("api-key", { required: true });
  const organizationId = core.getInput("organization-id", { required: true });
  const projectId = core.getInput("project-id", { required: true });
  const threshold = parseInt(core.getInput("threshold") || "0", 10);
  const commentOnPr = core.getInput("comment-on-pr") === "true";
  const githubToken = core.getInput("github-token");
  const pollInterval = parseInt(core.getInput("poll-interval") || "5", 10) * 1000;
  const pollTimeout = parseInt(core.getInput("poll-timeout") || "300", 10) * 1000;

  const http = new HttpClient("archyl-drift-score-action");
  const headers = {
    "X-API-Key": apiKey,
    "X-Organization-ID": organizationId,
    "Content-Type": "application/json",
  };

  // Step 1: Trigger drift computation
  core.info("Triggering drift score computation...");

  const computeUrl = `${apiUrl}/api/v1/drift/compute`;
  const computeResponse = await http.postJson(computeUrl, { projectId }, headers);

  if (computeResponse.statusCode < 200 || computeResponse.statusCode >= 300) {
    core.setFailed(`Failed to trigger drift computation: ${computeResponse.statusCode} ${JSON.stringify(computeResponse.result)}`);
    return;
  }

  const scoreId = computeResponse.result && computeResponse.result.id;
  if (!scoreId) {
    core.setFailed("No score ID returned from drift computation");
    return;
  }

  core.info(`Drift computation started: ${scoreId}`);

  // Step 2: Poll until completion
  const scoreUrl = `${apiUrl}/api/v1/drift/${scoreId}`;
  const startTime = Date.now();
  let result = null;

  while (Date.now() - startTime < pollTimeout) {
    const pollResponse = await http.getJson(scoreUrl, headers);

    if (pollResponse.statusCode < 200 || pollResponse.statusCode >= 300) {
      core.setFailed(`Failed to poll drift score: ${pollResponse.statusCode}`);
      return;
    }

    result = pollResponse.result;
    const status = result && result.status;

    if (status === "completed" || status === "failed") {
      break;
    }

    core.info(`Status: ${status} — waiting ${pollInterval / 1000}s...`);
    await sleep(pollInterval);
  }

  if (!result || (result.status !== "completed" && result.status !== "failed")) {
    core.setFailed(`Drift computation timed out after ${pollTimeout / 1000}s`);
    return;
  }

  // Step 3: Set outputs
  core.setOutput("score", result.score);
  core.setOutput("score-id", result.id);
  core.setOutput("total-elements", result.totalElements);
  core.setOutput("matched-count", result.matchedCount);
  core.setOutput("missing-in-code", result.missingInCode);
  core.setOutput("new-in-code", result.newInCode);
  core.setOutput("status", result.status);

  if (result.status === "failed") {
    core.setFailed(`Drift computation failed: ${result.errorMessage || "Unknown error"}`);
    return;
  }

  // Step 4: Report results
  const score = result.score;
  core.info("");
  core.info("╔══════════════════════════════════════╗");
  core.info(`║  Architecture Drift Score: ${String(score).padStart(3)}%      ║`);
  core.info("╚══════════════════════════════════════╝");
  core.info("");
  core.info(`  Matched:         ${result.matchedCount}`);
  core.info(`  Drifted:         ${result.driftedCount}`);
  core.info(`  Missing in code: ${result.missingInCode}`);
  core.info(`  New in code:     ${result.newInCode}`);
  core.info(`  Total elements:  ${result.totalElements}`);
  core.info("");

  // Step 5: Write job summary
  const interpretation = score >= 90 ? "Excellent" : score >= 70 ? "Good" : score >= 50 ? "Fair" : score >= 30 ? "Poor" : "Critical";
  const emoji = score >= 90 ? "✅" : score >= 70 ? "🟢" : score >= 50 ? "🟡" : score >= 30 ? "🟠" : "🔴";

  await core.summary
    .addHeading(`${emoji} Architecture Drift Score: ${score}%`)
    .addRaw(`**${interpretation}** — ${result.matchedCount} of ${result.totalElements} elements match the documented architecture.\n\n`)
    .addTable([
      [{ data: "Metric", header: true }, { data: "Count", header: true }],
      ["Matched", String(result.matchedCount)],
      ["Drifted", String(result.driftedCount)],
      ["Missing in code", String(result.missingInCode)],
      ["New in code", String(result.newInCode)],
      ["Total elements", String(result.totalElements)],
    ])
    .write();

  // Step 6: Comment on PR
  if (commentOnPr && github.context.payload.pull_request && githubToken) {
    try {
      const octokit = github.getOctokit(githubToken);
      const context = github.context;

      let body = `## ${emoji} Architecture Drift Score: ${score}%\n\n`;
      body += `**${interpretation}** — ${result.matchedCount} of ${result.totalElements} elements match the documented architecture.\n\n`;
      body += `| Metric | Count |\n|--------|-------|\n`;
      body += `| Matched | ${result.matchedCount} |\n`;
      body += `| Drifted | ${result.driftedCount} |\n`;
      body += `| Missing in code | ${result.missingInCode} |\n`;
      body += `| New in code | ${result.newInCode} |\n`;
      body += `| Total elements | ${result.totalElements} |\n\n`;
      if (threshold > 0) {
        body += `**Threshold:** ${threshold}% ${score >= threshold ? "(passed)" : "(failed)"}\n\n`;
      }
      body += `---\n*Powered by [Archyl](https://archyl.com) — Architecture Intelligence for AI-Native Teams*`;

      const comments = await octokit.rest.issues.listComments({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request.number,
      });

      const existing = comments.data.find(
        (c) => c.body && c.body.includes("Architecture Drift Score")
      );

      if (existing) {
        await octokit.rest.issues.updateComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          comment_id: existing.id,
          body,
        });
        core.info("Updated existing drift score PR comment.");
      } else {
        await octokit.rest.issues.createComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          issue_number: context.payload.pull_request.number,
          body,
        });
        core.info("Created drift score PR comment.");
      }
    } catch (err) {
      core.warning(`Failed to comment on PR: ${err.message}`);
    }
  }

  // Step 7: Threshold check
  if (threshold > 0 && score < threshold) {
    core.setFailed(`Drift score ${score}% is below threshold ${threshold}%`);
    return;
  }

  core.info(`Drift score: ${score}% (threshold: ${threshold > 0 ? threshold + "%" : "disabled"})`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

run().catch((err) => {
  core.setFailed(err.message);
});
