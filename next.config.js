const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: [
    'mongoose',
    'puppeteer',
    'puppeteer-extra',
    'puppeteer-extra-plugin-stealth'
  ]
};

module.exports = nextConfig;