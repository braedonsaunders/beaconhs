import 'dotenv/config'
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://beaconhs:beaconhs@localhost:5432/beaconhs',
  },
  strict: true,
  verbose: true,
} satisfies Config
