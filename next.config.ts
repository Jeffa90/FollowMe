import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["sharp", "pdfkit", "pg", "mammoth", "unpdf", "jszip", "docx", "cheerio", "qrcode", "@prisma/client", "@prisma/adapter-pg"],
  typescript: { ignoreBuildErrors: false },
  experimental: { serverActions: { bodySizeLimit: "30mb" } },
};

export default config;
