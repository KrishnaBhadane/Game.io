import Button from '../components/common/Button'
import luffy from '../assets/luffy-hero.webp'
import '../styles/home.css'

export default function Home() {
  return (
    <section className="bounty-hero" aria-labelledby="hero-title">
      <div className="hero-stage">
        <h1 id="hero-title" className="hero-title">
          <span className="hero-title-lead">Win the</span>
          <span className="hero-title-main">BOUNTY.</span>
        </h1>
        <div className="hero-art">
          <img
            src={luffy}
            alt="Luffy laughing in Gear 5"
            width="900"
            height="900"
            fetchPriority="high"
          />
        </div>
      </div>
      <div className="hero-actions">
        <Button to="/join">Join Game</Button>
        <Button to="/admin/login" variant="secondary">
          Host a Game
        </Button>
      </div>
    </section>
  )
}
