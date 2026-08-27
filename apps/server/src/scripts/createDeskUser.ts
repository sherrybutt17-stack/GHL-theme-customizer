import "../services/loadEnv";
import { randomBytes } from "node:crypto";
import { prisma } from "../services/prisma";
import { hashPassword } from "../services/deskAuth";

/**
 * Create a Mosaic support-desk account.
 *
 *   npm run create-desk-user --workspace @ghl-theme-builder/server -- \
 *     --email you@mosaic.app --name "Your Name" --role mosaic_admin
 *
 * Accounts are created here rather than through a signup page on purpose: every desk
 * account can read EVERY agency's support conversations, so account creation is an
 * operator action, not a self-serve flow. Omit --password to have one generated.
 */

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(`--${flag}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const roleArg = arg("role") ?? "mosaic_agent";
  // A generated password is 32 base64url chars (~192 bits) - far better than anything
  // typed at a shell prompt, and it never lands in shell history.
  const password = arg("password") ?? randomBytes(24).toString("base64url");
  const generated = !arg("password");

  if (!email || !name) {
    console.error("Usage: --email <email> --name <name> [--role mosaic_agent|mosaic_admin] [--password <pw>]");
    process.exit(1);
  }
  if (roleArg !== "mosaic_agent" && roleArg !== "mosaic_admin") {
    console.error(`Invalid --role "${roleArg}". Use mosaic_agent or mosaic_admin.`);
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const existing = await prisma.deskUser.findUnique({ where: { email } });
  if (existing) {
    console.error(`${email} already has an account (role: ${existing.role}, status: ${existing.status}).`);
    console.error("To reset their password, use the desk's password change flow or update the row directly.");
    process.exit(1);
  }

  const user = await prisma.deskUser.create({
    data: { email, name, role: roleArg, passwordHash: hashPassword(password) },
  });

  console.log(`\nCreated desk account:`);
  console.log(`  email: ${user.email}`);
  console.log(`  name:  ${user.name}`);
  console.log(`  role:  ${user.role}`);
  if (generated) {
    console.log(`\n  password: ${password}`);
    console.log(`\nThis is the only time the password is shown. Send it over a secure channel;`);
    console.log(`they should change it after first sign-in.\n`);
  }
}

main()
  .catch((e) => {
    console.error("Failed to create desk user:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
