import { Tag } from 'antd'
import { STATUS_COLOR, STATUS_LABEL } from '../../theme'
import type { JobStatus } from '../../types/job'

export function JobStatusTag({ status }: { status: JobStatus }) {
  return <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>
}
