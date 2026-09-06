import { sanitizeHref } from './sanitizeHref';

export type MarkdownNode =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string };

const TOKEN = /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|\*([^*]+?)\*|\[([^\]]+?)\]\(([^)]+?)\)/g;

function pushText(out: MarkdownNode[], value: string): void {
  if (value.length === 0) return;
  const last = out[out.length - 1];
  if (last?.type === 'text') {
    last.value += value;
    return;
  }
  out.push({ type: 'text', value });
}

/** Render-only tokenizer: bold, italic, inline code, markdown links. No HTML. */
export function parseInlineMarkdown(source: string): MarkdownNode[] {
  const out: MarkdownNode[] = [];
  let cursor = 0;
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = TOKEN.exec(source);
  while (match) {
    pushText(out, source.slice(cursor, match.index));
    if (match[2] !== undefined) {
      out.push({ type: 'code', value: match[2] });
    } else if (match[3] !== undefined) {
      out.push({ type: 'bold', value: match[3] });
    } else if (match[4] !== undefined) {
      out.push({ type: 'italic', value: match[4] });
    } else if (match[5] !== undefined && match[6] !== undefined) {
      const href = sanitizeHref(match[6]);
      if (href) {
        out.push({ type: 'link', value: match[5], href });
      } else {
        pushText(out, match[0]);
      }
    }
    cursor = match.index + match[0].length;
    match = TOKEN.exec(source);
  }
  pushText(out, source.slice(cursor));
  return out;
}
