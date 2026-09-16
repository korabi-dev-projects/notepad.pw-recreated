function devLog(...args: any[]) {
  if (process.env.NODE_ENV === "development") {
    console.log("[DEV getIp]", ...args);
  }
}

export default function getIp(
  req: Request,
  server: Bun.Server<unknown>,
): string | null {
  if (process.env.TRUST_PROXY === "true") {
    const cfIp = req.headers.get("cf-connecting-ip");
    const forwardedFor = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");

    const ip =
      cfIp ?? forwardedFor?.split(",")[0]?.trim() ?? realIp ?? null;

    devLog("TRUST_PROXY is true, using IP address from headers:", ip);
    return ip;
  }

  const requestedIp = server.requestIP(req);
  if (!requestedIp) {
    devLog(
      "TRUST_PROXY is false but server.requestIP returned null for client IP address",
    );
    return null;
  }

  devLog(
    "TRUST_PROXY is false, using IP address from server.requestIP:",
    requestedIp.address,
  );
  return requestedIp.address;
}