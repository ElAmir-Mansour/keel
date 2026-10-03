import type { NextConfig } from "next";

// Content-Security-Policy, enforced. Every origin below is one the browser was
// measured talking to in a full session on 2026-10-03 (dashboard, notes,
// timelines, slide export, the on-device embedding model download and a
// semantic search), with zero violations under the same policy in report-only
// mode. What each entry is for:
//
//  - cdn.jsdelivr.net: src/lib/ai/embeddings.ts imports @huggingface/transformers
//    at runtime through a plain `import(url)` the bundler leaves alone, and
//    onnxruntime-web fetches its .wasm and .mjs factory from there. The factory
//    is imported from a blob: URL and threads run as blob: workers, hence blob:
//    in script-src and worker-src. 'wasm-unsafe-eval' lets WebAssembly compile;
//    nothing needs 'unsafe-eval'.
//  - huggingface.co, cdn-lfs.huggingface.co, *.hf.co: model config, tokenizer
//    and weights; the files 302 from huggingface.co to a storage CDN under
//    *.hf.co (measured: us.aws.cdn.hf.co), with cdn-lfs as the legacy host.
//  - *.supabase.co over https and wss: the optional sync, a project the user
//    owns. A self-hosted Supabase on another domain needs its origin added here.
//  - api.github.com: the GitHub integration, called from the browser.
//  - api.anthropic.com: only the server route calls it; the browser calls
//    /api/ai. Listed so the policy documents every outbound destination.
//  - vercel.live: the Vercel toolbar on preview deployments.
//
// 'unsafe-inline' in script-src and style-src is what Next.js needs for its
// inline bootstrap and for next-themes; a nonce-based policy would require
// dynamic rendering of every page. tests/e2e/csp.spec.ts fails if a main flow
// logs a policy violation.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://vercel.live",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://cdn-lfs.huggingface.co https://*.hf.co https://*.supabase.co wss://*.supabase.co https://api.github.com https://api.anthropic.com https://vercel.live wss://*.vercel.live",
  "frame-src https://vercel.live",
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
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
