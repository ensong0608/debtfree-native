type TelemetryClient = {
  init: (options: { dsn: string; sendDefaultPii: false; beforeSend: (event: TelemetryEvent) => TelemetryEvent }) => void;
  captureException: (error: unknown, context: { tags: { source: string } }) => void;
};

type TelemetryEvent = {
  type: undefined;
  event_id?: string;
  timestamp?: number;
  platform?: string;
  exception?: { values?: { stacktrace?: { frames?: { function?: string; lineno?: number; colno?: number }[] } }[] };
};

export function createTelemetry(client: TelemetryClient, dsn: string | undefined) {
  let enabled = false;
  if (dsn?.trim()) {
    try {
      client.init({
        dsn: dsn.trim(),
        sendDefaultPii: false,
        beforeSend: event => ({
          type: event.type,
          event_id: event.event_id,
          timestamp: event.timestamp,
          platform: event.platform,
          exception: { values: event.exception?.values?.map(value => ({
            type: 'Error', value: 'Unhandled application error',
            stacktrace: { frames: value.stacktrace?.frames?.map(frame => ({
              function: frame.function, lineno: frame.lineno, colno: frame.colno,
            })) },
          })) },
        }),
      });
      enabled = true;
    } catch {
      // Telemetry must never prevent the app from starting.
    }
  }
  return (error: unknown, context: 'root_error_boundary') => {
    if (!enabled) return;
    try { client.captureException(error, { tags: { source: context } }); } catch { /* Best effort only. */ }
  };
}
