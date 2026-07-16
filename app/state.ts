import type { Job } from "./types.ts";

export const tabCompletableCommands = ["echo", "exit"];
export const builtInCommands = ["echo", "exit", "type", "pwd", "cd", "complete", "jobs", "history", "declare"];
export const completionSpecs = new Map<string, string>();
export const jobTable = new Map<number, Job>();
