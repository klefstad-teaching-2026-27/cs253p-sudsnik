import { TopicHandler } from "../core/TopicHandler.js";

class ReturnScheduledHandler extends TopicHandler<"return.scheduled"> {
  constructor() {
    super("return.scheduled");
  }
}

export default new ReturnScheduledHandler();
