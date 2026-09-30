import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface TestServer {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

export type Responder = (
  request: CapturedRequest,
) => { status: number; body?: string } | Promise<{ status: number; body?: string }>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Starts an HTTP server on a random port that records every request. */
export async function startServer(respond: Responder): Promise<TestServer> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer(async (req, res) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
    const captured: CapturedRequest = {
      method: req.method ?? "GET",
      url: req.url ?? "/",
      headers,
      body: await readBody(req),
    };
    requests.push(captured);
    const result = await respond(captured);
    res.statusCode = result.status;
    res.setHeader("content-type", "application/json");
    res.end(result.body ?? JSON.stringify({ status: result.status }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
