import { useEffect, useState } from 'react'
import Button from '../common/Button'
import Input from '../common/Input'
import {
  deleteQuestion,
  getQuestions,
  saveQuestion,
} from '../../services/questionService'

const emptyQuestion = {
  question_text: '',
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_option: 'A',
  order_number: '',
  time_limit_seconds: 30,
}

export default function QuestionBank({ gameId, currentQuestionId, onPublish, refreshKey }) {
  const [questions, setQuestions] = useState([])
  const [editing, setEditing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadQuestions() {
    setLoading(true)
    setError('')
    try {
      setQuestions(await getQuestions(gameId))
    } catch (err) {
      setError(err.message || 'Could not load questions.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQuestions()
  }, [gameId, refreshKey])

  function startAdd() {
    setError('')
    setEditing({ ...emptyQuestion, order_number: questions.length + 1 })
  }

  async function submit(event) {
    event.preventDefault()
    if (saving) return

    const data = new FormData(event.currentTarget)
    const next = {
      ...editing,
      question_text: String(data.get('question_text') || '').trim(),
      option_a: String(data.get('option_a') || '').trim(),
      option_b: String(data.get('option_b') || '').trim(),
      option_c: String(data.get('option_c') || '').trim(),
      option_d: String(data.get('option_d') || '').trim(),
      correct_option: data.get('correct_option'),
      order_number: Number(data.get('order_number')),
      time_limit_seconds: Number(data.get('time_limit_seconds') || 30),
    }

    if (
      !next.question_text ||
      !next.option_a ||
      !next.option_b ||
      !next.option_c ||
      !next.option_d
    ) {
      setError('Complete the question and all four options.')
      return
    }
    if (!Number.isInteger(next.order_number) || next.order_number < 1) {
      setError('Question number must be a positive whole number.')
      return
    }
    if (!Number.isInteger(next.time_limit_seconds) || next.time_limit_seconds < 1) {
      setError('Timer must be a positive number of seconds.')
      return
    }
    if (
      questions.some(
        (question) =>
          question.order_number === next.order_number &&
          question.id !== next.id,
      )
    ) {
      setError('That question number is already used.')
      return
    }

    setSaving(true)
    setError('')
    try {
      const saved = await saveQuestion(gameId, next)
      setQuestions((current) =>
        [...current.filter((question) => question.id !== saved.id), saved].sort(
          (a, b) => a.order_number - b.order_number,
        ),
      )
      setEditing(null)
    } catch (err) {
      setError(err.message || 'Could not save question.')
    } finally {
      setSaving(false)
    }
  }

  async function remove(question) {
    if (!window.confirm(`Delete question ${question.order_number}?`)) return
    setError('')
    try {
      await deleteQuestion(question.id)
      setQuestions((current) =>
        current.filter((item) => item.id !== question.id),
      )
    } catch (err) {
      setError(err.message || 'Could not delete question.')
    }
  }

  return (
    <section className="question-bank">
      <div className="section-heading">
        <h2>Question Bank</h2>
        {!editing && <Button onClick={startAdd}>Add Question</Button>}
      </div>
      {editing && (
        <form className="question-form" onSubmit={submit}>
          <Input
            label="Question"
            name="question_text"
            defaultValue={editing.question_text}
            required
            disabled={saving}
          />
          <div className="question-options">
            {['a', 'b', 'c', 'd'].map((option) => (
              <Input
                key={option}
                label={`Option ${option.toUpperCase()}`}
                name={`option_${option}`}
                defaultValue={editing[`option_${option}`]}
                required
                disabled={saving}
              />
            ))}
          </div>
          <div className="question-meta">
            <Input
              label="Question Number"
              name="order_number"
              type="number"
              min="1"
              step="1"
              defaultValue={editing.order_number}
              required
              disabled={saving}
            />
            <Input
              label="Timer (seconds)"
              name="time_limit_seconds"
              type="number"
              min="5"
              step="1"
              defaultValue={editing.time_limit_seconds || 30}
              required
              disabled={saving}
            />
            <div className="field">
              <label htmlFor="correct-option">Correct Option</label>
              <select
                id="correct-option"
                name="correct_option"
                defaultValue={editing.correct_option}
                disabled={saving}
              >
                {['A', 'B', 'C', 'D'].map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="question-form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Question'}
            </Button>
            <Button
              type="button"
              variant="quiet"
              disabled={saving}
              onClick={() => {
                setEditing(null)
                setError('')
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {loading ? (
        <p className="fine-print">Loading questions…</p>
      ) : !questions.length && !editing ? (
        <p className="fine-print">No questions yet.</p>
      ) : (
        <ol className="question-list">
          {questions.map((question) => {
            const isLive = question.id === currentQuestionId
            return (
              <li key={question.id} className={isLive ? 'is-live' : ''}>
                <span>{question.order_number}</span>
                <p>
                  {question.question_text}{' '}
                  <span className="muted">({question.time_limit_seconds || 30}s)</span>
                </p>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setEditing(question)
                    setError('')
                  }}
                >
                  Edit
                </Button>
                <Button variant="quiet" onClick={() => remove(question)}>
                  Delete
                </Button>
                {onPublish && (
                  <Button
                    variant="quiet"
                    onClick={() => onPublish(question.id)}
                  >
                    {isLive ? '● Live' : 'Publish'}
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

