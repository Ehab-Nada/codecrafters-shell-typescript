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

  else if (line.startsWith("echo")) {
    console.log(line.split(" ").slice(1).join(" "));
    rl.prompt();
    return;
  } else {
    console.error(`${line.split(" ")[0]}: command not found`);
    rl.prompt();
  }

  

});


// rl.on("close", () => {
//   console.log("Exiting...");
//   process.exit(0);
// });