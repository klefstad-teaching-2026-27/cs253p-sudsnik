import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { routes } from "@sudsnik/contracts/services/gateway";
import { contractSuite } from "@sudsnik/contracts/testing/contractSuite";
import { createApp, handlersDir } from "../../src/index.js";

contractSuite({ describe, it, expect, beforeAll, afterAll }, { service: "gateway", routes, createApp, handlersDir });
