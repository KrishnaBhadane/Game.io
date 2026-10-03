import { useId } from 'react'

export default function Input({ label, hint, error, id, ...props }) {
  const generatedId = useId()
  const inputId = id || generatedId
  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${inputId}-hint` : undefined}
        {...props}
      />
      {(error || hint) && (
        <p
          id={`${inputId}-hint`}
          className={error ? 'field-error' : 'field-hint'}
        >
          {error || hint}
        </p>
      )}
    </div>
  )
}
