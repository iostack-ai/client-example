type TimeoutId = ReturnType<typeof setTimeout>;

export class IOStackAbortHandler {
  private controller: AbortController;

  private signal: AbortSignal;

  private timeoutId: TimeoutId;

  constructor(timeoutInMillis: number) {
    this.controller = new AbortController();
    this.signal = this.controller.signal;
    this.timeoutId = setTimeout(() => this.controller.abort(), timeoutInMillis);
  }

  getSignal() {
    return this.signal;
  }

  reset() {
    clearTimeout(this.timeoutId);
  }
}
