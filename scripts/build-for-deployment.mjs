import { spawnSync } from "node:child_process"
import process from "node:process"

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.error) {
    process.stderr.write(`${command} could not start: ${result.error.message}\n`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

const mode = process.env.VERCEL_ENV === "preview" ? "staging" : "production"
run("npx", ["tsc", "-b"])
run("npx", ["vite", "build", "--mode", mode])
