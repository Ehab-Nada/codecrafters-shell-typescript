import type { Interface } from "readline";
import { reapFinishedJobs } from "./jobs.ts";

let rl: Interface | null = null;

export function setRl(interfaceRef: Interface): void {
  rl = interfaceRef;
}

export function getRl(): Interface {
  if (!rl) {
    throw new Error("readline interface has not been initialized");
  }
  return rl;
}

export function ringBell(): void {
  process.stdout.write("\x07");
}

export function promptAfterJobs(): void {
  reapFinishedJobs();
  getRl().prompt();
}
