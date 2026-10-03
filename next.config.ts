import type { NextConfig } from "next";

// Content-Security-Policy is shipped REPORT-ONLY, deliberately. The browser
// logs what the enforced policy would have blocked and blocks nothing, so
// the sources below can be verified against real sessions before a single
// `Content-Security-Policy` header goes out. Three things need that proof:
//
//  - The semantic-search loader (src/lib/ai/embeddings.ts) imports
//    @huggingface/transformers from jsDelivr at runtime through
//    `new Function("u", "return import(u)")`. `new Function` is an eval and
//    needs 'unsafe-eval', which this policy does not grant on purpose;
//    'wasm-unsafe-eval' covers WebAssembly compilation only. Enforcing today
//    would break semantic search until that loader uses a plain dynamic
//    import() the bundler is told to leave alone.
//  - onnxruntime-web (pulled in by transformers.js) fetches its .wasm and
//    .mjs factory from jsDelivr, imports the factory from a blob: URL and may
//    spawn blob: workers for threading — hence blob: in script-src and
//    worker-src. Measured from its source, not yet from a session.
//  - Hugging Face model files 302 from huggingface.co to a storage CDN. The
//    legacy host is cdn-lfs.huggingface.co; measured on 2026-10-03 the
//    redirect went to us.aws.cdn.hf.co (Xet storage), so *.hf.co is listed
//    too. Redirect targets must be allowed as well as the first hop.
//
// Also listed: api.github.com (GitHub import, browser-side), *.supabase.co
// over https and wss (optional sync, user-provided project), and
// api.anthropic.com (the server route talks to it; the browser only ever
// calls /api/ai, so it is listed for completeness). A self-hosted Supabase
// URL would not match *.supabase.co and is one more reason not to enforce
// without a session behind it.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://cdn-lfs.huggingface.co https://*.hf.co https://*.supabase.co wss://*.supabase.co https://api.github.com https://api.anthropic.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
