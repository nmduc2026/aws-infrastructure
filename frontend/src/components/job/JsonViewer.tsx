import { CopyOutlined } from '@ant-design/icons'
import { App, Button } from 'antd'
import { formatJson } from '../../lib/format'

export function JsonViewer({ value }: { value: unknown }) {
  const { message } = App.useApp()
  const text = formatJson(value)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      message.success('Đã sao chép')
    } catch {
      message.error('Không sao chép được')
    }
  }

  return (
    <div className="json-viewer">
      {value != null && (
        <Button
          className="json-viewer__copy"
          type="text"
          size="small"
          icon={<CopyOutlined />}
          onClick={() => void copy()}
        >
          Copy
        </Button>
      )}
      <pre>{text}</pre>
    </div>
  )
}
