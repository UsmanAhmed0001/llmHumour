/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fonts are loaded at runtime via a <link> in app/layout.tsx. Disabling
  // build-time font inlining keeps `next build` hermetic (no network needed in
  // CI / offline) while the browser still fetches the fonts normally.
  optimizeFonts: false,
};

export default nextConfig;
