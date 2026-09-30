# Security Policy

## Reporting a vulnerability

If you find a security issue in paylocal, please do not open a public issue.

Use GitHub's private reporting form:
https://github.com/omoyolab/paylocal/security/advisories/new

Or email **xanderabim@gmail.com** with "paylocal security" in the subject.

You will get an acknowledgement within 72 hours and a fix or a plan within 14 days for
confirmed issues. Credit is given in the release notes unless you prefer otherwise.

## Scope

paylocal is a local development tool. It sends requests to URLs you specify with secrets
you provide. Things that count as vulnerabilities:

- Secrets leaking into logs, the delivery log, or CLI output beyond what is documented.
- Signature generation that does not match the provider's documented scheme, since that
  could lead someone to ship a handler that is wrong.
- Anything that lets a payload file or CLI argument execute code.

Things that are out of scope:

- The security of your own webhook handler. `paylocal verify` helps you check it, but the
  handler is yours.
- Paystack or Flutterwave's APIs. Report those to the providers.

## Supported versions

Only the latest minor release receives security fixes.
