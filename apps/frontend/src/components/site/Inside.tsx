import styles from './Inside.module.css';

// One sentence each, and each one is something the workspace does today.
const MODULES = [
  { name: 'Inbox', text: 'Conversations with their channel, owner, labels and private notes, searchable, with images, voice notes and documents.' },
  { name: 'Verz AI', text: 'Answers customers from your knowledge base, or drafts the reply for an agent to send.' },
  { name: 'Knowledge base', text: 'Write articles, upload files or import a web page, and Verz AI answers from them.' },
  { name: 'Chatbot flows', text: 'A drag-and-drop builder for guided conversations, with a hand-off to an agent built in.' },
  { name: 'Automations', text: 'Rules that run on a keyword, a first message or a customer who goes quiet, then reply, assign an agent, add a label or resolve the chat.' },
  { name: 'Campaigns and templates', text: 'Send approved WhatsApp templates to all contacts, a segment, a label or a CSV list.' },
  { name: 'Contacts', text: 'Every customer with their history, grouped into segments you can message.' },
  { name: 'Analytics', text: 'Response and resolution times, and customer satisfaction scores.' },
  { name: 'Team and workspaces', text: 'Invite agents, give each an admin, agent or viewer role, and belong to more than one workspace.' },
  { name: 'Media library', text: 'Every file you have shared with customers, in one place you can search and reuse.' },
];

export default function Inside() {
  return (
    <section className={styles.section} aria-labelledby="inside-title">
      <div className={`wrap ${styles.grid}`}>
        <div className={styles.head}>
          <h2 id="inside-title" className="h2">
            The rest of the workspace, in one place
          </h2>
          <p className="lede">
            You do not need five tools stitched together. These ship in the same login as the inbox, and the plan you
            choose sets how much of each you get.
          </p>
        </div>

        <dl className={styles.list}>
          {MODULES.map((m) => (
            <div key={m.name} className={styles.item}>
              <dt>{m.name}</dt>
              <dd>{m.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
