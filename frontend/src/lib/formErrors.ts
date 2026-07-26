import type { FormInstance } from 'antd'

export function applyApiErrorsToForm(
  form: FormInstance,
  errors: Record<string, string[]>,
) {
  form.setFields(
    Object.entries(errors).map(([name, fieldErrors]) => ({
      name: name.includes('.') ? name.split('.') : name,
      errors: fieldErrors,
    })),
  )
}
