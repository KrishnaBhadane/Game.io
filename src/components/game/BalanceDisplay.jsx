export default function BalanceDisplay({ amount, label = 'Your bounty' }) {
  return (
    <div className="balance">
      <span className="eyebrow">{label}</span>
      <strong key={amount}>₹{amount.toLocaleString('en-IN')}</strong>
    </div>
  )
}
