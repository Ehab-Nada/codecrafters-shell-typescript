import type { ChildProcess } from "child_process";

export type Job = {
  id: number;
  pid: number;
  command: string;
  child: ChildProcess;
  running: boolean;
};

export type PathHit = {
  suffix: string;
  entryName: string;
  parentDir: string;
};

export type Redirect = {
  fd: 1 | 2;
  file: string;
  append: boolean;
};
