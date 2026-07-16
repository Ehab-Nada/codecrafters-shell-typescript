import { appendFileSync, readFileSync, writeFileSync } from "fs";

export const commandHistory: string[] = [];
let lastAppendedIndex = 0;

export function loadHistoryFile(file: string): void {
  try {
    const content = readFileSync(file, "utf-8");
    for (const entry of content.split("\n")) {
      if (entry.length > 0) {
        commandHistory.push(entry);
      }
    }
  } catch {
  }
}

export function writeHistoryFile(file: string): void {
  const content = commandHistory.length > 0 ? commandHistory.join("\n") + "\n" : "";
  writeFileSync(file, content);
  lastAppendedIndex = commandHistory.length;
}

export function appendHistoryFile(file: string): void {
  const newEntries = commandHistory.slice(lastAppendedIndex);
  if (newEntries.length > 0) {
    appendFileSync(file, newEntries.join("\n") + "\n");
  }
  lastAppendedIndex = commandHistory.length;
}

export function recordHistory(line: string): void {
  if (line.trim().length > 0) {
    commandHistory.push(line);
  }
}

export function initializeHistoryFromEnv(): void {
  if (process.env.HISTFILE) {
    loadHistoryFile(process.env.HISTFILE);
    lastAppendedIndex = commandHistory.length;
  }
}
