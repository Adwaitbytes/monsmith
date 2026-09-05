/**
 * Lexical preprocessing shared by every stage of the parallel analyser.
 *
 * Later stages match patterns against source text, so comments and string
 * literals have to disappear first: a `//` note mentioning `reserve0` otherwise
 * registers as a storage read, and a brace inside a string breaks every block
 * boundary after it. Replacements keep the original length so byte offsets, and
 * therefore reported line numbers, stay accurate.
 */

/** Blanks comment bodies and string contents, preserving length and newlines. */
export function stripNonCode(source: string): string {
    const out = source.split('');
    const n = source.length;

    const blank = (from: number, to: number) => {
        for (let k = Math.max(0, from); k < Math.min(n, to); k++) {
            if (out[k] !== '\n') out[k] = ' ';
        }
    };

    let i = 0;
    while (i < n) {
        const c = source[i];
        const next = source[i + 1];

        if (c === '/' && next === '/') {
            let j = i;
            while (j < n && source[j] !== '\n') j++;
            blank(i, j);
            i = j;
            continue;
        }

        if (c === '/' && next === '*') {
            let j = i + 2;
            while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
            j = Math.min(n, j + 2);
            blank(i, j);
            i = j;
            continue;
        }

        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < n && source[j] !== c) {
                if (source[j] === '\\') j++;
                j++;
            }
            // The quotes survive so the literal still reads as a single token.
            blank(i + 1, j);
            i = Math.min(n, j + 1);
            continue;
        }

        i++;
    }

    return out.join('');
}

/**
 * Index just past the delimiter matching the one at `open`.
 * Returns `source.length` when the source is unbalanced, so callers degrade to
 * "rest of file" rather than throwing on a half-typed contract in the editor.
 */
export function matchDelimiter(source: string, open: number, openChar = '{', closeChar = '}'): number {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === openChar) depth++;
        else if (source[i] === closeChar) {
            depth--;
            if (depth === 0) return i + 1;
        }
    }
    return source.length;
}

/** Builds a fast offset-to-line-number lookup for one source string. */
export function lineCounter(source: string): (index: number) => number {
    const newlines: number[] = [];
    for (let i = 0; i < source.length; i++) {
        if (source[i] === '\n') newlines.push(i);
    }

    return (index: number) => {
        let lo = 0;
        let hi = newlines.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (newlines[mid] < index) lo = mid + 1;
            else hi = mid;
        }
        return lo + 1;
    };
}

/** Splits on `separator` only where no bracket of any kind is open. */
export function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[' || c === '{') depth++;
        else if (c === ')' || c === ']' || c === '}') depth--;
        else if (c === separator && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }

    parts.push(text.slice(start));
    return parts;
}

/** The identifier ending at or before `end`, or an empty string. */
export function lastIdentifier(text: string): string {
    const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
    return matches ? matches[matches.length - 1] : '';
}
