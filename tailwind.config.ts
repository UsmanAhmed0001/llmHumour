import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#EAE7DF",
        surface: "#F5F2EB",
        raised: "#FBF9F4",
        ink: "#1F1D1A",
        muted: "#6E675C",
        faint: "#9A9286",
        hairline: "#DBD5C8",
        // Provider accents (brand-derived, used as functional column identity)
        openai: "#0F9D74",
        anthropic: "#CC785C",
        google: "#4079ED",
        signal: "#B4472E",
      },
      fontFamily: {
        display: ['"Instrument Serif"', "Georgia", "serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(31,29,26,0.04), 0 8px 24px -16px rgba(31,29,26,0.18)",
      },
      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s linear infinite",
        fadeUp: "fadeUp 0.25s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
