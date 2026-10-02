# paylocal

**Local webhook tooling for Paystack and Flutterwave.**

Trigger, replay and verify correctly signed webhook events against your dev server.
No tunnel, no test card, no waiting for a real transaction.

```sh
npx @omoyolab/paylocal trigger paystack charge.success --to http://localhost:3000/webhooks/paystack
```

[![npm](https://img.shields.io/npm/v/%40omoyolab%2Fpaylocal)](https://www.npmjs.com/package/@omoyolab/paylocal)
[![CI](https://github.com/omoyolab/paylocal/actions/workflows/ci.yml/badge.svg)](https://github.com/omoyolab/paylocal/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## Why

Stripe developers get a CLI that forwards webhooks and fires fake events. Paystack and
Flutterwave developers get a dashboard button and a tunnel. Testing a webhook handler
means exposing localhost, making a real test payment, and hoping the event arrives.

paylocal removes that loop:

- **Trigger** any supported event with a valid signature, straight to `localhost`.
- **Run a scenario**: a payment and its refund or dispute, linked by one reference, in
  order, backwards or twice.
- **Override** any field, so you can test the edge cases the dashboard never sends.
- **Replay** the last delivery, one from your log, or a payload you captured from production.
- **Verify** that your endpoint refuses a missing signature, a wrong secret and a changed body.
- **Generate fixtures** for Jest, Vitest or any test runner from the same code.

Zero runtime dependencies. Works with any language on the receiving end.

## Install

```sh
npm install -g @omoyolab/paylocal      # or: pnpm add -g @omoyolab/paylocal
# or run it without installing
npx @omoyolab/paylocal --help
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
npx @omoyolab/paylocal trigger paystack charge.success \
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
npx @omoyolab/paylocal verify paystack --to http://localhost:3000/webhooks/paystack --secret sk_test_123
```

```
paylocal ▸ verify paystack → http://localhost:3000/webhooks/paystack

  valid event   accepted HTTP 200, 12ms
  no signature  rejected HTTP 401, 2ms
  wrong secret  rejected HTTP 401, 2ms
  changed body  rejected HTTP 401, 3ms

✔ verified
  Valid event accepted (HTTP 200), 3 forged requests refused.
```

For a whole application built and tested this way, see the
[shop use case](https://github.com/omoyolab/paylocal-usecases): orders, refunds, disputes
and both providers, with what it found in paylocal along the way.

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
Each one sets the field the event keeps that value in. On `charge.success` the reference
is `data.reference`, on a refund it is `data.transaction_reference`, on a dispute it is
`data.transaction.reference`. If an event has no such field, the command says so and stops.

`--amount` is in the provider's own unit: kobo for Paystack, naira for Flutterwave.

`--dry-run` prints the signed request without sending it. Add `--json` for machine output.

### `paylocal scenario <provider> <name>`

Sends the notices a provider sends over the life of one transaction. They share the
reference, amount, customer and ids that a real run shares.

```sh
paylocal scenario paystack refund --to $URL --reference ORD-1042 --amount 1250000
```

That sends `charge.success`, `refund.pending`, `refund.processing` and `refund.processed`
for ORD-1042, and prints each one the way `trigger` does.

Providers do not promise the order of delivery, and they send a notice again when they
are not sure it arrived. Two flags let you check your handler copes:

```sh
paylocal scenario paystack refund --to $URL --reference ORD-1042 --reverse   # last to first
paylocal scenario paystack payment --to $URL --reference ORD-1042 --twice    # each notice two times
```

| Provider    | Scenario         | Notices                                                                     |
| ----------- | ---------------- | --------------------------------------------------------------------------- |
| Paystack    | `payment`        | `charge.success`                                                            |
| Paystack    | `refund`         | `charge.success`, `refund.pending`, `refund.processing`, `refund.processed` |
| Paystack    | `refund-failed`  | `charge.success`, `refund.pending`, `refund.failed`                         |
| Paystack    | `dispute`        | `charge.success`, `charge.dispute.create`                                   |
| Flutterwave | `payment`        | `charge.completed`                                                          |
| Flutterwave | `failed-payment` | `charge.completed` with a failed status                                     |
| Flutterwave | `refund`         | `charge.completed`, `refund.completed`                                      |

The shortcuts and `--set` describe the first notice, and the rest follow it. So
`--set data.id=7001` on a Flutterwave refund scenario gives the charge that id and the
refund that `tx_id`. `paylocal scenarios` prints this list.

### `paylocal replay <last|id|file>`

Resends a stored payload with a fresh signature. The body is the same, byte for byte,
which is what a provider's retry looks like to your handler.

```sh
paylocal replay last --to $URL
paylocal replay 20260929-211502-118-paystack-charge.success --to $URL
paylocal replay ./captured-from-prod.json --provider paystack --to $URL
```

Every trigger is recorded in `.paylocal/events/` (add it to `.gitignore`, paylocal's own
`.gitignore` already does). A raw payload you saved from a real delivery works too.

### `paylocal verify <provider>`

Sends one valid event, then each kind of request your endpoint should refuse:

| Request        | What is wrong with it                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- |
| `no signature` | The signature header is missing                                                                |
| `wrong secret` | The signature was made with a different secret                                                 |
| `changed body` | The body was changed after signing. Paystack only, since Flutterwave v3 does not sign the body |

The endpoint is verified when it accepts the valid event and refuses each of the others
with a 4xx. If it accepts one, anyone who can reach the URL can fake an event. If it
answers one with a 5xx, the handler broke where it should have refused; a signature
comparison that throws on a missing header is the usual cause.

Exit code 0 means verified, 1 means anything else. Run it in CI against a staging server
if you like.

### `paylocal events [provider]`, `paylocal scenarios [provider]` and `paylocal log`

List the events you can trigger, the scenarios you can run, and the deliveries you have sent.

### Custom request headers

Pass repeatable `--header "Name: value"` flags to trigger, scenario, replay or verify.
For example, `paylocal trigger paystack charge.success --to http://localhost:3000/hooks --header "X-Tenant: dev"`.
Headers also appear in dry-run output. Header names are case-insensitive; the last value wins.
Provider signature headers are always controlled by paylocal, including verification probes.

### Options

| Option                                             | Meaning                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--to <url>`                                       | Endpoint that receives the webhook. Falls back to `PAYLOCAL_URL`.                    |
| `--secret <value>`                                 | Signing secret. Falls back to `PAYSTACK_SECRET_KEY` or `FLUTTERWAVE_SECRET_HASH`.    |
| `--header <Name: value>`                           | Add a request header. Repeatable.                                                    |
| `--set <path=value>`                               | Override a payload field. Repeatable.                                                |
| `--amount`, `--email`, `--reference`, `--currency` | Shortcuts for common fields. The amount is kobo for Paystack, naira for Flutterwave. |
| `--reverse`, `--twice`                             | For `scenario`: send the notices last to first, or each one two times.               |
| `--event <name>`                                   | Event used by `verify`. Defaults per provider.                                       |
| `--provider <id>`                                  | Provider for `replay` when the file does not say.                                    |
| `--dry-run`                                        | Print the request instead of sending it.                                             |
| `--no-log`                                         | Skip writing to `.paylocal/events`.                                                  |
| `--timeout <ms>`                                   | Request timeout. Default `10000`.                                                    |
| `--json`                                           | Machine-readable output.                                                             |

Exit codes: `0` success, `1` delivery rejected or endpoint not verified, `2` usage error.

## Use it in your tests

The same engine is available as a library, so your test suite can produce signed webhooks
without hand-rolling HMACs.

```ts
import { webhook } from "@omoyolab/paylocal";
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

test("refuses a changed body, and a request with no signature", async () => {
  const charge = webhook("paystack", "charge.success");

  const forged = charge.tamper(secret);
  await request(app).post("/webhooks/paystack").set(forged.headers).send(forged.body).expect(401);

  const bare = charge.unsigned();
  await request(app).post("/webhooks/paystack").set(bare.headers).send(bare.body).expect(401);
});
```

A fixture has four methods:

| Method              | Gives you                                                         |
| ------------------- | ----------------------------------------------------------------- |
| `sign(secret)`      | The body and headers of a real delivery                           |
| `tamper(secret)`    | A signed request altered so that it must be refused               |
| `unsigned()`        | The body with no signature header                                 |
| `send(url, secret)` | Signs and POSTs to a running server, and resolves to the response |

`scenario()` returns the fixtures of a linked run, so a test can send them in any order:

```ts
import { scenario } from "@omoyolab/paylocal";

test("a refund that arrives before the payment still ends as refunded", async () => {
  const [charge, , , processed] = scenario("paystack", "refund", { reference: "ORD-1042" });

  await processed.send(url, secret);
  await charge.send(url, secret);

  expect(await orders.get("ORD-1042")).toMatchObject({ status: "refunded" });
});
```

Lower-level pieces are exported too: `buildEvent`, `buildScenario`, `signEvent`, `deliver`,
`verifyEndpoint`, `paystackSignature`, `providers`. Everything is typed.

## How the signatures work

| Provider    | Header                 | Scheme                                                     | Secret                               |
| ----------- | ---------------------- | ---------------------------------------------------------- | ------------------------------------ |
| Paystack    | `x-paystack-signature` | HMAC-SHA512 of the raw request body, hex encoded           | Your secret key (`sk_test_…`)        |
| Flutterwave | `verif-hash`           | Header must equal the secret hash you set in the dashboard | Secret hash from Settings → Webhooks |

paylocal signs the exact bytes it sends, so if your handler verifies the raw body (as it
should) the signature will match. If you parse the JSON first and re-serialize it, the
signature can stop matching, and the handler is what needs fixing.

Flutterwave v3 does not sign the body. `verify` still confirms your endpoint checks the
header, but treat every payload as a hint and confirm with the verify-transaction API
before fulfilling an order.

## Supported events

Run `paylocal events` for the live list. Currently:

**Paystack**: `charge.success`, `charge.dispute.create`, `transfer.success`,
`transfer.failed`, `transfer.reversed`, `subscription.create`, `subscription.disable`,
`subscription.not_renew`, `invoice.create`, `invoice.update`, `invoice.payment_failed`,
`refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`, `customeridentification.success`,
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
