// Form validation messages. Mirror these where Zod schemas surface messages so client
// validation reads in the active locale.
export default {
  required: 'This field is required',
  requiredField: '{field} is required',
  email: 'Enter a valid email address',
  min: 'Must be at least {min}',
  max: 'Must be at most {max}',
  minLength: 'Must be at least {min} characters',
  maxLength: 'Must be at most {max} characters',
  positive: 'Must be greater than zero',
  number: 'Enter a valid number',
  decimal: 'Enter a valid amount',
  invalid: 'Invalid value',
} as const;
