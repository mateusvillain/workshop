import { defineConfig } from '@terrazzo/cli';
import css from '@terrazzo/plugin-css';

export default defineConfig({
  tokens: ['./tokens.resolver.json'], // Arquivo que o Terrazzo deve olhar para gerar os tokens
  outDir: './dist/', // Pasta em que o arquivo será gerado
  plugins: [
    css({
      filename: 'tokens.css', // Nome do arquivo de tokens gerado em CSS
      exclude: [],
      permutations: [
        {
          // Gera todos os tokens nas suas versões "default", definidas no resolver.json
          input: {},
          prepare: (css) => `:root {\n  ${css}\n}`,
        },
        {
          input: { brandTheme: "brand-a-light" }, // Nome do "context" no resolver.json
          include: ['color.**'], // Filtra apenas pelos tokens que começam por esse nome
          prepare: (css) => `[data-brand="brand-a"][data-theme="light"] {\n  color-scheme: light;\n  ${css}\n}`,
        },
        {
          input: { brandTheme: "brand-a-light" },
          include: ['color.**'],
          prepare: (css) => `@media (prefers-color-scheme: light) {\n  [data-brand="brand-a"] {\n    color-scheme: light;\n    ${css}  \n  }\n}`,
          // O @media (prefers-color-scheme: light/dark) é usado quando queremos dar ao usuário a possibilidade de decidir qual tema ele quer visualizar
        },
        {
          input: { brandTheme: "brand-a-dark" },
          include: ['color.**'],
          prepare: (css) => `[data-brand="brand-a"][data-theme="dark"] {\n  color-scheme: dark;\n  ${css}\n}`,
          // O data-theme é usado para identificar o tema definido no sistema operacional, e usar como padrão no site
        },
        {
          input: { brandTheme: "brand-a-dark" },
          include: ['color.**'],
          prepare: (css) => `@media (prefers-color-scheme: dark) {\n  [data-brand="brand-a"] {\n    color-scheme: dark;\n    ${css}  \n  }\n}`,
        },
        {
          input: { brandTheme: "brand-b-light" },
          include: ['color.**'],
          prepare: (css) => `[data-brand="brand-b"][data-theme="light"] {\n  color-scheme: light;\n  ${css}\n}`,
        },
        {
          input: { brandTheme: "brand-b-light" },
          include: ['color.**'],
          prepare: (css) => `@media (prefers-color-scheme: light) {\n  [data-brand="brand-b"] {\n    color-scheme: light;\n    ${css}  \n  }\n}`,
        },
        {
          input: { brandTheme: "brand-b-dark" },
          include: ['color.**'],
          prepare: (css) => `[data-brand="brand-b"][data-theme="dark"] {\n  color-scheme: dark;\n  ${css}\n}`,
        },
        {
          input: { brandTheme: "brand-b-dark" },
          include: ['color.**'],
          prepare: (css) => `@media (prefers-color-scheme: dark) {\n  [data-brand="brand-b"] {\n    color-scheme: dark;\n    ${css}  \n  }\n}`,
        },
        {
          input: { size: "desktop" },
          include: ['spacing.**'],
          prepare: (css) => `@media (width >= 600px) {\n  :root {\n    ${css}\n  }\n}`,
          // O @media (width >= X) faz com que o sistema aplique apenas os valores dentro dele quando a largura foi maior ou igual ao valor definido
        },
        {
          input: { size: "mobile" },
          include: ['spacing.**'],
          prepare: (css) => `@media (width < 600px) {\n  :root {\n    ${css}\n  }\n}`,
          // O @media (width < X) faz com que o sistema aplique apenas os valores dentro dele quando a largura foi menor ao valor definido
        },
      ],
    }),
  ]
});
