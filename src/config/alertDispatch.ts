function parseChannelList(envVal: string | undefined, fallback: string[]): string[] {
  if (!envVal || !envVal.trim()) return fallback;
  return envVal
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

// How many recipients go out per batch tick, and how often the tick runs.
export const ALERT_BATCH_SIZE = Number(process.env.ALERT_BATCH_SIZE) || 100;
export const ALERT_BATCH_INTERVAL_MINUTES =
  Number(process.env.ALERT_BATCH_INTERVAL_MINUTES) || 10;

// Which alert channels are throttled through the batch queue instead of
// firing immediately. Only channels the worker knows how to dispatch
// (currently: email) have any effect here — see alertBatchCronJobs.ts.
export const ALERT_BATCHED_CHANNELS = parseChannelList(
  process.env.ALERT_BATCHED_CHANNELS,
  ["email"],
);

// Which alert channels get the "Hi {name}, " prefix when an alert has
// isPersonalised set. SMS is excluded by default (message length/cost).
export const ALERT_PERSONALISED_CHANNELS = parseChannelList(
  process.env.ALERT_PERSONALISED_CHANNELS,
  ["email", "push", "in_app"],
);
