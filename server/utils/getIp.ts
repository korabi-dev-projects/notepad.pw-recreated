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
      "cf-connecting-ip"?: string;
      "x-forwarded-for"?: string;
      "x-real-ip"?: string;
    }; // why typescript
    // make sure there arent multiple different headers that could be used to spoof the address

    let count = 0;
    for (const header of [
      "cf-connecting-ip",
      "x-forwarded-for",
      "x-real-ip",
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
      return null;
    }

    if (headers["cf-connecting-ip"]) {
      ip = headers["cf-connecting-ip"] as string;
    } else if (headers["x-forwarded-for"]) {
      ip = headers["x-forwarded-for"].split(",")[0]!.trim(); // take the first IP in the list
    } else if (headers["x-real-ip"]) {
      ip = headers["x-real-ip"] as string;
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
