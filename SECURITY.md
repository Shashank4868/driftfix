# Security

Driftfix runs on your machine or in your CI. The CLI does not send source code anywhere: scanning, rewriting and verification all happen locally, and the only network calls are the ones you ask for (`git push` and `gh pr create` with `--open-pr`, and your package manager when it refreshes a lockfile).

The website playground runs the browser port of the rules (`site/engine.js`) entirely in the page. Code you paste there never leaves the browser. Scanning a public GitHub repo fetches its files from GitHub's public API directly from your browser.

Verification runs the target repository's own test suite (`pytest` or `npm test`). Only run Driftfix on code you would run yourself.

## Reporting a vulnerability

Please report security problems privately through GitHub's [private vulnerability reporting](https://github.com/Shashank4868/driftfix/security/advisories/new) rather than a public issue. You will get a reply within three working days.
