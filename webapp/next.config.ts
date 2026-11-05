import type { NextConfig } from "next";

const config: NextConfig = {
  // the termbase + memory bundle is read with fs at runtime: ship it with the API functions
  outputFileTracingIncludes: {
    "/api/analyze": ["./data/bundle.json.gz"],
    "/api/translate": ["./data/bundle.json.gz"],
  },
};

export default config;
