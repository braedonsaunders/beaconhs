import { GeneratedText } from '@/i18n/generated'
import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { Button } from '@beaconhs/ui'

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <SearchX aria-hidden="true" size={24} />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-slate-950 dark:text-white">
          <GeneratedText id="m_1e22c2e76193a6" />
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          <GeneratedText id="m_056f3df5f50ed4" />
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link href="/dashboard">
              <GeneratedText id="m_132d746a8ad9a0" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/help">
              <GeneratedText id="m_05243213c79f67" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
