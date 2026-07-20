// Form validation messages. Mirror these where Zod schemas surface messages so client
// validation reads in the active locale.
export default {
  required: '此字段必填',
  requiredField: '{field}为必填项',
  email: '请输入有效的电子邮箱地址',
  min: '不得小于 {min}',
  max: '不得大于 {max}',
  minLength: '至少需要 {min} 个字符',
  maxLength: '最多不超过 {max} 个字符',
  positive: '必须大于零',
  number: '请输入有效的数字',
  decimal: '请输入有效的金额',
  invalid: '无效的值',
} as const;
