import { HighLevel, type LogLevelString } from "@gohighlevel/api-client";
import { PrismaSessionStorage } from "./prismaSessionStorage";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const sessionStorage = new PrismaSessionStorage();

// The SDK's webhook signature/appId check reads process.env.CLIENT_ID directly
// (hardcoded name, independent of the HighLevel config object) - bridge it here
// so INSTALL/UNINSTALL webhook processing doesn't silently no-op on "App ID mismatch".
process.env.CLIENT_ID = requireEnv("GHL_APP_CLIENT_ID");

export const ghl = new HighLevel({
  clientId: requireEnv("GHL_APP_CLIENT_ID"),
  clientSecret: requireEnv("GHL_APP_CLIENT_SECRET"),
  sessionStorage,
  logLevel: (process.env.GHL_SDK_LOG_LEVEL as LogLevelString) ?? "warn",
});
