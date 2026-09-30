/**
 * Minimal webhook receiver for Paystack and Flutterwave using only Node's http module.
 *
 * Run it:
 *   PAYSTACK_SECRET_KEY=sk_test_123 FLUTTERWAVE_SECRET_HASH=my-hash node examples/server.mjs
 *
 * Then, in another terminal:
 *   npx paylocal trigger paystack charge.success --to http://localhost:3000/webhooks/paystack --secret sk_test_123
 *   npx paylocal trigger flutterwave charge.completed --to http://localhost:3000/webhooks/flutterwave --secret my-hash
 *   npx paylocal verify paystack --to http://localhost:3000/webhooks/paystack --secret sk_test_123
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3000);
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ?? "sk_test_123";
const FLUTTERWAVE_SECRET_HASH = process.env.FLUTTERWAVE_SECRET_HASH ?? "my-hash";

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Paystack: HMAC-SHA512 of the raw body with your secret key, compared to x-paystack-signature. */
function isValidPaystack(rawBody, headers) {
  const expected = createHmac("sha512", PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  return safeEqual(headers["x-paystack-signature"] ?? "", expected);
}

/** Flutterwave v3: the verif-hash header must equal the secret hash from your dashboard. */
function isValidFlutterwave(headers) {
  return safeEqual(headers["verif-hash"] ?? "", FLUTTERWAVE_SECRET_HASH);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  const rawBody = await readBody(req);
  const reply = (status, message) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ message }));
  };

  if (req.method !== "POST") return reply(405, "POST only");

  if (req.url === "/webhooks/paystack") {
    if (!isValidPaystack(rawBody, req.headers)) return reply(401, "invalid paystack signature");
    const event = JSON.parse(rawBody);
    console.log(`paystack   ${event.event.padEnd(32)} ${event.data?.reference ?? ""}`);
    return reply(200, "ok");
  }

  if (req.url === "/webhooks/flutterwave") {
    if (!isValidFlutterwave(req.headers)) return reply(401, "invalid flutterwave hash");
    const event = JSON.parse(rawBody);
    console.log(
      `flutterwave ${event.event.padEnd(31)} ${event.data?.tx_ref ?? event.data?.reference ?? ""}`,
    );
    return reply(200, "ok");
  }

  return reply(404, "unknown route");
});

server.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
  console.log(`  POST /webhooks/paystack     (secret key: ${PAYSTACK_SECRET_KEY})`);
  console.log(`  POST /webhooks/flutterwave  (secret hash: ${FLUTTERWAVE_SECRET_HASH})`);
});
