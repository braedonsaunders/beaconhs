const value = process.env.DEV_SUPERADMIN_DATABASE_URL
if (!value) throw new Error('DEV_SUPERADMIN_DATABASE_URL is required')

let url
try {
  url = new URL(value)
} catch {
  throw new Error('DEV_SUPERADMIN_DATABASE_URL is not a valid URL')
}
if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
  throw new Error('DEV_SUPERADMIN_DATABASE_URL must be a PostgreSQL URL')
}

url.port = '5432'
process.stdout.write(url.toString())
