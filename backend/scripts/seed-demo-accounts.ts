import "dotenv/config";
import { supabase } from "../src/services/supabase.js";

// Seeds fixed demo accounts for manual testing. Uses the admin API so
// accounts are pre-confirmed (no confirmation email, no email-rate-limit
// hit). Safe to re-run: existing auth users are looked up and reused.
const DEMO_PASSWORD = "ShelfSignDemo1!";

interface DemoAccount {
  email: string;
  role: "supplier" | "buyer";
  companyName: string;
  categories: string[];
}

const ACCOUNTS: DemoAccount[] = [
  {
    email: "demo.supplier1@example.com",
    role: "supplier",
    companyName: "Himalayan Traders",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.supplier2@example.com",
    role: "supplier",
    companyName: "Kathmandu Cold Storage",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.supplier3@example.com",
    role: "supplier",
    companyName: "Everest Steel Works",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.supplier4@example.com",
    role: "supplier",
    companyName: "Pokhara Farm Supply",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.supplier5@example.com",
    role: "supplier",
    companyName: "Terai Auto Parts",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.buyer1@example.com",
    role: "buyer",
    companyName: "Bhattarai Retail",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.buyer2@example.com",
    role: "buyer",
    companyName: "Kathmandu Mart",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.buyer3@example.com",
    role: "buyer",
    companyName: "Valley Wholesale",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.buyer4@example.com",
    role: "buyer",
    companyName: "Sunrise Distributors",
    categories: ["Chair", "Monitor", "Table"],
  },
  {
    email: "demo.buyer5@example.com",
    role: "buyer",
    companyName: "Himal Convenience",
    categories: ["Chair", "Monitor", "Table"],
  },
];

async function findUserIdByEmail(email: string): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function seedAccount(account: DemoAccount) {
  let userId = await findUserIdByEmail(account.email);

  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user)
      throw error ?? new Error(`No user returned for ${account.email}`);
    userId = data.user.id;
  }

  const { error: profileError } = await supabase.from("profiles").upsert({
    id: userId,
    role: account.role,
    company_name: account.companyName,
    categories: account.categories,
  });
  if (profileError) throw profileError;

  console.log(
    `${account.role.padEnd(8)} ${account.email.padEnd(28)} ${account.companyName}`,
  );
}

async function main() {
  for (const account of ACCOUNTS) {
    await seedAccount(account);
  }
  console.log(`\nDone. All demo accounts share the password: ${DEMO_PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
