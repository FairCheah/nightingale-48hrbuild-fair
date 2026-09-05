import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /**
   * Next 16 traces server action arguments to stdout in dev, so the patient's
   * raw message was printed on every turn:
   *   sendGuestMessage("pineapple marmalade seventeen")
   *
   * Framework, not our code, and dev only. But it is a developer's terminal
   * and anything capturing it, and scenario 11 asks which doors a message
   * leaves through that the architecture diagram does not draw.
   */
  logging: {
    incomingRequests: false,
  },
  /* config options here */
};

export default nextConfig;
