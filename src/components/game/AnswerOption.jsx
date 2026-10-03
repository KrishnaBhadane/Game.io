export default function AnswerOption({ letter, children, selected, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`answer ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="answer-letter">{letter}</span>
      <span>{children}</span>
      <span className="answer-mark" aria-hidden="true">
        {selected ? '✓' : ''}
      </span>
    </button>
  )
}
