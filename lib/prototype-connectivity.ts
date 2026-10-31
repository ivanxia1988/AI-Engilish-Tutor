export type PrototypeProvider = 'openai' | 'qwen';
export type ProbeReadiness = 'ready' | 'login' | 'configuration' | 'unknown';

export function providerReadiness(value: unknown, provider: PrototypeProvider): ProbeReadiness {
  if (!value || typeof value !== 'object') return 'unknown';
  const status = value as { keyConfigured?: unknown; signedIn?: unknown; voiceProviders?: unknown };
  let configured = status.keyConfigured;
  if (provider === 'qwen') {
    const entries = Array.isArray(status.voiceProviders) ? status.voiceProviders : [];
    configured = entries.find(entry => entry && typeof entry === 'object' && entry.id === 'qwen')?.configured;
  }
  if (typeof configured !== 'boolean' || typeof status.signedIn !== 'boolean') return 'unknown';
  if (!configured) return 'configuration';
  return status.signedIn ? 'ready' : 'login';
}
