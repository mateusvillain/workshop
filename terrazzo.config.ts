import { defineConfig } from '@terrazzo/cli';
import css from '@terrazzo/plugin-css';

export default defineConfig({
  tokens: ['./tokens.resolver.json'],
  outDir: './dist/',
  plugins: [
    css({
      filename: 'tokens.css',
      exclude: [],
      permutations: [
        {
          input: {},
          prepare: (css) => `:root {\n  ${css}\n}`,
        },
        {
          input: { theme: "light" },
          include: ['color.**'],
          prepare: (css) => `@media (prefers-color-scheme: "light") { \n  :root { \n    color-scheme: light; \n    ${css} \n  } \n}\n\n[data-theme="light"] {\n  color-scheme: light; \n  ${css}\n}`,
        },
        {
          input: { theme: "dark" },
          include: ['color.**'],
          prepare: (css) => `@media (prefers-color-scheme: "dark") { \n  :root { \n    color-scheme: dark; \n    ${css} \n  } \n}\n\n[data-theme="dark"] {\n  color-scheme: dark; \n  ${css}\n}`,
        },
        {
          input: { size: "desktop" },
          include: ['spacing.**'],
          prepare: (css) => `@media (width >= 600px) {\n  :root {\n    ${css}\n  }\n}`,
        },
        {
          input: { size: "mobile" },
          include: ['spacing.**'],
          prepare: (css) => `@media (width < 600px) {\n  :root {\n    ${css}\n  }\n}`,
        },
      ],
    }),
  ],
});
