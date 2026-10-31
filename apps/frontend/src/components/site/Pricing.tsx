import Link from 'next/link';
import { PLANS, PLAN_ROWS } from './data';
import { reveal } from './reveal';
import styles from './Pricing.module.css';

const CTA = { free: 'Start free', starter: 'Choose Starter', pro: 'Start the 7-day trial' } as const;

export default function Pricing() {
  return (
    <section id="pricing" className={styles.section} aria-labelledby="pricing-title">
      <div className="wrap">
        <h2 id="pricing-title" className="h2" {...reveal()}>
          Pricing
        </h2>
        <p className={`lede ${styles.lede}`}>
          Plans are priced per workspace, not per message. Prices are in US dollars. Payment inside the app is taken in
          Ghana cedis through Paystack, and the amount is shown at checkout. Billing and cancellation are covered in the{' '}
          <Link href="/terms">terms of service</Link>.
        </p>

        <div {...reveal(1)} className={styles.scroll} tabIndex={0} role="region" aria-label="Plan comparison, scrolls sideways on small screens">
          <table className={styles.table}>
            <caption className={styles.srOnly}>What each plan includes</caption>
            <thead>
              <tr>
                <td />
                {PLANS.map((p) => (
                  <th key={p.id} scope="col" className={p.highlight ? styles.pro : undefined}>
                    <span className={styles.planName}>{p.name}</span>
                    <span className={styles.price}>{p.price}</span>
                    <span className={styles.note}>{p.note}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLAN_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className={v === 'None' ? styles.none : undefined}>
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td />
                {PLANS.map((p) => (
                  <td key={p.id}>
                    <Link href="/auth/register" className={`btn ${p.highlight ? 'btn-solid' : 'btn-line'} ${styles.cta}`}>
                      {CTA[p.id]}
                    </Link>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}
