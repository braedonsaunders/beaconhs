import { PageContainer } from '@/components/page-layout'
import { RecordsSkeleton } from '@/components/records-skeleton'

export default function Loading() {
  return (
    <PageContainer>
      <RecordsSkeleton cols={5} />
    </PageContainer>
  )
}
