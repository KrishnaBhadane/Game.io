export default function BalanceDisplay({ amount, label = 'Your bounty' }) {
  return (
    <div className="balance">
      <span className="eyebrow">{label}</span>
      <strong>₹{amount.toLocaleString('en-IN')}</strong>
      <span className="fine-print">Virtual currency</span>
    </div>
  )
}
