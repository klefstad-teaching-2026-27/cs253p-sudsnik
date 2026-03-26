import { TopicHandler } from "../core/TopicHandler.js";

class WashFaultedHandler extends TopicHandler<"wash.faulted"> {
  constructor() {
    super("wash.faulted");
  }
}

export default new WashFaultedHandler();
