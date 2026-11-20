import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
// Keep the full teal/violet scales (teal-50…teal-950 are used across the app);
// the brand colours stay available as the plain `teal` / `violet` classes.
const config: Config = { darkMode: ["class"], content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: { colors: { ink: "#101827", teal: { ...colors.teal, DEFAULT: "#38d6c1" }, violet: { ...colors.violet, DEFAULT: "#9285ff" } }, fontFamily: { sans: ["var(--font-arabic)", "var(--font-latin)", "sans-serif"] }, boxShadow: { glass: "0 20px 60px rgba(15,23,42,.10)" } } }, plugins: [] };
export default config;
