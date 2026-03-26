import { TopicHandler } from "../core/TopicHandler.js";

class HoldExpiredHandler extends TopicHandler<"hold.expired"> {
  constructor() {
    super("hold.expired");
  }
}

export default new HoldExpiredHandler();
