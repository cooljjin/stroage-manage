import { execFileSync, spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";

const tailscale = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const run = (...args) => execFileSync(tailscale, args, { encoding: "utf8" });
const staging = loadEnv("staging", process.cwd(), "VITE_");
const production = loadEnv("production", process.cwd(), "VITE_");
for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
  if (!staging[key] || staging[key] === production[key]) {
    throw new Error(`${key}: 별도 staging 값이 필요합니다.`);
  }
}
// launchd cannot start the Tailscale GUI CLI; its preconfigured host skips only that probe.
const state = process.env.STOCKLY_DEV_HOST ? null : JSON.parse(run("status", "--json"));
const host = process.env.STOCKLY_DEV_HOST || state?.Self?.DNSName?.replace(/\.$/, "");
if ((state && state.BackendState !== "Running") || !host?.endsWith(".ts.net")) {
  throw new Error("Tailscale 연결이 필요합니다.");
}
const url = `https://${host}:8443`;
const plist = readFileSync("ios/App/App/Info-Dev.plist", "utf8");
if (!plist.includes(`<string>${url}</string>`)) {
  throw new Error("Info-Dev.plist의 StocklyDevServerURL과 Tailscale DNS가 다릅니다.");
}
if (state) {
  const config = JSON.parse(run("serve", "status", "--json"));
  const proxy = config.Web?.[`${host}:8443`]?.Handlers?.["/"]?.Proxy;
  if (proxy && proxy !== "http://127.0.0.1:5173") {
    throw new Error("Tailscale Serve 8443 포트가 다른 서비스에 사용 중입니다.");
  }
  if (!proxy) run("serve", "--bg", "--https=8443", "127.0.0.1:5173");
}
console.log(`Stockly Dev: ${url} (tailnet only, staging DB)`);
const child = spawn("./node_modules/.bin/vite", ["--mode", "staging", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
  stdio: "inherit", env: { ...process.env, STOCKLY_DEV_HOST: host }
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => { process.exitCode = code ?? 0; });
