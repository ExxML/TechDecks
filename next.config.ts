import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the workspace root. Without this, Turbopack walks up and finds an
  // unrelated package-lock.json in the user's home directory, then warns that
  // it is outside the git repo.
  turbopack: {
    root: __dirname,
  },
  // Next regenerates AGENTS.md/CLAUDE.md on every dev start. This project
  // keeps its own docs; the generated ones are churn.
  agentRules: false,
  // Allow LAN devices (phones, tablets) to load dev assets.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
};

export default nextConfig;
