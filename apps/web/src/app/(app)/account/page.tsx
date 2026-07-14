import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from '@beaconhs/ui'
import { getAuth } from '@beaconhs/auth'
import { db, withSuperAdmin } from '@beaconhs/db'
import { attachments, people, users } from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { ProfileForm } from './_profile-form'
import { PasswordSection } from './_password-section'
import { SignatureSection } from './_signature-section'

export const metadata = { title: 'Account' }
export const dynamic = 'force-dynamic'

export default async function AccountPage() {
  const ctx = await requireRequestContext()
  const t = await getTranslations('Account')

  // `users` is global (not tenant-scoped) — read on the super pool, like every
  // other identity read in getRequestContext / the platform user surfaces.
  const [account] = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        name: users.name,
        email: users.email,
        timezone: users.timezone,
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
          .select({ id: attachments.id })
          .from(people)
          .leftJoin(attachments, eq(attachments.id, people.signatureAttachmentId))
          .where(eq(people.id, ctx.personId!))
          .limit(1)
        return row ?? null
      })
    : null
  const signatureUrl = signatureRow?.id ? attachmentUrl(signatureRow.id) : null

  // Does this account have a password credential, or is it magic-link only?
  // Drives whether the Password card shows "change" vs "set a password".
  let hasPassword = false
  try {
    const accounts = await getAuth().api.listUserAccounts({
      headers: (await headers()) as unknown as Headers,
    })
    hasPassword = Array.isArray(accounts) && accounts.some((a) => a.providerId === 'credential')
  } catch {
    hasPassword = false
  }

  return (
    <PageContainer>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader title={t('title')} description={t('description')} />

        <Card>
          <CardHeader>
            <CardTitle>{t('profile')}</CardTitle>
            <CardDescription>{t('profileDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              name={account.name}
              email={account.email}
              timezone={account.timezone}
              localeOverride={ctx.localeOverride}
              defaultLocale={ctx.defaultLocale}
              enabledLocales={ctx.enabledLocales}
              canOverrideLocale={ctx.membership !== null}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('signature')}</CardTitle>
            <CardDescription>{t('signatureDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <SignatureSection currentUrl={signatureUrl} linked={ctx.personId != null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('password')}</CardTitle>
            <CardDescription>
              {hasPassword ? t('passwordChangeDescription') : t('passwordAddDescription')}
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
