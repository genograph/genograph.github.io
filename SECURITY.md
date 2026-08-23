# Security policy

Genograph stores family information, so privacy and local-only operation are
part of its security boundary rather than optional features.

## Supported versions

Security fixes are released for the latest published version only. Before
reporting a problem, reproduce it with the current npm release or `main`.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's
[private vulnerability reporting](https://github.com/genograph/genograph.github.io/security/advisories/new)
instead.

Include the affected version, operating system and browser or Node.js version,
plus the smallest reproduction you can provide. Do not attach a real family
tree or personal information about living people; use invented, anonymized data.

You should receive an acknowledgement within seven days. A validated report
will be kept private until a fix is available and affected users can update.

## Security assumptions

- The local server must remain bound to a loopback address.
- Other websites and localhost origins are untrusted. Native processes already
  running as the same operating-system user are inside the local trust boundary.
- Tree files and browser storage should be protected like other sensitive local
  documents. Genograph does not encrypt the device or a synced folder.
- A folder synchronized by another service is governed by that provider's
  security and privacy controls.
- Exported JSON contains the recorded family information in plain text.
