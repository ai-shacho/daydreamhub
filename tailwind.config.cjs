module.exports = {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Main brand color: #46a3c1
        teal: {
          50:  '#edf7fb',
          100: '#caeaf4',
          200: '#95d4e8',
          300: '#5bbad8',
          400: '#3aaac9',
          500: '#46a3c1',
          600: '#46a3c1',
          700: '#3389a5',
          800: '#256880',
          900: '#1a4f61',
          950: '#0f3042',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
