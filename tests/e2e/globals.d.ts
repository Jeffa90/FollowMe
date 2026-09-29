export {};
declare global {
  // eslint-disable-next-line no-var
  var __followme: { start(tabId: number): Promise<{ sessionId: string }>; pause(): Promise<void>; resume(): Promise<void>; stop(): Promise<unknown>; state(): Promise<unknown> };
  // eslint-disable-next-line no-var
  var chrome: any;
}
