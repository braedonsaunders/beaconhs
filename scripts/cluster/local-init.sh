#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname postgres \
  -v app_password=beaconhs_app \
  -v super_password=beaconhs_super \
  -v migrator_password=beaconhs_migrator \
  -v backup_password=beaconhs_backup \
  -f /opt/beaconhs/provision.sql
