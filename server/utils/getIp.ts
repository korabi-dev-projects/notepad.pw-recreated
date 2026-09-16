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
      throw new Error("Multiple conflicting headers for client IP address");
    }
    if (count === 0) {
      return null;
    }

    if (headers["cf-connecting-ip"]) {
      ip = headers["cf-connecting-ip"] as string;
    } else if (headers["x-forwarded-for"]) {
      ip = headers["x-forwarded-for"].split(",")[0]!.trim(); // take the first IP in the list
    } else if (headers["x-real-ip"]) {
      ip = headers["x-real-ip"] as string;
    }
  } else {
    let requestedIp = server.requestIP(req);
    if (!requestedIp) {
      return null;
    }
    ip = requestedIp.address;
  }
  return ip;
}
