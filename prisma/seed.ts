import { seedDemo } from "../src/server/seed";
import { prisma } from "../src/server/db";

seedDemo()
  .then((r) => console.log(`Seeded organisation "${r.org.name}" with ${Object.keys(r.users).length} users. Log in as e.g. alice@contoso.example (any role user; see README).`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
