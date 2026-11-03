import { createHash } from 'crypto';
import { RetentionSettings, loadRetentionSettings } from './learning-retention.service';

export interface DisclosureSection {
  id: string;
  heading: string;
  points: string[];
}

export interface LearningDisclosure {
  /** A content hash. Any change to the wording, or to a retention setting the wording describes, is a new version. */
  version: string;
  title: string;
  summary: string;
  sections: DisclosureSection[];
}

/**
 * What a workspace administrator agrees to when they switch AI learning on. It is built in code, next to the behaviour it describes, and
 * its version is a HASH OF ITS OWN CONTENT: nobody can edit the wording, or change how long data is kept, without every workspace being
 * asked to acknowledge again before learning resumes. It must stay literally true. In particular the retention paragraph follows the real
 * retention setting: while automatic deletion is off it says so, and never promises a period that nothing enforces.
 *
 * Draft wording for the privacy owner to approve; it is not approved legal text.
 */
export function buildLearningDisclosure(retention: RetentionSettings = loadRetentionSettings()): LearningDisclosure {
  const retentionPoints = retention.enabled
    ? [
        `Free text (customer messages, AI replies, evaluator notes, reviewer notes) is deleted ${retention.freeTextDays} days after it was created.`,
        `Scores and other anonymised measurements are deleted ${retention.metricsMonths} months after they were created.`,
        'Approved training examples are not deleted automatically. They stay until you withdraw, archive or delete them, or delete the conversation or contact they came from.',
      ]
    : [
        'Automatic deletion is not switched on yet. Until it is, the records described above stay until you delete them: delete a conversation or contact and everything learned from it is deleted with it, or delete individual training examples.',
        'You will be asked to acknowledge an updated version of this notice before any automatic deletion period starts to apply.',
      ];

  const content = {
    title: 'How AI learning uses your conversations',
    summary:
      'When you switch learning on, VerzChat reviews how the AI and your team handled customer conversations so that replies can improve. Nothing is collected for learning while it is off or paused.',
    sections: [
      {
        id: 'collected',
        heading: 'What is collected',
        points: [
          'For conversations the AI answered: the customer message, the AI reply, the recent messages before it, and basic order and handover status. These are stored as an interaction record.',
          'The result of each review: scores, the kinds of problem found, and a short written explanation. The explanation can quote the conversation.',
          'Notes and corrections that your team writes while reviewing.',
          'For each human agent: counts and style markers taken from their replies, such as length, punctuation, emoji use and common greeting types. The agent’s sentences are not stored in this profile.',
        ],
      },
      {
        id: 'how',
        heading: 'How conversations are evaluated',
        points: [
          'Evaluation happens afterwards and in the background, never while a customer is waiting for a reply.',
          'To evaluate an exchange, the conversation excerpt above is sent to an AI service provider (currently DeepSeek) over its API. The provider handles it under its own terms, which VerzChat does not control.',
          'VerzChat pays for evaluation. It is never taken from your AI credits.',
          'Administrators’ activity records for learning contain identifiers, counts and settings only, never conversation content.',
        ],
      },
      {
        id: 'retention',
        heading: 'What is kept and for how long',
        points: retentionPoints,
      },
      {
        id: 'guidance',
        heading: 'Approved guidance and training examples',
        points: [
          'A training example is a reviewed customer question with the answer your team wants. It only influences replies after an administrator approves it.',
          'Approved examples are added to the AI’s instructions for similar questions in your workspace only. They are never shown to other workspaces.',
          'Withdrawing an approval, or archiving an example, stops it influencing replies straight away. Deleting an example removes its text for good.',
          'An example copied into VerzChat’s engineering test suite by our team cannot be removed by deleting it here. Ask us to remove it.',
        ],
      },
      {
        id: 'controls',
        heading: 'Your controls',
        points: [
          'Switch learning on or off. It is off by default.',
          'Pause learning without switching it off. Digital Self profiles and existing guidance keep working while learning is paused.',
          'Switch approved guidance on or off independently of learning.',
          'Delete a conversation or contact at any time: everything learned from it is deleted in the same step. If that cannot be done, the deletion does not happen.',
        ],
      },
    ] satisfies DisclosureSection[],
  };

  const version = `d1-${createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 12)}`;
  return { version, ...content };
}

/** The version a workspace must have acknowledged for learning to run now. */
export function currentDisclosureVersion(retention: RetentionSettings = loadRetentionSettings()): string {
  return buildLearningDisclosure(retention).version;
}
