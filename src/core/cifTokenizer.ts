export type CifToken =
  | { kind: 'data'; name: string }
  | { kind: 'loop' }
  | { kind: 'tag'; name: string }
  | { kind: 'value'; value: string }
  | { kind: 'save'; name: string };

const WHITESPACE = /\s/;

/**
 * Streaming tokenizer for the STAR/mmCIF grammar: bare values, single- and
 * double-quoted strings, and semicolon-delimited multiline text fields.
 * Written as a generator so a 100 MB entry never materializes as a token array.
 */
export function* tokenizeCif(text: string): Generator<CifToken> {
  let i = 0;
  const n = text.length;
  let atLineStart = true;

  while (i < n) {
    const ch = text[i];

    if (ch === '\n') {
      atLineStart = true;
      i++;
      continue;
    }
    if (WHITESPACE.test(ch)) {
      i++;
      continue;
    }
    if (ch === '#') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (ch === ';' && atLineStart) {
      i++;
      const start = i;
      // Terminated by a semicolon that is itself at the start of a line.
      while (i < n) {
        if (text[i] === '\n' && text[i + 1] === ';') break;
        i++;
      }
      const value = text.slice(start, i);
      i += 2;
      atLineStart = false;
      yield { kind: 'value', value: value.trim() };
      continue;
    }
    atLineStart = false;

    if (ch === "'" || ch === '"') {
      i++;
      const start = i;
      // A quote only closes the string when followed by whitespace or EOF,
      // which is how CIF permits apostrophes inside bare-quoted values.
      while (i < n) {
        if (text[i] === ch) {
          const next = text[i + 1];
          if (next === undefined || WHITESPACE.test(next)) break;
        }
        i++;
      }
      const value = text.slice(start, i);
      i++;
      yield { kind: 'value', value };
      continue;
    }

    const start = i;
    while (i < n && !WHITESPACE.test(text[i])) i++;
    const word = text.slice(start, i);

    if (word[0] === '_') {
      yield { kind: 'tag', name: word.toLowerCase() };
      continue;
    }
    const lower = word.toLowerCase();
    if (lower === 'loop_') {
      yield { kind: 'loop' };
      continue;
    }
    if (lower.startsWith('data_')) {
      yield { kind: 'data', name: word.slice(5) };
      continue;
    }
    if (lower.startsWith('save_')) {
      yield { kind: 'save', name: word.slice(5) };
      continue;
    }
    yield { kind: 'value', value: word };
  }
}

/** CIF's null markers; callers treat both as "no value". */
export function isCifNull(value: string): boolean {
  return value === '.' || value === '?';
}

export function cifString(value: string): string {
  return isCifNull(value) ? '' : value;
}

export function cifNumber(value: string, fallback: number): number {
  if (isCifNull(value)) return fallback;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function cifInt(value: string, fallback: number): number {
  if (isCifNull(value)) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
