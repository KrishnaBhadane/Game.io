import Button from '../components/common/Button'

export default function NotFound() {
  return (
    <section className="narrow centered">
      <p className="eyebrow">404 · Uncharted waters</p>
      <h1>Off the map.</h1>
      <p className="page-description">
        This page doesn’t exist. Let’s get you back to your crew.
      </p>
      <Button to="/">Back to home</Button>
    </section>
  )
}
