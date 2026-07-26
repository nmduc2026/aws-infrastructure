import { z } from 'zod'

export const createJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('simulate_work'),
    priority: z.enum(['normal', 'high', 'low']).optional(),
    payload: z.object({
      duration_seconds: z.number().int().min(1).max(60),
      failure_probability: z.number().min(0).max(1).optional(),
      failure_type: z.enum(['retryable', 'non_retryable']).optional(),
      notify: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('generate_report'),
    priority: z.enum(['normal', 'high', 'low']).optional(),
    payload: z.object({
      record_count: z.number().int().min(1).max(100_000),
      format: z.enum(['csv']).optional(),
      notify: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal('send_email'),
    priority: z.enum(['normal', 'high', 'low']).optional(),
    payload: z.object({
      to: z.string().email(),
      subject: z.string().optional(),
      body: z.string().optional(),
      notify: z.boolean().optional(),
    }),
  }),
])

export type CreateJobFormValues = z.infer<typeof createJobSchema>
