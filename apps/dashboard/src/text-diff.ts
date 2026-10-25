// A line diff, refined to a word diff inside each changed line, so a long description shows only what moved.

export interface DiffSegment {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

export type DiffLine =
  | { kind: 'same'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'changed'; segments: DiffSegment[] };

export type DiffBlock = { kind: 'lines'; lines: DiffLine[] } | { kind: 'collapsed'; lines: string[] };

type Operation<T> = { kind: 'same' | 'added' | 'removed'; value: T };

// Unchanged lines kept around each change so the edit reads in context.
const CONTEXT_LINES = 1;
// The comparison table grows with the product of both lengths; past this, a changed line is shown whole.
const MAX_DIFF_CELLS = 1_000_000;

function longestCommonSubsequence<T>(before: readonly T[], after: readonly T[]): Operation<T>[] {
  const rows = before.length + 1;
  const columns = after.length + 1;
  const lengths = new Uint32Array(rows * columns);
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      const here = row * columns + column;
      lengths[here] =
        before[row] === after[column]
          ? (lengths[here + columns + 1] ?? 0) + 1
          : Math.max(lengths[here + columns] ?? 0, lengths[here + 1] ?? 0);
    }
  }
  const operations: Operation<T>[] = [];
  let row = 0;
  let column = 0;
  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      operations.push({ kind: 'same', value: before[row] as T });
      row += 1;
      column += 1;
    } else if ((lengths[(row + 1) * columns + column] ?? 0) >= (lengths[row * columns + column + 1] ?? 0)) {
      operations.push({ kind: 'removed', value: before[row] as T });
      row += 1;
    } else {
      operations.push({ kind: 'added', value: after[column] as T });
      column += 1;
    }
  }
  for (; row < before.length; row += 1) operations.push({ kind: 'removed', value: before[row] as T });
  for (; column < after.length; column += 1) operations.push({ kind: 'added', value: after[column] as T });
  return operations;
}

// Each word keeps its trailing spaces, so shared spaces cannot stitch unrelated words together.
function wordsOf(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function diffWords(before: string, after: string): DiffSegment[] {
  const beforeWords = wordsOf(before);
  const afterWords = wordsOf(after);
  if (beforeWords.length * afterWords.length > MAX_DIFF_CELLS) {
    return [
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ];
  }
  const segments: DiffSegment[] = [];
  const append = (kind: DiffSegment['kind'], text: string): void => {
    const previous = segments.at(-1);
    if (text === '') return;
    if (previous?.kind === kind) previous.text += text;
    else segments.push({ kind, text });
  };
  // Within one edit, all removed words read first and then all added words, as in a review diff.
  let removed = '';
  let added = '';
  for (const operation of longestCommonSubsequence(beforeWords, afterWords)) {
    if (operation.kind === 'removed') removed += operation.value;
    else if (operation.kind === 'added') added += operation.value;
    else {
      append('removed', removed);
      append('added', added);
      removed = '';
      added = '';
      append('same', operation.value);
    }
  }
  append('removed', removed);
  append('added', added);
  return segments;
}

// A run of removed lines followed by added ones is one edit: pair them up and diff each pair by word.
function pairEdits(operations: Operation<string>[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let index = 0;
  while (index < operations.length) {
    const operation = operations[index] as Operation<string>;
    if (operation.kind === 'same') {
      lines.push({ kind: 'same', text: operation.value });
      index += 1;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (index < operations.length && operations[index]?.kind !== 'same') {
      const edit = operations[index] as Operation<string>;
      (edit.kind === 'removed' ? removed : added).push(edit.value);
      index += 1;
    }
    const paired = Math.min(removed.length, added.length);
    for (let pair = 0; pair < paired; pair += 1) {
      lines.push({ kind: 'changed', segments: diffWords(removed[pair] as string, added[pair] as string) });
    }
    for (const text of removed.slice(paired)) lines.push({ kind: 'removed', text });
    for (const text of added.slice(paired)) lines.push({ kind: 'added', text });
  }
  return lines;
}

function nearChange(lines: DiffLine[], index: number): boolean {
  const from = Math.max(0, index - CONTEXT_LINES);
  const to = Math.min(lines.length - 1, index + CONTEXT_LINES);
  for (let neighbour = from; neighbour <= to; neighbour += 1) {
    if (lines[neighbour]?.kind !== 'same') return true;
  }
  return false;
}

export function diffText(before: string, after: string): DiffBlock[] {
  const lines = pairEdits(longestCommonSubsequence(before.split('\n'), after.split('\n')));
  const blocks: DiffBlock[] = [];
  lines.forEach((line, index) => {
    const collapsible = line.kind === 'same' && !nearChange(lines, index);
    const previous = blocks.at(-1);
    if (collapsible) {
      if (previous?.kind === 'collapsed') previous.lines.push(line.text);
      else blocks.push({ kind: 'collapsed', lines: [line.text] });
    } else if (previous?.kind === 'lines') {
      previous.lines.push(line);
    } else {
      blocks.push({ kind: 'lines', lines: [line] });
    }
  });
  return blocks;
}
