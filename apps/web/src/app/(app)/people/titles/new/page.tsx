import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import Link from 'next/link'
import { Button, Card, CardContent, DetailHeader, Input, Label, Textarea } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { createTitle } from '../../_actions/titles'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_117a29899c38bd') }
}
export const dynamic = 'force-dynamic'

export default async function NewTitlePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  await requireModuleManage('people')
  const sp = await searchParams
  const errorMessage = typeof sp.error === 'string' ? sp.error : null
  return (
    <PageContainer>
      <div className="max-w-3xl space-y-5">
        <DetailHeader
          back={{ href: '/people/titles', label: 'Back to titles' }}
          title={tGenerated('m_117a29899c38bd')}
          subtitle={tGenerated('m_1cbaab908f392f')}
        />
        <GeneratedValue
          value={
            errorMessage ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                <GeneratedValue value={errorMessage} />
              </p>
            ) : null
          }
        />
        <Card>
          <CardContent className="pt-6">
            <form action={createTitle} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  <GeneratedText id="m_1a9978900838e6" />
                </Label>
                <Input
                  id="name"
                  name="name"
                  required
                  placeholder={tGenerated('m_0bad1166a9ff81')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">
                  <GeneratedText id="m_1f10a46fc1db73" />
                </Label>
                <Textarea
                  id="description"
                  name="description"
                  rows={3}
                  placeholder={tGenerated('m_00ea9be6ad062b')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="responsibilities">
                  <GeneratedText id="m_10db3552a638bc" />
                </Label>
                <Textarea
                  id="responsibilities"
                  name="responsibilities"
                  rows={6}
                  placeholder={tGenerated('m_0155894e522f13')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="education">
                  <GeneratedText id="m_01f50b9a132c18" />
                </Label>
                <Textarea
                  id="education"
                  name="education"
                  rows={3}
                  placeholder={tGenerated('m_05987f7cde9f44')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="experience">
                  <GeneratedText id="m_054359abce46c6" />
                </Label>
                <Textarea
                  id="experience"
                  name="experience"
                  rows={3}
                  placeholder={tGenerated('m_0570b667b552c7')}
                />
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Link href="/people/titles">
                  <Button type="button" variant="outline">
                    <GeneratedText id="m_112e2e8ecda428" />
                  </Button>
                </Link>
                <Button type="submit">
                  <GeneratedText id="m_1e885ac43433bc" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
