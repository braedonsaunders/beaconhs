import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@beaconhs/ui'
import { auth } from '@beaconhs/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { attachments, people, users } from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { ProfileForm } from './_profile-form'
import { PasswordSection } from './_password-section'
import { SignatureSection } from './_signature-section'

export const metadata = { title: 'Account' }
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const ctx = await requireRequestContext()

  // `users` is global (not tenant-scoped) — read on the super pool, like every
  // other identity read in getRequestContext / the platform user surfaces.
  const [account] = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        name: users.name,
        email: users.email,
        timezone: users.timezone,
        locale: users.locale,
      })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1),
  )
  if (!account) return null

  // The signature lives on the linked person record. Read it (tenant-scoped) so
  // the account page can show the current one and let the user redraw it.
  const signatureRow = ctx.personId
    ? await ctx.db(async (tx) => {
        const [row] = await tx
          .select({ r2Key: attachments.r2Key })
          .from(people)
          .leftJoin(attachments, eq(attachments.id, people.signatureAttachmentId))
          .where(eq(people.id, ctx.personId!))
          .limit(1)
        return row ?? null
      })
    : null
  const signatureUrl = signatureRow?.r2Key ? publicUrl(signatureRow.r2Key) : null

  // Does this account have a password credential, or is it magic-link only?
  // Drives whether the Password card shows "change" vs "set a password".
  let hasPassword = false
  try {
    const accounts = await auth.api.listUserAccounts({
      headers: (await headers()) as unknown as Headers,
    })
    hasPassword = Array.isArray(accounts) && accounts.some((a) => a.providerId === 'credential')
  } catch {
    hasPassword = false
  }

  return (
    <PageContainer>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader title="Account" description="Manage your profile, time zone, and password." />

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Your name, language, and the time zone used for dates across the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              name={account.name}
              email={account.email}
              timezone={account.timezone}
              locale={account.locale}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Signature</CardTitle>
            <CardDescription>
              Draw the signature used when you sign off forms, inspections, and lift plans.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignatureSection currentUrl={signatureUrl} linked={ctx.personId != null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>
              {hasPassword
                ? 'Change the password you use to sign in.'
                : 'Add a password so you can sign in with your email as well as magic links.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordSection hasPassword={hasPassword} />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
