// tsc cannot read .vue files, so it sees them through this declaration; vue-tsc checks them for real.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
