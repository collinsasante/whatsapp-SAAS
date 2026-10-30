import { Owner, Ticks } from './mock-parts';
import { reveal } from './reveal';
import styles from './Owner.module.css';

/**
 * The page's central idea, drawn with fragments of the real conversation UI: who has a chat, and how it moves
 * between Verz AI and a person. The sample messages are illustrative.
 */
export default function OwnerSection() {
  return (
    <section id="owner" className={`${styles.section} on-dark`} aria-labelledby="owner-title">
      <div className="wrap">
        <h2 id="owner-title" className={`h2 ${styles.title}`} {...reveal()}>
          Every conversation has one owner, and you can see who
        </h2>
        <p className={`lede ${styles.lede}`}>
          Verz AI can answer on its own or draft replies for your agents. Either way, the inbox always shows who has the
          chat, and the hand-off in each direction is one click.
        </p>

        <ol className={styles.flow} {...reveal(1)}>
          <li className={styles.state}>
            <Owner kind="ai">Verz AI answers</Owner>
            <div className={styles.thread} aria-hidden="true">
              <p className={styles.in}>Do you deliver to Kumasi?</p>
              <p className={`${styles.out} ${styles.outAi}`}>Yes, we deliver to Kumasi in one to two days.</p>
            </div>
            <p className={styles.says}>
              In auto-reply mode Verz AI answers from your knowledge base. In suggestion mode it drafts the reply and an
              agent sends it.
            </p>
          </li>

          <li className={styles.link}>
            <span>A customer asks for a person, or the AI is not sure</span>
          </li>

          <li className={styles.state}>
            <Owner kind="waiting">Waiting for a person</Owner>
            <div className={styles.thread} aria-hidden="true">
              <p className={styles.in}>Can I speak to someone about my order?</p>
              <p className={styles.banner}>Moved to Requests</p>
            </div>
            <p className={styles.says}>
              The chat appears in your Requests queue with a timer, so nobody has to ask whether someone has seen it.
            </p>
          </li>

          <li className={styles.link}>
            <span>An agent clicks Intervene</span>
          </li>

          <li className={styles.state}>
            <Owner kind="person">A person has it</Owner>
            <div className={styles.thread} aria-hidden="true">
              <p className={styles.in}>Can I speak to someone about my order?</p>
              <p className={`${styles.out} ${styles.outPerson}`}>
                Hi, this is Kwame. I can see your order. One moment.
                <span className={styles.meta}>
                  21:05 <Ticks state="read" />
                </span>
              </p>
            </div>
            <p className={styles.says}>
              The AI stops. The agent can add private notes, label the chat and resolve it. Return to AI hands it back.
            </p>
          </li>
        </ol>
      </div>
    </section>
  );
}
