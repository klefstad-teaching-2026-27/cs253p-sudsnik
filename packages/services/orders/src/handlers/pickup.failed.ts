import { TopicHandler } from "../core/TopicHandler.js";

class PickupFailedHandler extends TopicHandler<"pickup.failed"> {
  constructor() {
    super("pickup.failed");
  }
}

export default new PickupFailedHandler();
