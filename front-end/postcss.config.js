// Tailwind v4 is handled by the @tailwindcss/vite plugin (see vite.config.ts),
// NOT as a PostCSS plugin. PostCSS here only runs autoprefixer over the SCSS layout.
export default {
  plugins: {
    autoprefixer: {},
  },
};
