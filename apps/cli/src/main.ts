import { fetch } from "undici";
import { describeEnv, startStack } from "./start.js";
import { startAllMocksProcess } from "./mocks.js";

const [cmd = "help", ...rest] = process.argv.slice(2);
const has = (flag: string) => rest.includes(flag);

async function main(): Promise<void> {
  switch (cmd) {
    case "start": {
      const stack = await startStack({ single: has("--single"), mocks: !has("--no-mocks"), sim: !has("--no-sim") });
      console.log(describeEnv(stack.env));
      console.log(`ready: ${stack.rootUrl}/ready`);
      const stop = () => void stack.stop().then(() => process.exit(0));
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
      break;
    }
    case "mocks":
      await startAllMocksProcess();
      break;
    case "cost": {
      const url = rest[0] ?? "http://127.0.0.1:4000";
      const r = await fetch(`${url}/cost`);
      console.log(JSON.stringify(await r.json(), null, 2));
      break;
    }
    default:
      console.log("usage: sudsnik start [--single] [--no-mocks] [--no-sim] | mocks | cost [rootUrl]");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
