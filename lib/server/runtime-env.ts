import { AsyncLocalStorage } from 'node:async_hooks';

const requestEnvironment = new AsyncLocalStorage<object>();

export function withRuntimeEnv<T>(environment: object, run: () => T): T {
  return requestEnvironment.run(environment, run);
}

// Keep Worker bindings scoped to their request; Node reads its service environment.
export function readRuntimeEnv(name: string): string | undefined {
  const environment = requestEnvironment.getStore();
  const value = environment && Reflect.get(environment, name);
  return value ? String(value) : process.env[name];
}
