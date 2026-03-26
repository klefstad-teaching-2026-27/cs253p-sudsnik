import { TopicHandler } from "../core/TopicHandler.js";

class WashStartedHandler extends TopicHandler<"wash.started"> {
  constructor() {
    super("wash.started");
  }
}

export default new WashStartedHandler();
