import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so navigating into the type builder doesn't
// inherit the register table/card skeleton from /ppe/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
