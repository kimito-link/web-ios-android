// Tailwind 4 は PostCSS プラグイン1本で動く（tailwind.config.js は不要）。
// トークン/テーマは app/globals.css の @theme で定義する。
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
