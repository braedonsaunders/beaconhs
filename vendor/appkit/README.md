# AppKit release artifacts

These tarballs are immutable package outputs built from AppKit. Reports uses
commit `1e69bf838abf348a66566176640cc44c98d4e638`; the remaining packages use release
commit `d955f747f05517bf5116e1a26792dfb0dde957f8`.

BeaconHS consumes the packages through normal package imports. The artifacts are
checked in only because the AppKit npm publisher was not authenticated when the
release was cut. The commit-qualified reports artifact includes the native
schedule-filter extension that BeaconHS consumes during its report cutover.
Replace the `file:` dependencies with registry versions after the same releases
are published; do not copy AppKit source into BeaconHS.
