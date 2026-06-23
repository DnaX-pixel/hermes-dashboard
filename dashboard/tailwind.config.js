/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",
    "./public/**/*.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        "hr-bg": "#f8fafc",
        "hr-sidebar": "#ffffff",
        "hr-blue": "#3b82f6",
        "hr-border": "#e2e8f0",
        "hr-muted": "#64748b",
      },
    },
  },
  // Safelist: classes built dynamically in JS (string-concatenated) that the
  // content scanner might miss. Keeps these in the final CSS regardless.
  safelist: [
    "bg-blue-50", "bg-blue-500", "bg-green-500", "bg-green-600", "bg-red-500", "bg-amber-500",
    "text-green-500", "text-green-600", "text-red-500", "text-amber-500", "text-slate-700",
    "animate-pulse", "flex", "hidden", "flex-col",
  ],
  plugins: [],
};
