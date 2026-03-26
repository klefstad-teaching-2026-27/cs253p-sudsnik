import { TopicHandler } from "../core/TopicHandler.js";

class ChargeFailedHandler extends TopicHandler<"charge.failed"> {
  constructor() {
    super("charge.failed");
  }
}

export default new ChargeFailedHandler();
