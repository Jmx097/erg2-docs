export function logBridgeEvent<T extends { event: string }>(entry: T): void {
  const payload = {
    ts: new Date().toISOString(),
    ...entry
  };

  console.log(JSON.stringify(payload));
}
