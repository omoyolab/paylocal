# Examples

## `server.mjs`

A dependency-free webhook receiver that verifies Paystack and Flutterwave deliveries the
way the providers document it. Use it to see paylocal work in under a minute, or copy the
verification functions into your own app.

```sh
# terminal 1
node examples/server.mjs

# terminal 2
npx @omoyolab/paylocal trigger paystack charge.success --to http://localhost:3000/webhooks/paystack --secret sk_test_123
npx @omoyolab/paylocal verify paystack --to http://localhost:3000/webhooks/paystack --secret sk_test_123
```

The defaults are `sk_test_123` for Paystack and `my-hash` for Flutterwave. Override them
with `PAYSTACK_SECRET_KEY` and `FLUTTERWAVE_SECRET_HASH`.
