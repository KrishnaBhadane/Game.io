import { Link } from 'react-router'

export default function Button({
  to,
  variant = 'primary',
  className = '',
  children,
  ...props
}) {
  const classes = `button button-${variant} ${className}`
  return to ? (
    <Link to={to} className={classes} {...props}>
      {children}
    </Link>
  ) : (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  )
}
