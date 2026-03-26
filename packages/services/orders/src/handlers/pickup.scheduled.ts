import { TopicHandler } from "../core/TopicHandler.js";

class PickupScheduledHandler extends TopicHandler<"pickup.scheduled"> {
  constructor() {
    super("pickup.scheduled");
  }
}

export default new PickupScheduledHandler();
