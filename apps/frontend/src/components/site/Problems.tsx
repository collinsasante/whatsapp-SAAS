import { reveal } from './reveal';
import styles from './Problems.module.css';

const ROWS = [
  {
    problem: 'The messages live on one phone.',
    answer:
      'Your whole team works from the browser in one shared inbox. Every conversation shows its channel and keeps the full history with that customer, including images, voice notes and documents.',
    parts: ['Shared inbox', 'Conversation history', 'Media library'],
  },
  {
    problem: 'Nobody knows who has a chat.',
    answer:
      'Every conversation has an owner. New requests wait in a queue with a timer, an agent claims one with Intervene, and private notes and labels stay with the chat for whoever picks it up next.',
    parts: ['Requests queue', 'Assignment', 'Private notes', 'Labels'],
  },
  {
    problem: 'The bot keeps answering when a person should.',
    answer:
      "Verz AI answers from your knowledge base and steps aside when a customer asks for a person or it isn't sure. You can stop it on any chat, and give the chat back when you are done.",
    parts: ['Verz AI', 'Knowledge base', 'Intervene', 'Return to AI'],
  },
  {
    problem: 'Agents type the same ten answers all day.',
    answer:
      'Build chatbot flows and automations without code, using keyword and first-message triggers. Saved replies are one slash away in the composer, so every agent answers the common questions the same way.',
    parts: ['Chatbot flows', 'Automations', 'Saved replies'],
  },
];

export default function Problems() {
  return (
    <section className={styles.section} aria-labelledby="problems-title">
      <div className="wrap">
        <h2 id="problems-title" className={`h2 ${styles.title}`} {...reveal()}>
          Where customer chats usually go wrong
        </h2>
        <ul className={styles.rows}>
          {ROWS.map((r, i) => (
            <li key={r.problem} className={styles.row} {...reveal(i)}>
              <h3 className={styles.problem}>{r.problem}</h3>
              <div className={styles.answer}>
                <p>{r.answer}</p>
                <ul className={styles.parts} aria-label="Where to find it in VerzChat">
                  {r.parts.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
