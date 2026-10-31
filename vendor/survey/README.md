# Survey provider build

This directory contains the compiled `@gcs-ssc/survey` provider shared by the connector and the sibling Portal. Its source lives in the separately maintained `GCS-SSC/survey` repository. The build supports form schema versions 1–5, including designer answer rules in version 5. Archived and published definitions retain their original version.

After provider changes, run its tests, typecheck and build, copy the generated `dist/` into both applications, refresh their installed local package, and run each owning application’s checks. Keep both applications on the same provider build.

## Currency-aware build 0.4.0-gcs-portal.1

The clean currency cutover is rebuilt from survey source commit `7021ab6d192539b0dabc5dd4f9a72f24039823c3` plus [the retained source/test patch](patches/currency-money.patch). The original source checkout and the sibling Portal were not modified. Runtime files other than `grants.js` and `grant-fields.js` remain byte-identical; generated declarations reflect the expanded settlement-currency catalog.

Grant money drafts remain human decimal text. Validation, percentage calculations and totals construct currency-bearing minor-unit Money through the shared public SDK, which uses Dinero. JPY whole units, KWD thousandths, CLF ten-thousandths and MGA fifths are supported; fractional minor units and XDR (no settlement subdivision) are rejected. Calculated percentage charges retain their explicit whole-major-unit half-away-from-zero rounding. Normalized human decimal strings omit insignificant zeroes. The cents-only `moneyCents`/`centsText` exports are removed, with no compatibility aliases.

To reproduce, use a disposable copy of that source commit, apply `patch -p1 < currency-money.patch`, resolve the declared SDK/Zod/Vue dependencies, then run `bun run typecheck`, `bun run test` and `bun run build`. Copy its `dist/` into this directory. The local verification copy used the installed toolchain, an explicit Vitest test include (`tests/**/*.test.ts`) to avoid the enclosing host repository's test configuration, and passed all nine provider test files (122 tests), typechecking and build. Update the sibling Portal to this provider build when adopting the new money wire contract.
