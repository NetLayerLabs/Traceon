/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tests build into a separate directory so they never clobber a running dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // alasql pulls optional Node-only deps; keep it out of the bundle.
  serverExternalPackages: ['alasql'],
  // No X-Powered-By banner on any response.
  poweredByHeader: false,
};
export default nextConfig;
