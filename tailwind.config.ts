import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f1f1ff",
          100: "#e5e5ff",
          200: "#d1d0ff",
          400: "#8D8CFF",
          500: "#7C7BFF",
          600: "#5757FF",
          700: "#4948F7",
          800: "#3735c8",
          900: "#29288f",
          950: "#171750"
        }
      },
      boxShadow: {
        soft: "0 8px 24px rgba(15, 23, 42, 0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
