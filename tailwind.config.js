/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#000000",
        primary: "#FFFFFF",
        secondary: "#1C1C1E",
        accent: "#0A84FF",
        muted: "#8E8E93",
        glass: "rgba(255, 255, 255, 0.1)",
      },
      borderRadius: {
        'apple-sm': '8px',
        'apple-md': '12px',
      },
      fontFamily: {
        'sf-pro': ['SF Pro Display', 'System'],
      }
    },
  },
  plugins: [],
};
