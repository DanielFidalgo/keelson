<script setup lang="ts">
import { ref } from 'vue';
import type { Change } from '../api/client.js';
import { diffText, type DiffBlock, type DiffLine, type DiffSegment } from '../text-diff.js';

defineProps<{ changes: Change[] }>();

const KIND_LABELS: Record<Change['kind'], string> = {
  tool_added: 'Tool added',
  tool_removed: 'Tool removed',
  prompt_added: 'Prompt added',
  prompt_removed: 'Prompt removed',
  resource_added: 'Resource added',
  resource_removed: 'Resource removed',
  input_schema_changed: 'Input schema changed',
  description_changed: 'Description changed',
};

const SEVERITY_LABELS: Record<Change['severity'], string> = { critical: 'Critical', warning: 'Warning' };

type TargetKind = 'tool' | 'prompt' | 'resource';

// A description change names its own target; every other kind is about one fixed kind of thing.
const TARGET_KINDS: Record<Exclude<Change['kind'], 'description_changed'>, TargetKind> = {
  tool_added: 'tool',
  tool_removed: 'tool',
  prompt_added: 'prompt',
  prompt_removed: 'prompt',
  resource_added: 'resource',
  resource_removed: 'resource',
  input_schema_changed: 'tool',
};

function targetKindOf(change: Change): TargetKind {
  return change.kind === 'description_changed' ? (change.target ?? 'tool') : TARGET_KINDS[change.kind];
}

// Names, URIs and descriptions come from the probed server, so they are only ever interpolated as text below.
function subjectOf(change: Change): string {
  return change.name ?? change.uri ?? change.tool ?? '';
}

function blocksOf(change: Change): DiffBlock[] {
  return diffText(change.before ?? '', change.after ?? '');
}

const expanded = ref(new Set<string>());
const blockKey = (changeIndex: number, blockIndex: number): string => [changeIndex, blockIndex].join(':');
const isExpanded = (changeIndex: number, blockIndex: number): boolean => expanded.value.has(blockKey(changeIndex, blockIndex));

function expand(changeIndex: number, blockIndex: number): void {
  expanded.value = new Set([...expanded.value, blockKey(changeIndex, blockIndex)]);
}

const LINE_CLASSES: Record<DiffLine['kind'], string> = { same: '', added: 'is-added', removed: 'is-removed', changed: 'is-changed' };
const WORD_CLASSES: Record<DiffSegment['kind'], string> = { same: '', added: 'word-added', removed: 'word-removed' };

function unchangedLabel(count: number): string {
  return [String(count), 'unchanged', count === 1 ? 'line' : 'lines'].join(' ');
}
</script>

<template>
  <p v-if="changes.length === 0">No changes.</p>
  <ul v-else class="changes">
    <li v-for="(change, index) in changes" :key="index" class="change" :data-severity="change.severity">
      <div class="change-heading">
        <span class="badge" :class="`badge-${change.severity}`">{{ SEVERITY_LABELS[change.severity] }}</span>
        <span v-if="change.classification === 'breaking'" class="badge badge-breaking">Breaking</span>
        <span v-else-if="change.classification === 'compatible'" class="badge">Compatible</span>
        <strong>{{ KIND_LABELS[change.kind] }}</strong>
        <span class="target mono muted">{{ targetKindOf(change) }} · {{ subjectOf(change) }}</span>
      </div>
      <div v-if="change.kind === 'description_changed'" class="diff mono">
        <template v-for="(block, blockIndex) in blocksOf(change)" :key="blockIndex">
          <button
            v-if="block.kind === 'collapsed' && !isExpanded(index, blockIndex)"
            type="button"
            class="unchanged-toggle"
            @click="expand(index, blockIndex)"
          >
            &#8943; {{ unchangedLabel(block.lines.length) }}
          </button>
          <template v-else-if="block.kind === 'collapsed'">
            <span v-for="(text, lineIndex) in block.lines" :key="lineIndex" class="diff-line">{{ text }}</span>
          </template>
          <template v-else>
            <span v-for="(line, lineIndex) in block.lines" :key="lineIndex" class="diff-line" :class="LINE_CLASSES[line.kind]">
              <template v-if="line.kind === 'changed'">
                <span v-for="(segment, segmentIndex) in line.segments" :key="segmentIndex" :class="WORD_CLASSES[segment.kind]">{{
                  segment.text
                }}</span>
              </template>
              <template v-else>{{ line.text }}</template>
            </span>
          </template>
        </template>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.diff {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2) 10px 10px;
  line-height: 1.6;
}

.diff-line {
  min-height: 1.6em;
  padding: 0 6px 0 18px;
  position: relative;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* The gutter marks a line's role, the way a code review diff does. */
.diff-line::before {
  position: absolute;
  left: 6px;
  color: var(--scalar-color-3);
}

.is-removed {
  background: var(--diff-removed-background);
  color: var(--diff-removed-color);
}

.is-removed::before {
  content: '-';
}

.is-added {
  background: var(--diff-added-background);
  color: var(--diff-added-color);
}

.is-added::before {
  content: '+';
}

.is-changed::before {
  content: '~';
}

.word-removed {
  background: var(--diff-removed-background);
  color: var(--diff-removed-color);
  text-decoration: line-through;
  border-radius: var(--radius-sm);
}

.word-added {
  background: var(--diff-added-background);
  color: var(--diff-added-color);
  border-radius: var(--radius-sm);
}

.unchanged-toggle {
  justify-self: start;
  padding: 2px 6px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--scalar-background-2);
  color: var(--scalar-color-3);
  font: inherit;
  cursor: pointer;
}

.unchanged-toggle:hover {
  color: var(--scalar-color-1);
}
</style>
