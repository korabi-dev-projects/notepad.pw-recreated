const requiredEnvVars = ["MONGO_URI", "PORT", "TRUST_PROXY"];

export default function ensureEnv() {
  const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
  if (missingVars.length > 0) {
    console.error(
      `Missing required environment variables: ${missingVars.join(", ")}`,
    );
    process.exit(1);
  }
}
