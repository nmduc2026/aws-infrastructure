import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../../lib/api'
import { TERMINAL_STATUSES } from '../../../theme'
import type {
  CreateJobBody,
  JobDetail,
  JobFilters,
  JobStatus,
} from '../../../types/job'

export function useJobs(filters: JobFilters = {}, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () => api.jobs(filters),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => {
      const jobs = query.state.data?.data ?? []
      const active = jobs.some((job) => !TERMINAL_STATUSES.includes(job.status))
      return active ? 3_000 : false
    },
  })
}

export function useJob(ulid: string) {
  return useQuery({
    queryKey: ['job', ulid],
    queryFn: () => api.job(ulid),
    enabled: Boolean(ulid),
    refetchInterval: (query) => {
      const job = query.state.data
      if (!job) return 2_000
      return TERMINAL_STATUSES.includes(job.status) ? false : 2_000
    },
  })
}

export function useCreateJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: CreateJobBody) => api.createJob(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
    },
  })
}

export function useCancelJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.cancelJob,
    onMutate: async (ulid) => {
      await queryClient.cancelQueries({ queryKey: ['job', ulid] })
      const previous = queryClient.getQueryData<JobDetail>(['job', ulid])
      queryClient.setQueryData<JobDetail>(['job', ulid], (old) =>
        old
          ? {
              ...old,
              status: 'cancelling' as JobStatus,
              cancel_requested: true,
            }
          : old,
      )
      return { previous }
    },
    onError: (_error, ulid, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['job', ulid], context.previous)
      }
    },
    onSettled: (_data, _error, ulid) => {
      void queryClient.invalidateQueries({ queryKey: ['job', ulid] })
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
    },
  })
}

export function useRetryJob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.retryJob,
    onSuccess: (_data, ulid) => {
      void queryClient.invalidateQueries({ queryKey: ['job', ulid] })
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
    },
  })
}

export function useSummary() {
  return useQuery({
    queryKey: ['summary'],
    queryFn: api.summary,
    refetchInterval: 5_000,
  })
}

export function useLoadTest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: api.loadTest,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
    },
  })
}
