import { TopicHandler } from "../core/TopicHandler.js";

class PodReturnedHandler extends TopicHandler<"pod.returned"> {
  constructor() {
    super("pod.returned");
  }
}

export default new PodReturnedHandler();
