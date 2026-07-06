import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

rl.prompt();
rl.on("line", (line) => {
  console.error(`${line}: command not found`);
  rl.prompt();
});