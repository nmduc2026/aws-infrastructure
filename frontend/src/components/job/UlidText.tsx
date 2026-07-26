import { Typography } from 'antd'

export function UlidText({ value }: { value: string }) {
  return (
    <Typography.Text code copyable={{ text: value }}>
      {value.slice(0, 8)}…
    </Typography.Text>
  )
}
