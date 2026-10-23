import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/node_modules/']),
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  pluginVue.configs['flat/essential'],
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The Vue parser reads the template and hands the script block to the TypeScript parser, so the typed rules still apply.
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    files: ['apps/dashboard/src/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    // Plain JS and CJS configs sit outside every tsconfig, so type information does not exist for them.
    files: ['**/*.js', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
