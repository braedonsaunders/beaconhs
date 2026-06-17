import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so navigating into a record doesn't inherit the
// list table/card skeleton from /corrective-actions/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
