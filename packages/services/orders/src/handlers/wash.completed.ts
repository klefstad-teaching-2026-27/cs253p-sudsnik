import { TopicHandler } from "../core/TopicHandler.js";

class WashCompletedHandler extends TopicHandler<"wash.completed"> {
  constructor() {
    super("wash.completed");
  }
}

export default new WashCompletedHandler();
