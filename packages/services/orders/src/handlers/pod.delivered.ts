import { TopicHandler } from "../core/TopicHandler.js";

class PodDeliveredHandler extends TopicHandler<"pod.delivered"> {
  constructor() {
    super("pod.delivered");
  }
}

export default new PodDeliveredHandler();
