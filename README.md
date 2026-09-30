# paylocal

**Local webhook tooling for Paystack and Flutterwave.**

Trigger, replay and verify correctly signed webhook events against your dev server.
No tunnel, no test card, no waiting for a real transaction.

```sh
npx paylocal trigger paystack charge.success --to http://localhost:3000/webhooks/paystack
```

[![npm](https://img.shields.io/npm/v/paylocal)](https://www.npmjs.com/package/paylocal)
[![CI](https://github.com/omoyolab/paylocal/actions/workflows/ci.yml/badge.svg)](https://github.com/omoyolab/paylocal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why

Stripe developers get a CLI that forwards webhooks and fires fake events. Paystack and
Flutterwave developers get a dashboard button and a tunnel. Testing a webhook handler
means exposing localhost, making a real test payment, and hoping the event arrives.

paylocal removes that loop:

- **Trigger** any supported event with a valid signature, straight to `localhost`.
- **Override** any field, so you can test the edge cases the dashboard never sends.
- **Replay** a delivery from your log, or a payload you captured from production.
- **Verify** that your endpoint actually rejects tampered requests.
- **Generate fixtures** for Jest, Vitest or any test runner from the same code.

Zero runtime dependencies. Works with any language on the receiving end.

## Install

```sh
npm install -g paylocal      # or: pnpm add -g paylocal
# or run it without installing
npx paylocal --help
```

Requires Node 20 or newer.

## Quick start

Start the bundled example receiver, or point paylocal at your own app.

```sh
git clone https://github.com/omoyolab/paylocal && cd paylocal
node examples/server.mjs
```

In another terminal:

```sh
npx paylocal trigger paystack charge.success \
  --to http://localhost:3000/webhooks/paystack \
  --secret sk_test_123
```

```
paylocal ▸ paystack charge.success → http://localhost:3000/webhooks/paystack

  reference             ref_9c1b7e2a4d3f
  amount                500000 NGN
  customer              ada.okafor@example.com
  status                success
  x-paystack-signature  4c1d9e0a7b3f…e2a8c19d

✔ 200 in 14ms
  {"message":"ok"}
  logged as 20260929-211502-118-paystack-charge.success
```

Now check that the handler rejects forgeries:

```sh
npx paylocal verify paystack --to http://localhost:3000/webhooks/paystack --secret sk_test_123
```

```
paylocal ▸ verify paystack → http://localhost:3000/webhooks/paystack

  valid event     accepted HTTP 200, 12ms
  tampered event  rejected HTTP 401, 3ms
  tamper          body changed after signing, original signature kept

✔ verified
  Valid event accepted (HTTP 200), tampered event rejected (HTTP 401).
```

## Commands

### `paylocal trigger <provider> <event>`

Builds a realistic payload, signs it the way the provider does, and POSTs it to `--to`.

```sh
paylocal trigger paystack charge.success --to http://localhost:3000/webhooks/paystack
paylocal trigger paystack transfer.failed --to http://localhost:3000/webhooks/paystack --amount 2500000
paylocal trigger flutterwave charge.completed --to http://localhost:3000/hooks --email ada@example.com
```

Override any field with `--set path=value`. Values are coerced: numbers become numbers,
`true`/`false`/`null` become JSON, and anything wrapped in `{}`, `[]` or `""` is parsed as JSON.

```sh
paylocal trigger paystack charge.success --to $URL \
  --set data.status=failed \
  --set data.gateway_response="Declined" \
  --set data.metadata='{"order_id":"ORD-1042"}' \
  --set 'data.reference="0001234"'      # keep leading zeros as a string
```

Shortcuts for the fields everyone touches: `--amount`, `--email`, `--reference`, `--currency`.

`--dry-run` prints the signed request without sending it. Add `--json` for machine output.

### `paylocal replay <id|file>`

Resends a stored payload with a fresh signature.

```sh
paylocal replay 20260929-211502-118-paystack-charge.success --to $URL
paylocal replay ./captured-from-prod.json --provider paystack --to $URL
```

Every trigger is recorded in `.paylocal/events/` (add it to `.gitignore`, paylocal's own
`.gitignore` already does). A raw payload you saved from a real delivery works too.

### `paylocal verify <provider>`

Sends one valid event and one tampered event and tells you whether your endpoint can tell
them apart. Exit code 0 means verified, 1 means it accepted the forgery or rejected the
real thing. Run it in CI against a staging server if you like.

### `paylocal events [provider]` and `paylocal log`

List the events you can trigger, and the deliveries you have sent.

### Options

| Option                                             | Meaning                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `--to <url>`                                       | Endpoint that receives the webhook. Falls back to `PAYLOCAL_URL`.                 |
| `--secret <value>`                                 | Signing secret. Falls back to `PAYSTACK_SECRET_KEY` or `FLUTTERWAVE_SECRET_HASH`. |
| `--set <path=value>`                               | Override a payload field. Repeatable.                                             |
| `--amount`, `--email`, `--reference`, `--currency` | Shortcuts for common fields.                                                      |
| `--event <name>`                                   | Event used by `verify`. Defaults per provider.                                    |
| `--provider <id>`                                  | Provider for `replay` when the file does not say.                                 |
| `--dry-run`                                        | Print the request instead of sending it.                                          |
| `--no-log`                                         | Skip writing to `.paylocal/events`.                                               |
| `--timeout <ms>`                                   | Request timeout. Default `10000`.                                                 |
| `--json`                                           | Machine-readable output.                                                          |

Exit codes: `0` success, `1` delivery rejected or endpoint not verified, `2` usage error.

## Use it in your tests

The same engine is available as a library, so your test suite can produce signed webhooks
without hand-rolling HMACs.

```ts
import { webhook } from "paylocal";
import request from "supertest";
import { app } from "../src/app";

const secret = process.env.PAYSTACK_SECRET_KEY!;

test("marks the order paid on charge.success", async () => {
  const { body, headers } = webhook("paystack", "charge.success", {
    amount: 500_000,
    reference: "ORD-1042",
  }).sign(secret);

  await request(app).post("/webhooks/paystack").set(headers).send(body).expect(200);

  expect(await orders.get("ORD-1042")).toMatchObject({ status: "paid" });
});

test("rejects a tampered body", async () => {
  const { body, headers } = webhook("paystack", "charge.success").sign(secret);
  await request(app)
    .post("/webhooks/paystack")
    .set(headers)
    .send(body.replace("500000", "1"))
    .expect(401);
});
```

Lower-level pieces are exported too: `buildEvent`, `signEvent`, `deliver`, `verifyEndpoint`,
`paystackSignature`, `providers`. Everything is typed.

## How the signatures work

| Provider    | Header                 | Scheme                                                     | Secret                               |
| ----------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------ |
| Paystack    | `x-paystack-signature` | HMAC-SHA512 of the raw request body, hex encoded           | Your secret key (`sk_test_…`)        |
| Flutterwave | `verif-hash`           | Header must equal the secret hash you set in the dashboard | Secret hash from Settings → Webhooks |

paylocal signs the exact bytes it sends, so if your handler verifies the raw body (as it
should) the signature will match. If you parse the JSON first and re-serialize it, the
signature will not match, and that is a bug in the handler, not in paylocal.

Flutterwave v3 does not sign the body. `verify` still confirms your endpoint checks the
header, but treat every payload as a hint and confirm with the verify-transaction API
before fulfilling an order.

## Supported events

Run `paylocal events` for the live list. Currently:

**Paystack**: `charge.success`, `charge.dispute.create`, `transfer.success`,
`transfer.failed`, `transfer.reversed`, `subscription.create`, `subscription.disable`,
`subscription.not_renew`, `invoice.create`, `invoice.update`, `invoice.payment_failed`,
`refund.pending`, `refund.processed`, `refund.failed`, `customeridentification.success`,
`customeridentification.failed`, `dedicatedaccount.assign.success`,
`dedicatedaccount.assign.failed`, `paymentrequest.pending`, `paymentrequest.success`.

**Flutterwave** (v3): `charge.completed`, `transfer.completed`, `refund.completed`,
`subscription.cancelled`.

Payload shapes follow the providers' public documentation. Providers change shapes without
notice. If you have a real delivery that differs from what paylocal sends, please
[open a payload report](https://github.com/omoyolab/paylocal/issues/new?template=payload_report.yml)
with the secrets removed. That is the single most useful contribution.

## Roadmap

- `paylocal listen`: forward real provider webhooks to localhost through a tunnel.
- `paylocal mock`: a local stand-in for the provider APIs, so `initialize` and `verify`
  calls work offline.
- More providers: Monnify, Interswitch, OPay, M-Pesa. Adding one is a single file.
- Flutterwave v4 signature scheme once it is stable.

Vote on these or propose others in [Discussions](https://github.com/omoyolab/paylocal/discussions).

## Contributing

Bug reports, payload corrections, new events and new providers are all welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the setup and the checklist.

## License

[MIT](LICENSE). paylocal is not affiliated with or endorsed by Paystack or Flutterwave.
