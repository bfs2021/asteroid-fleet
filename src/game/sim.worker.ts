/// <reference lib="webworker" />
import type { InMsg, OutMsg } from './protocol';
import { SimRunner } from './runner';

declare const self: DedicatedWorkerGlobalScope;

const runner = new SimRunner((msg: OutMsg, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer),
);
self.addEventListener('message', (e: MessageEvent<InMsg>) => runner.handle(e.data));
