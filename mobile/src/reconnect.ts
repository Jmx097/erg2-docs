export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  initialDelayMs: 1_000,
  maxDelayMs: 30_000
};

export function calculateReconnectDelayMs(
  attempt: number,
  policy: ReconnectPolicy = DEFAULT_RECONNECT_POLICY,
  random: () => number = Math.random
): number {
  const cappedBase = Math.min(policy.initialDelayMs * 2 ** Math.max(0, attempt), policy.maxDelayMs);
  return Math.floor(random() * cappedBase);
}
