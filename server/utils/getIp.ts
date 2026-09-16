function devLog(...args: any[]) {
  if (process.env.NODE_ENV === "development") {
    console.log("[DEV getIp]", ...args);
  }
}

export default function getIp(
  req: Request,
  server: Bun.Server<unknown>,
): string | null {
  let ip = "";
  if (process.env.TRUST_PROXY === "true") {
    const headers = req.headers as {
      "CF-Connecting-IP"?: string;
      "X-Forwarded-For"?: string;
      "X-Real-IP"?: string;
    }; // why typescript
    // make sure there arent multiple different headers that could be used to spoof the address

    let count = 0;
    for (const header of [
      "CF-Connecting-IP",
      "X-Forwarded-For",
      "X-Real-IP",
    ] as const) {
      if (headers[header]) count++;
    }
    if (count > 1) {
      devLog(
        "TRUST_PROXY is true but multiple conflicting headers for client IP address were found:",
        headers,
      );
      throw new Error("Multiple conflicting headers for client IP address");
    }
    if (count === 0) {
      devLog(
        "TRUST_PROXY is true but no headers for client IP address were found",
      );
      devLog("Headers received:", headers);
      return null;
    }

    if (headers["CF-Connecting-IP"]) {
      ip = headers["CF-Connecting-IP"] as string;
    } else if (headers["X-Forwarded-For"]) {
      ip = headers["X-Forwarded-For"].split(",")[0]!.trim(); // take the first IP in the list
    } else if (headers["X-Real-IP"]) {
      ip = headers["X-Real-IP"] as string;
    }
    devLog("TRUST_PROXY is true, using IP address from headers:", ip);
  } else {
    let requestedIp = server.requestIP(req);
    if (!requestedIp) {
      devLog(
        "TRUST_PROXY is false but server.requestIP returned null for client IP address",
      );
      return null;
    }
    ip = requestedIp.address;
    devLog("TRUST_PROXY is false, using IP address from server.requestIP:", ip);
  }
  return ip;
}
