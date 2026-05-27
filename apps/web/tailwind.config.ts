import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        nero: {
          ink: "#050806",
          stage: "#07110d",
          panel: "#0d1712",
          line: "#21352a",
          mist: "#a9b8ae",
          live: "#31f176",
          acid: "#bbff5b",
          warning: "#ffce6b",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        live: "0 0 36px rgba(49, 241, 118, 0.16)",
      },
    },
  },
  plugins: [],
} satisfies Config;
