import { TopicHandler } from "../core/TopicHandler.js";

class PodCollectedHandler extends TopicHandler<"pod.collected"> {
  constructor() {
    super("pod.collected");
  }
}

export default new PodCollectedHandler();
