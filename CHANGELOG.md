# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/omoyolab/paylocal/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/omoyolab/paylocal/releases/tag/v0.1.0
