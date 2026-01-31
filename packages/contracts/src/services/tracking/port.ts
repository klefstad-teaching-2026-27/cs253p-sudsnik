import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { PodLocation, Position } from "./routes.js";

export interface TrackingService {
  position(shuttleId: string, ctx: Ctx): Promise<Result<Position>>;
  positions(ctx: Ctx): Promise<Result<Position[]>>;
  podLocation(podId: string, ctx: Ctx): Promise<Result<PodLocation>>;
}
