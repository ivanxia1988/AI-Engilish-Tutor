import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** @param {string | undefined} command @param {{ PORT?: string }} environment */
export function nodeFrameworkArguments(command, environment = process.env) {
  if (command === 'build') return ['build', '--webpack'];
  if (command !== 'start') throw new Error('Expected build or start.');
  const port = environment.PORT || '8080';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return ['start', '--hostname', '0.0.0.0', '--port', port];
}

/** @param {NodeJS.ProcessEnv} environment @returns {NodeJS.ProcessEnv} */
export function nodeFrameworkEnvironment(environment = process.env) {
  return { ...environment, NODE_ENV: 'production', LITTLELEAF_HOSTING: 'railway', NEXT_TELEMETRY_DISABLED: '1', TEEKO_NODE_RUNTIME: '1' };
}

/**
 * Keep the HTTP build while routing production upgrades through our owner.
 * @param {string | undefined} command
 * @param {{ PORT?: string }} environment
 */
export function nodeFrameworkProcessArguments(command, environment = process.env) {
  const args = nodeFrameworkArguments(command, environment);
  if (command === 'start') return ['--import', 'tsx', fileURLToPath(new URL('./serve-node.mjs', import.meta.url))];
  return [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), ...args];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('Expected build or start.');
    const args = nodeFrameworkProcessArguments(process.argv[2]);
    const child = spawn(process.execPath, args, { stdio: 'inherit', env: nodeFrameworkEnvironment() });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
    child.on('error', () => { console.error('Unable to start the Node framework process.'); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 0 : 1); });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to start the Node framework process.');
    process.exitCode = 1;
  }
}
