import { TopicHandler } from "../core/TopicHandler.js";

class ChargeCapturedHandler extends TopicHandler<"charge.captured"> {
  constructor() {
    super("charge.captured");
  }
}

export default new ChargeCapturedHandler();
