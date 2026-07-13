# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-13

### Added

- `defineJob({ name, schema, handler, options? })` — declare jobs in your own
  code with payload types inferred from the schema.
- `createQueueClient({ redis, jobs, defaults?, logger? })` — one type-safe
  client for both producing (`enqueue`, `bulkEnqueue`, `schedule`,
  `scheduleOnce`, `unschedule`) and consuming (`startWorkers`).
- Process-time payload validation via each job's `schema.parse()` before the
  handler runs.
- Explicit Redis config (`{ host, … }` or `{ url }`); opt-in `connectionFromEnv()`
  that throws rather than exiting the process.
- Pluggable `Logger` interface with a console default and `logger: false` to
  silence the library.
- Optional Bull Board dashboard via the `@alegrossi2001/bullshoot/dashboard`
  subpath, lazily loaded.
- Dual ESM + CJS builds with type declarations.
