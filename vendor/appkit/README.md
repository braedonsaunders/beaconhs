# AppKit release artifacts

These tarballs are immutable package outputs built from AppKit. Reports uses
commit `6f32016`; the remaining packages use release
commit `d955f747f05517bf5116e1a26792dfb0dde957f8`.

BeaconHS consumes the packages through normal package imports. The artifacts are
checked in only because the AppKit npm publisher was not authenticated when the
release was cut. The commit-qualified reports artifact includes the native
schedule-filter extension plus searchable filter-value pickers and a
paper-matched PDF document renderer that BeaconHS consumes during its report
cutover. Replace the `file:` dependencies with registry versions after the same
releases are published; do not copy AppKit source into BeaconHS.
