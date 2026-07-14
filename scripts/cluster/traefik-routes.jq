def literal_calls($name):
  [scan(
    "(^|[^A-Za-z0-9_])" +
      $name +
      "\\s*\\(\\s*((?:`[^`]*`|\"[^\"]*\")(?:\\s*,\\s*(?:`[^`]*`|\"[^\"]*\"))*)\\s*\\)"
  )
  | .[1]
  | scan("(?:`([^`]*)`|\"([^\"]*)\")")
  | map(select(. != null))[0]
  | select(length > 0)];

def has_call($name):
  test("(^|[^A-Za-z0-9_])" + $name + "\\s*\\(");

def auditable_path:
  startswith("/") and
    (test("[%\\\\]|//|(^|/)\\.\\.?(/|$)|[\\x00-\\x1F\\x7F]") | not);

[
  .[] as $service
  | ($service.Spec.Labels // {}) as $labels
  | $labels
  | to_entries[]
  | select(
      (.key | test("^traefik\\.http\\.routers\\..+\\.rule$")) and
        (.value | type) == "string"
    )
  | . as $entry
  | ($entry.value | literal_calls("Host") | map(ascii_downcase | rtrimstr("."))) as $hosts
  | ($entry.value | literal_calls("PathPrefix")) as $prefixes
  | ($entry.value | literal_calls("Path")) as $paths
  | ($entry.value | gsub("`[^`]*`|\"[^\"]*\""; "\"\"")) as $structure
  | ([$structure | scan("(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9]*)\\s*\\(") | .[1]]
      | map(select(. != "Host" and . != "PathPrefix" and . != "Path"))) as $unknownMatchers
  | {
      serviceId: $service.ID,
      serviceName: $service.Spec.Name,
      stack: ($labels["com.docker.stack.namespace"] // ""),
      router: $entry.key,
      rule: $entry.value,
      labels: $labels,
      hosts: $hosts,
      prefixes: $prefixes,
      paths: $paths,
      unsupportedHost: (
        ($entry.value | has_call("HostRegexp")) or
          ($hosts | length) == 0
      ),
      unsupportedPath: (
        ($entry.value | has_call("PathRegexp")) or
          (($entry.value | has_call("PathPrefix")) and ($prefixes | length) == 0) or
          (($entry.value | has_call("Path")) and ($paths | length) == 0) or
          any(($prefixes + $paths)[]; auditable_path | not)
      ),
      unsupportedBoolean: ($structure | test("!|\\|\\|")),
      unsupportedRule: (($structure | test("!|\\|\\|")) or ($unknownMatchers | length) > 0)
    }
]
| {
    unsupported: [
      .[]
      | select(.unsupportedHost or .unsupportedPath or .unsupportedRule)
      | {
          serviceId,
          serviceName,
          stack,
          router,
          hosts,
          reason: (
            if .unsupportedHost and .unsupportedPath then
              "unsupported-host-and-path-matcher"
            elif .unsupportedHost then
              "unsupported-host-matcher"
            elif .unsupportedPath then
              "unsupported-path-matcher"
            elif .unsupportedBoolean then
              "unsupported-boolean-expression"
            else
              "unsupported-rule-matcher"
            end
          )
        }
    ],
    routes: [
      .[]
      | select((.unsupportedHost or .unsupportedPath or .unsupportedRule) | not)
      | . as $router
      | (
          if (($router.prefixes | length) + ($router.paths | length)) == 0 then
            [{ path: "/", pathKind: "prefix" }]
          else
            ([$router.prefixes[] | { path: ., pathKind: "prefix" }] +
              [$router.paths[] | { path: ., pathKind: "exact" }])
          end
        )[] as $matcher
      | $router.hosts[] as $host
      | {
          serviceId: $router.serviceId,
          serviceName: $router.serviceName,
          stack: $router.stack,
          router: $router.router,
          host: $host,
          path: $matcher.path,
          pathKind: $matcher.pathKind,
          rule: $router.rule,
          labels: $router.labels
        }
    ]
  }
| .routes |= sort_by(.serviceId, .router, .host, .path, .pathKind)
| .unsupported |= sort_by(.serviceId, .router)
