import { Fragment } from 'react';

// Single capturing group -> String.split() returns [text, url, text, url, ..., text],
// so odd indices are always the matched URL (avoids any regex.lastIndex statefulness
// pitfalls that come from reusing a global-flag regex across split() and test()).
const URL_SPLIT_REGEX = /(https?:\/\/[^\s]+)/g;

/**
 * Renders plain chat text with any http(s) URLs turned into clickable links.
 * No explicit link color -- inherits the bubble's own text color (underline is
 * the clickability cue), so it stays readable across every bubble background.
 */
export function linkify(text: string): React.ReactNode[] {
  return text.split(URL_SPLIT_REGEX).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline break-all">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
