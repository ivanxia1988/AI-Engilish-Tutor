import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import "./sites-env.mjs";

/** @param {{ PORT?: string; RAILWAY_PUBLIC_DOMAIN?: string }} environment */
export function railwayArguments(environment = process.env) {
  const port = environment.PORT || "8080";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  const args = [
    "dev", "--config", "dist/server/wrangler.json", "--local",
    "--ip", "0.0.0.0", "--port", port, "--inspector-port", "0",
    "--log-level", "error", "--show-interactive-dev-session=false",
  ];
  if (environment.RAILWAY_PUBLIC_DOMAIN) {
    args.push("--local-upstream", environment.RAILWAY_PUBLIC_DOMAIN, "--upstream-protocol", "https");
  }
  return args;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const cli = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const child = spawn(process.execPath, [cli, ...railwayArguments()], {
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_INCLUDE_PROCESS_ENV: "true",
      LITTLELEAF_HOSTING: "railway",
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", () => {
    console.error("Unable to start the Railway server.");
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(code ?? (signal === "SIGTERM" ? 0 : 1)));
}
