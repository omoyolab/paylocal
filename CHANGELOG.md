# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-01

Everything here came from building a real application on 0.1.0: the
[shop use case](https://github.com/omoyolab/paylocal-usecases), which lists each finding.

### Added

- `paylocal scenario <provider> <name>` sends the linked notices of one transaction: a
  payment, then its refund or dispute, sharing one reference, amount, customer and ids.
  `--reverse` sends them last to first and `--twice` sends each one two times.
  `paylocal scenarios` lists them. In a test suite, `scenario()` returns the fixtures (#10).
- Fixtures from `webhook()` have `tamper(secret)`, `unsigned()` and `send(url, secret)` (#9).
- `paylocal replay last` sends the newest delivery in the log again (#11).
- Paystack `refund.processing` (#12).
- `VerifyResult.probes` lists every forged request `verify` sent and what the endpoint did.

### Changed

- `verify` sends a request with no signature and one signed with a different secret, as
  well as the changed body. An endpoint that answers a forged request with a 5xx is
  reported as not verified. An endpoint that passed 0.1.0 can fail now, and the report
  says which request it mishandled (#8).

### Fixed

- `--reference`, `--amount`, `--email` and `--currency` set the field each event keeps
  the value in. On a refund, a dispute, an invoice and a Flutterwave transfer or refund
  they used to add a field the provider never sends and leave the real one random.
  Where an event has no such field the command now fails and says so (#7).
- The help said `--amount` is in kobo. For Flutterwave it is in naira (#13).


## [0.1.0] - 2026-09-29

### Added

- `paylocal trigger` sends a realistic, correctly signed Paystack or Flutterwave event to any URL.
- `--set path=value` overrides for any payload field, plus `--amount`, `--email`, `--reference` and `--currency` shortcuts.
- `paylocal replay` resends a logged delivery or a saved payload file with a fresh signature.
- `paylocal verify` proves an endpoint rejects tampered requests.
- `paylocal events` and `paylocal log` for discovery and history.
- Delivery log in `.paylocal/events/`.
- Library API: `webhook()`, `buildEvent()`, `signEvent()`, `deliver()`, `verifyEndpoint()`.
- 20 Paystack events and 4 Flutterwave (v3) events.
- Dependency-free example receiver in `examples/server.mjs`.

[Unreleased]: https://github.com/omoyolab/paylocal/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/omoyolab/paylocal/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/omoyolab/paylocal/releases/tag/v0.1.0
