import { readonly, ref, type InjectionKey, type Ref } from 'vue';
import { describeFailure } from '../api/describe-failure.js';
import { required } from '../injection.js';

export const SUCCESS_TOAST_MS = 4_000;
// A failure carries the reason, so it stays long enough to be read.
export const FAILURE_TOAST_MS = 8_000;

export interface Toast {
  id: number;
  kind: 'success' | 'failure';
  text: string;
}

export interface Toasts {
  readonly toasts: Readonly<Ref<readonly Toast[]>>;
  success: (text: string) => void;
  failure: (error: unknown) => void;
  dismiss: (id: number) => void;
}

export const toastsKey: InjectionKey<Toasts> = Symbol('toasts');

export function createToasts(): Toasts {
  const toasts = ref<Toast[]>([]);
  let nextId = 0;

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function show(kind: Toast['kind'], text: string, visibleMs: number): void {
    const id = nextId++;
    toasts.value = [...toasts.value, { id, kind, text }];
    setTimeout(() => {
      dismiss(id);
    }, visibleMs);
  }

  return {
    toasts: readonly(toasts),
    success: (text) => {
      show('success', text, SUCCESS_TOAST_MS);
    },
    failure: (error) => {
      show('failure', describeFailure(error), FAILURE_TOAST_MS);
    },
    dismiss,
  };
}

export const useToasts = (): Toasts => required(toastsKey, 'the toasts');
