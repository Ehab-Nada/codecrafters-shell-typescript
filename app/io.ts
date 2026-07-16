import { appendFileSync, writeFileSync } from "fs";
import type { Redirect } from "./types.ts";

export function writeOutput(
  stdout: string | null,
  stderr: string | null,
  redirects: Redirect[],
) {
  const stdoutRedirect = redirects.find((redirect) => redirect.fd === 1);
  const stderrRedirect = redirects.find((redirect) => redirect.fd === 2);

  if (stdoutRedirect) {
    writeToRedirect(stdoutRedirect.file, stdout ?? "", stdoutRedirect.append);
  } else if (stdout !== null) {
    process.stdout.write(stdout);
  }

  if (stderrRedirect) {
    writeToRedirect(stderrRedirect.file, stderr ?? "", stderrRedirect.append);
  } else if (stderr !== null) {
    process.stderr.write(stderr);
  }
}

export function writeToRedirect(file: string, content: string, append: boolean) {
  if (append) {
    appendFileSync(file, content);
  } else {
    writeFileSync(file, content);
  }
}
