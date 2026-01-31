import type { Result } from "@sudsnik/kernel";
import type { Ctx } from "../../common.js";
import type { Digest, Notification, SendNotification } from "./routes.js";

export interface NotifyService {
  send(notification: SendNotification, ctx: Ctx): Promise<Result<Notification>>;
  digest(habitatId: string, ctx: Ctx): Promise<Result<Digest>>;
}
