'use client'

import { useGeneratedTranslations, useGeneratedValueTranslations } from '@/i18n/generated'
import { useMemo } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ListNavProvider, SearchInput as AppkitSearchInput } from '@braedonsaunders/appkit-ui'

/** Localized Next.js bridge for the shared, race-safe URL list search. */
export function SearchInput({
  placeholder = 'Search…',
  paramKey = 'q',
  pageParamKey = 'page',
  searchLabel = 'Search',
  className,
}: {
  placeholder?: string
  paramKey?: string
  /** Pagination param to reset when the search changes (sub-tables use prefixed params). */
  pageParamKey?: string
  searchLabel?: string
  className?: string
}) {
  const translate = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams().toString()
  const nav = useMemo(
    () => ({
      pathname,
      search,
      replace: (href: string) => router.replace(href, { scroll: false }),
      push: (href: string) => router.push(href, { scroll: false }),
    }),
    [pathname, router, search],
  )

  return (
    <ListNavProvider value={nav}>
      <AppkitSearchInput
        placeholder={translate(placeholder)}
        searchLabel={translate(searchLabel)}
        className={className}
        clearLabel={tGenerated('m_0465aaf099e62c')}
        paramKey={paramKey}
        pageParamKey={pageParamKey}
      />
    </ListNavProvider>
  )
}
