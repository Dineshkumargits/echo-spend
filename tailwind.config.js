/** @type {import('tailwindcss').Config} */
// Values mirror src/theme/tokens.ts (dark resolution — the app's committed
// ground). Themed colors in components should come from useTheme().colors;
// these utilities exist for static/dark-anchored styling only.
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Grounds
        background: "#0A1416",   // ink
        surface: "#101D21",      // tide
        elevated: "#15262B",     // tideRaised
        // Text
        primary: "#E8F2F0",      // glow
        muted: "#7E9895",        // fog
        // Signals
        accent: "#FFB454",       // pulse amber — money out / primary action
        pulse: "#FFB454",
        echo: "#56D4C0",         // echo aqua — money in / AI
        alert: "#FF6B5E",
        // Misc
        secondary: "#101D21",    // legacy alias (was surface-toned)
        glass: "rgba(232, 242, 240, 0.09)",
      },
      borderRadius: {
        // Legacy aliases kept so existing className usage restyles in place
        'apple-sm': '10px',
        'apple-md': '14px',
        'echo-lg': '20px',
        'echo-xl': '28px',
      },
      fontFamily: {
        'display': ['ClashDisplay-Semibold'],
        'display-bold': ['ClashDisplay-Bold'],
        'body': ['Switzer-Regular'],
        'body-medium': ['Switzer-Medium'],
        'body-semibold': ['Switzer-Semibold'],
        'body-bold': ['Switzer-Bold'],
        'signal': ['JetBrainsMono-Regular'],
        'signal-bold': ['JetBrainsMono-Bold'],
        // Legacy alias
        'sf-pro': ['Switzer-Regular'],
      }
    },
  },
  plugins: [],
};
