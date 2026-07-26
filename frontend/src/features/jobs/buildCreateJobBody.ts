import type { CreateJobBody, JobType } from '../../types/job'

type FormValues = {
  type: JobType
  priority?: CreateJobBody['priority']
  payload: Record<string, unknown>
}

export function buildCreateJobBody(values: FormValues): CreateJobBody {
  const { type, priority = 'normal', payload } = values
  const notify = payload.notify ?? true

  switch (type) {
    case 'simulate_work':
      return {
        type,
        priority,
        payload: {
          duration_seconds: payload.duration_seconds,
          failure_probability: payload.failure_probability ?? 0,
          failure_type: payload.failure_type ?? 'retryable',
          notify,
        },
      }
    case 'generate_report':
      return {
        type,
        priority,
        payload: {
          record_count: payload.record_count,
          format: payload.format ?? 'csv',
          notify,
        },
      }
    case 'send_email':
      return {
        type,
        priority,
        payload: {
          to: payload.to,
          subject: payload.subject,
          body: payload.body ?? '',
          notify,
        },
      }
  }
}
