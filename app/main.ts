import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

rl.prompt();
rl.on("line", (line) => {
  if(line == "exit") {
    rl.close();
    return;
  }
  console.error(`${line}: command not found`);
  rl.prompt();
});

// rl.on("close", () => {
//   console.log("Exiting...");
//   process.exit(0);
// });