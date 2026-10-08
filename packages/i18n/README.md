# Translation payloads

Canonical English, French and Spanish catalogues remain in `src/messages` and
are available to server rendering. The web root passes a projection of active
UI copy to the client provider; long user-guide bodies translate on the server
before reaching the Markdown renderer.

When adding or removing system copy, update the canonical catalogues and run:

```sh
pnpm --filter @beaconhs/web i18n:client-messages
```

This regenerates `apps/web/src/i18n/client-message-keys.ts`. The web tests verify
that it matches current app/package source and preserves translations in all
three locales. The manifest stores keys only, not duplicate translations.

Keep heavy features out of shared client entry points. Import the rich-text
editor from `@beaconhs/ui/rich-text-editor`, and browser feedback helpers from
`@braedonsaunders/appkit-feedback/client`. The feedback dialog loads on its first
click; model tools remain on the server. Motion remains part of the UI primitives
that use it.
