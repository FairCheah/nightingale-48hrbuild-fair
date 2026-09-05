import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    /**
   * Hides Next's dev toolbar - the black circle bottom-left that expands into
   * Route / Bundler / Turbopack. Dev-only chrome, but it sits in the corner of
   * every frame when the app is being filmed.
   */
  devIndicators: false,
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
