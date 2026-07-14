#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
result="$(jq -n '[
  {
    ID:"service-web",
    Spec:{Name:"beaconhs_web",Labels:{
      "com.docker.stack.namespace":"beaconhs",
      "traefik.http.routers.web.rule":"Host(`DEV.EXAMPLE.COM.`)"
    }}
  },
  {
    ID:"service-collabora",
    Spec:{Name:"beaconhs_collabora",Labels:{
      "com.docker.stack.namespace":"beaconhs",
      "traefik.http.routers.collabora.rule":
        "Host(`dev.example.com`, `alias.example.com`) && PathPrefix(`/browser`)"
    }}
  },
  {
    ID:"service-exact",
    Spec:{Name:"beaconhs_exact",Labels:{
      "com.docker.stack.namespace":"beaconhs",
      "traefik.http.routers.exact.rule":
        "Host(`dev.example.com`) && Path(`/health`)"
    }}
  },
  {
    ID:"service-regexp",
    Spec:{Name:"other_regexp",Labels:{
      "com.docker.stack.namespace":"other",
      "traefik.http.routers.regexp.rule":"HostRegexp(`{subdomain:.+}.example.com`)"
    }}
  },
  {
    ID:"service-or",
    Spec:{Name:"other_or",Labels:{
      "com.docker.stack.namespace":"other",
      "traefik.http.routers.or.rule":
        "Host(`dev.example.com`) || Host(`other.example.com`)"
    }}
  },
  {
    ID:"service-encoded-path",
    Spec:{Name:"other_encoded",Labels:{
      "com.docker.stack.namespace":"other",
      "traefik.http.routers.encoded.rule":
        "Host(`dev.example.com`) && PathPrefix(`/bad%2fpath`)"
    }}
  },
  {
    ID:"service-unknown-matcher",
    Spec:{Name:"other_headers",Labels:{
      "com.docker.stack.namespace":"other",
      "traefik.http.routers.headers.rule":
        "Host(`dev.example.com`) && Headers(`X-Beacon`, `true`)"
    }}
  }
]' | jq -c -f "${script_dir}/traefik-routes.jq")"

jq -e '
  (.routes | length) == 4
    and any(.routes[];
      .serviceId == "service-web" and .host == "dev.example.com"
        and .path == "/" and .pathKind == "prefix")
    and ([.routes[]
      | select(.serviceId == "service-collabora")
      | .host] | sort) == ["alias.example.com", "dev.example.com"]
    and any(.routes[];
      .serviceId == "service-exact" and .path == "/health"
        and .pathKind == "exact")
    and ([.unsupported[] | {id:.serviceId, reason}] | sort_by(.id)) == ([
      {id:"service-encoded-path", reason:"unsupported-path-matcher"},
      {id:"service-or", reason:"unsupported-boolean-expression"},
      {id:"service-regexp", reason:"unsupported-host-matcher"},
      {id:"service-unknown-matcher", reason:"unsupported-rule-matcher"}
    ] | sort_by(.id))
' <<< "$result" >/dev/null

echo 'PASS Traefik route extraction and fail-closed matcher classification'
