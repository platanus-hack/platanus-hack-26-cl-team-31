import type { ActivityItem } from "@team-31/protocol";

import { parseActivity } from "./parse-activity";

export type Connection = "connecting" | "live" | "reconnecting";

const initialRetryDelay = 1_000;

export class ActivitySubscription {
  private source: EventSource;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = initialRetryDelay;

  constructor(
    private readonly onActivity: (item: ActivityItem) => void,
    private readonly onConnection: (connection: Connection) => void,
  ) {
    this.source = this.connect();
  }

  close() {
    clearTimeout(this.retryTimer);
    this.source.close();
  }

  private connect() {
    const source = new EventSource("/cable/stream");
    source.addEventListener("activity", this.receive);
    source.onopen = this.opened;
    source.onerror = this.interrupted;
    return source;
  }

  private receive = (event: MessageEvent<string>) => {
    const item = parseActivity(event.data);
    if (item) this.onActivity(item);
  };

  private opened = () => {
    this.retryDelay = initialRetryDelay;
    this.onConnection("live");
  };

  private interrupted = () => {
    this.onConnection("reconnecting");
    // EventSource retries stream interruptions itself but stops on HTTP errors.
    if (this.source.readyState === EventSource.CLOSED) {
      this.retryTimer = setTimeout(() => { this.source = this.connect(); }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 15_000);
    }
  };
}
