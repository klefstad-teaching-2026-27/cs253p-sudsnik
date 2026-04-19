import { SERVICES, type Service } from "@sudsnik/contracts";
import { loadService } from "./services.js";

const name = process.argv[2] as Service | undefined;
if (!name || !(SERVICES as readonly string[]).includes(name)) {
  console.error(`usage: service-entry <${SERVICES.join("|")}>`);
  process.exit(2);
}
const mod = await loadService(name);
await mod.start();
