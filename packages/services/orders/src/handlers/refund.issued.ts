import { TopicHandler } from "../core/TopicHandler.js";

class RefundIssuedHandler extends TopicHandler<"refund.issued"> {
  constructor() {
    super("refund.issued");
  }
}

export default new RefundIssuedHandler();
