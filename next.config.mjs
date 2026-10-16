/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  /**
   * Emit a self-contained server bundle so the runtime image carries only the
   * node_modules actually reached, not the full install. Takes the image from
   * roughly 1.2GB to a couple of hundred megabytes, which matters on the free
   * tiers this is meant to run on.
   */
  output: 'standalone',
  /**
   * Keep `data/` out of the traced bundle.
   *
   * The stores read paths built from environment variables, so the tracer
   * cannot prove which files they touch and conservatively copies the whole
   * directory. That pulled 72MB of source PDFs into the output — and, far
   * worse, `data/auth/`, which holds password hashes. A password hash inside a
   * pushed image layer is a password hash on a registry.
   *
   * The corpus and the annotation seed are placed deliberately by the
   * Dockerfile instead (/app/corpus and /app/seed), so nothing here is lost.
   */
  outputFileTracingExcludes: {
    '*': ['data/**', 'evaluation/**', 'tests/**', 'scripts/**'],
  },

  // The corpus is a 17MB JSON read once at module scope on the server.
  // It must never be bundled into the client.
  experimental: { largePageDataBytes: 512 * 1000 },
};
