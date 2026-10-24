import { Ticks } from './mock-parts';
import styles from './Steps.module.css';

// A real sequence, so the markers are the ticks a message earns on its way: sent, delivered, read.
const STEPS = [
  {
    state: 'sent',
    title: 'Connect a channel',
    text: 'Link your WhatsApp Business number from your own Meta account, or link a phone by QR code. Your first conversations appear in the inbox.',
  },
  {
    state: 'delivered',
    title: 'Invite your team',
    text: 'Add your agents and give each a role. Everyone works from the same inbox, so a chat is never stuck on someone\'s phone.',
  },
  {
    state: 'read',
    title: 'Choose who answers',
    text: 'Turn on Verz AI to answer or to draft, or keep every chat with a person. You can change it whenever you like.',
  },
] as const;

export default function Steps() {
  return (
    <section id="how" className={styles.section} aria-labelledby="steps-title">
      <div className="wrap">
        <h2 id="steps-title" className="h2">
          From first connection to a working inbox
        </h2>
        <ol className={styles.steps}>
          {STEPS.map((s) => (
            <li key={s.title} className={styles.step}>
              <span className={styles.mark}>
                <Ticks state={s.state} />
              </span>
              <h3 className="h3">{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
