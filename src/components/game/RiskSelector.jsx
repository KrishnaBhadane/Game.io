import { RISK_OPTIONS } from '../../data/constants'

export default function RiskSelector({ value, onChange, multiple = false, options, disabled = false }) {
  const items = options || RISK_OPTIONS
  return (
    <div
      className="risk-options"
      role="group"
      aria-label={multiple ? 'Allowed multipliers' : 'Choose your risk'}
    >
      {items.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          aria-pressed={multiple ? value.includes(option) : value === option}
          onClick={() => !disabled && onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

