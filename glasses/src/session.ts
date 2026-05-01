export function createPromptId(): string {
  if ("randomUUID" in crypto) {
    return `prm_${crypto.randomUUID().replace(/-/g, "")}`;
  }

  return `prm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createInstallId(): string {
  if ("randomUUID" in crypto) {
    return `inst_${crypto.randomUUID().replace(/-/g, "")}`;
  }

  return `inst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

export function expiresWithin(expiresAt: string | undefined, thresholdMs: number, now: Date = new Date()): boolean {
  if (!expiresAt) {
    return true;
  }

  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return parsed - now.getTime() <= thresholdMs;
}
