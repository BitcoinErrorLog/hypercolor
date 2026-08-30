/**
 * Tokenizer-level duplicate-key scan for payment PAM JSON.
 *
 * Scope (honest): only the root object and nested objects named
 * `request`, `proof`, `payment_endpoints`, `amount`, and `billing_period`.
 * Other nested objects (including `metadata` and `recurrence`) are parsed
 * so the cursor advances, but their keys are not checked. JSON.parse still
 * collapses duplicates in those unscanned objects.
 *
 * If the scanner cannot tokenize the document, it reports no finding and
 * JSON.parse remains the structural gate.
 */

const WATCHED_OBJECT_KEYS = new Set([
  'request',
  'proof',
  'payment_endpoints',
  'amount',
  'billing_period',
]);

export type DuplicateKeyScan = {
  hasDuplicate: boolean;
  scanned: boolean;
  duplicateKey?: string;
  scope?: string;
};

class ScanError extends Error {
  constructor() {
    super('json scan failed');
  }
}

export function scanWatchedDuplicateKeys(rawJson: string): DuplicateKeyScan {
  try {
    const scanner = new JsonKeyScanner(rawJson);
    scanner.skipWs();
    scanner.parseValue(true, 'root');
    scanner.skipWs();
    if (scanner.index !== rawJson.length) {
      return { hasDuplicate: false, scanned: false };
    }
    if (scanner.duplicate) {
      return {
        hasDuplicate: true,
        scanned: true,
        duplicateKey: scanner.duplicate.key,
        scope: scanner.duplicate.scope,
      };
    }
    return { hasDuplicate: false, scanned: true };
  } catch {
    return { hasDuplicate: false, scanned: false };
  }
}

export function hasWatchedDuplicateKeys(rawJson: string): boolean {
  return scanWatchedDuplicateKeys(rawJson).hasDuplicate;
}

class JsonKeyScanner {
  readonly source: string;
  index = 0;
  duplicate: { key: string; scope: string } | null = null;

  constructor(source: string) {
    this.source = source;
  }

  skipWs(): void {
    while (this.index < this.source.length) {
      const ch = this.source[this.index];
      if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') return;
      this.index += 1;
    }
  }

  peek(): string {
    return this.source[this.index] ?? '';
  }

  eat(expected: string): void {
    if (this.peek() !== expected) throw new ScanError();
    this.index += 1;
  }

  parseValue(watchedObject: boolean, scope: string): void {
    this.skipWs();
    const ch = this.peek();
    if (ch === '{') {
      this.parseObject(watchedObject, scope);
      return;
    }
    if (ch === '[') {
      this.parseArray();
      return;
    }
    if (ch === '"') {
      this.parseString();
      return;
    }
    if (ch === 't') {
      this.eatWord('true');
      return;
    }
    if (ch === 'f') {
      this.eatWord('false');
      return;
    }
    if (ch === 'n') {
      this.eatWord('null');
      return;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      this.parseNumber();
      return;
    }
    throw new ScanError();
  }

  parseObject(watched: boolean, scope: string): void {
    this.eat('{');
    this.skipWs();
    if (this.peek() === '}') {
      this.index += 1;
      return;
    }
    const seen = watched ? new Set<string>() : null;
    while (this.index < this.source.length) {
      this.skipWs();
      const key = this.parseString();
      if (seen) {
        if (seen.has(key) && !this.duplicate) {
          this.duplicate = { key, scope };
        }
        seen.add(key);
      }
      this.skipWs();
      this.eat(':');
      const childWatched = WATCHED_OBJECT_KEYS.has(key);
      this.parseValue(childWatched, key);
      this.skipWs();
      if (this.peek() === ',') {
        this.index += 1;
        continue;
      }
      if (this.peek() === '}') {
        this.index += 1;
        return;
      }
      throw new ScanError();
    }
    throw new ScanError();
  }

  parseArray(): void {
    this.eat('[');
    this.skipWs();
    if (this.peek() === ']') {
      this.index += 1;
      return;
    }
    while (this.index < this.source.length) {
      this.parseValue(false, 'array');
      this.skipWs();
      if (this.peek() === ',') {
        this.index += 1;
        continue;
      }
      if (this.peek() === ']') {
        this.index += 1;
        return;
      }
      throw new ScanError();
    }
    throw new ScanError();
  }

  parseString(): string {
    this.eat('"');
    let out = '';
    while (this.index < this.source.length) {
      const ch = this.source[this.index] ?? '';
      if (ch === '"') {
        this.index += 1;
        return out;
      }
      if (ch === '\\') {
        this.index += 1;
        const esc = this.source[this.index];
        if (esc === undefined) throw new ScanError();
        if (esc === 'u') {
          const hex = this.source.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ScanError();
          out += String.fromCharCode(parseInt(hex, 16));
          this.index += 5;
          continue;
        }
        out += esc;
        this.index += 1;
        continue;
      }
      if (ch.charCodeAt(0) < 0x20) throw new ScanError();
      out += ch;
      this.index += 1;
    }
    throw new ScanError();
  }

  parseNumber(): void {
    const start = this.index;
    if (this.peek() === '-') this.index += 1;
    if (this.peek() === '0') {
      this.index += 1;
    } else if (this.peek() >= '1' && this.peek() <= '9') {
      while (this.peek() >= '0' && this.peek() <= '9') this.index += 1;
    } else {
      throw new ScanError();
    }
    if (this.peek() === '.') {
      this.index += 1;
      if (this.peek() < '0' || this.peek() > '9') throw new ScanError();
      while (this.peek() >= '0' && this.peek() <= '9') this.index += 1;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.index += 1;
      if (this.peek() === '+' || this.peek() === '-') this.index += 1;
      if (this.peek() < '0' || this.peek() > '9') throw new ScanError();
      while (this.peek() >= '0' && this.peek() <= '9') this.index += 1;
    }
    if (this.index === start) throw new ScanError();
  }

  eatWord(word: string): void {
    if (this.source.slice(this.index, this.index + word.length) !== word) {
      throw new ScanError();
    }
    this.index += word.length;
  }
}
