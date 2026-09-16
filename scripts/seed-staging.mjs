import process from "node:process";
import { spawnSync } from "node:child_process";

const stagingProjectRef = "nchvyxhyfatgwpvilbng";

function fail(message) {
  process.stderr.write(`staging seed failed: ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    ...options
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`${command} ${args.join(" ")} exited with status ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

let projects;
try {
  projects = JSON.parse(run("npx", ["supabase", "projects", "list", "--output", "json"]));
} catch (error) {
  fail(`could not read the linked Supabase project: ${error instanceof Error ? error.message : String(error)}`);
}

const linkedProjects = Array.isArray(projects) ? projects.filter((project) => project?.linked === true) : [];
if (linkedProjects.length !== 1 || linkedProjects[0]?.ref !== stagingProjectRef) {
  fail(`the linked project must be the Stockly staging project (${stagingProjectRef})`);
}

process.stdout.write(`verified staging project: …${stagingProjectRef.slice(-6)}\n`);
for (const file of ["supabase/seed.staging.sql", "supabase/tests/staging_seed_contract.sql"]) {
  run("npx", ["supabase", "db", "query", "--linked", "--file", file], { stdio: "inherit" });
}
process.stdout.write("staging seed and contract verification completed\n");
