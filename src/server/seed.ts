// Seed data: fictional organisation "Contoso Manufacturing", role-simulation users and demonstration guides that are
// taken through the REAL workflow (so the audit trail and immutability are genuine).
import { prisma } from "./db";
import { DEFAULT_TEMPLATES } from "../lib/templates";
import { ctxForUserId } from "./session";
import { createGuide, saveContent, submitForReview, reviewDecision, approvalDecision, publishVersion, getVersionDetail } from "./services/guides";
import { storeAsset } from "./services/assets";
import { mockScreenshot } from "./fixtures";
import { newStep, newId, GuideContent, Step } from "../lib/guide-schema";
import type { Role } from "../lib/roles";

export const DEMO_USERS: { key: string; name: string; email: string; roles: Role[]; clearance?: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED"; site?: string; active?: boolean; title: string }[] = [
  { key: "alice", name: "Alice Author", email: "alice@contoso.example", roles: ["AUTHOR"], title: "Process improvement analyst", site: "MAN" },
  { key: "arun", name: "Arun Author", email: "arun@contoso.example", roles: ["AUTHOR"], title: "Training coordinator", site: "LDS" },
  { key: "olivia", name: "Olivia Owner", email: "olivia@contoso.example", roles: ["PROCESS_OWNER", "AUTHOR"], title: "Head of Procurement", site: "MAN" },
  { key: "bob", name: "Bob Backup", email: "bob@contoso.example", roles: ["PROCESS_OWNER"], title: "Procurement lead", site: "MAN" },
  { key: "rita", name: "Rita Reviewer", email: "rita@contoso.example", roles: ["REVIEWER"], title: "SAP subject-matter expert", clearance: "CONFIDENTIAL" },
  { key: "alan", name: "Alan Approver", email: "alan@contoso.example", roles: ["APPROVER"], title: "Operations manager", clearance: "CONFIDENTIAL" },
  { key: "amy", name: "Amy Approver", email: "amy@contoso.example", roles: ["APPROVER"], title: "Quality manager", clearance: "CONFIDENTIAL" },
  { key: "pat", name: "Pat Publisher", email: "pat@contoso.example", roles: ["PUBLISHER"], title: "Document controller", clearance: "CONFIDENTIAL" },
  { key: "lena", name: "Lena Learner", email: "lena@contoso.example", roles: ["LEARNER"], title: "Procurement assistant", site: "MAN" },
  { key: "leo", name: "Leo Learner (Leeds)", email: "leo@contoso.example", roles: ["LEARNER"], title: "Machine operator", site: "LDS" },
  { key: "ada", name: "Ada Admin", email: "ada@contoso.example", roles: ["ADMIN"], title: "Platform administrator", clearance: "CONFIDENTIAL" },
  { key: "aud", name: "Aud Auditor", email: "aud@contoso.example", roles: ["AUDITOR"], title: "Internal auditor", clearance: "RESTRICTED" },
  { key: "ivan", name: "Ivan Inactive", email: "ivan@contoso.example", roles: ["PROCESS_OWNER"], title: "Former IT service owner" },
];

export async function seedBase(slug = "contoso") {
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) throw new Error(`Organisation ${slug} already exists`);
  const org = await prisma.organization.create({
    data: { name: "Contoso Manufacturing", slug, dataRegion: "uk-south", aiPolicy: { enabled: true, externalAllowed: false }, capturePolicy: { enabled: true, restrictedDomains: ["bank.example", "*.payroll.example"], redactSelectors: ["[data-sensitive]"] }, retentionPolicy: {} },
  });
  const sites = await Promise.all([["MAN", "Manchester HQ"], ["LDS", "Leeds Plant"]].map(([code, name]) => prisma.site.create({ data: { orgId: org.id, code, name } })));
  const site = (c: string) => sites.find((s) => s.code === c)!;
  const teams = await Promise.all([["Procurement", "MAN"], ["Operations", "LDS"], ["IT Service Desk", "MAN"]].map(([name, c]) => prisma.team.create({ data: { orgId: org.id, name, siteId: site(c).id } })));
  const users: Record<string, Awaited<ReturnType<typeof prisma.user.create>>> = {};
  for (const u of DEMO_USERS) {
    users[u.key] = await prisma.user.create({
      data: {
        orgId: org.id, email: u.email, name: u.name, roles: u.roles, clearance: u.clearance ?? "INTERNAL", jobTitle: u.title, active: u.active ?? true, deactivatedAt: u.active === false ? new Date() : null,
        siteId: u.site ? site(u.site).id : null, teamId: u.key === "leo" ? teams[1].id : u.key === "lena" ? teams[0].id : null,
        allSites: !["lena", "leo"].includes(u.key), siteIds: u.key === "lena" ? [site("MAN").id] : u.key === "leo" ? [site("LDS").id] : [],
      },
    });
  }
  for (const t of DEFAULT_TEMPLATES) await prisma.template.create({ data: { orgId: org.id, key: t.key, name: t.name, description: t.description, definition: t.definition as object } });
  await prisma.workflow.create({ data: { orgId: org.id, key: "standard", name: "Standard: single approval", reviewMin: 1, isDefault: true, requireSegregation: true, stages: [{ name: "Approval", role: "APPROVER", minApprovals: 1 }] } });
  await prisma.workflow.create({ data: { orgId: org.id, key: "multi", name: "Multi-stage: technical + owner sign-off", reviewMin: 1, requireSegregation: true, stages: [{ name: "Technical approval", role: "APPROVER", minApprovals: 1 }, { name: "Owner sign-off", role: "PROCESS_OWNER", minApprovals: 1 }] } });
  for (const [kind, code, label] of [["PROCESS", "P2P", "Procure to pay"], ["PROCESS", "H2R", "Hire to retire"], ["PROCESS", "MAINT", "Maintenance"], ["CATEGORY", "SAFETY", "Safety"], ["CATEGORY", "SYSTEMS", "Systems"], ["FUNCTION", "FIN", "Finance"], ["FUNCTION", "PROC", "Procurement"], ["FUNCTION", "IT", "IT"]])
    await prisma.taxonomyTerm.create({ data: { orgId: org.id, kind, code, label } });
  for (const [term, exp] of [["purchase order", ["po", "order"]], ["goods receipt", ["gr", "grn"]], ["log in", ["login", "sign in", "logon"]], ["password", ["credentials", "passcode"]], ["expenses", ["expense claim", "reimbursement"]]] as const)
    await prisma.synonym.create({ data: { orgId: org.id, kind: "SYNONYM", term, expansions: [...exp] } });
  for (const [term, exp] of [["SAP", "Systems, Applications and Products (ERP system)"], ["PO", "Purchase order"], ["GR", "Goods receipt"], ["LOTO", "Lock-out / tag-out"]] as const)
    await prisma.synonym.create({ data: { orgId: org.id, kind: "ACRONYM", term, expansions: [exp] } });
  for (const [kind, value, replacement, note] of [["TCODE", "ME21", "ME21N", "ME21 is superseded by ME21N in S/4HANA."], ["SYSTEM", "Lotus Notes", "Microsoft Outlook", "Lotus Notes was retired in 2022."], ["SYSTEM", "Internet Explorer", "Microsoft Edge", "IE11 support ended."]] as const)
    await prisma.retiredReference.create({ data: { orgId: org.id, kind, value, replacement, note } });
  for (const [key, kind, title, body] of [
    ["privacy-notice", "PRIVACY", "Personal data notice", "This step displays personal data. Do not copy it into email, chat or personal files."],
    ["loto-warning", "SAFETY", "Isolation warning", "Isolate and lock out all energy sources before reaching into the machine. Never rely on the stop button alone."],
    ["approval-10k", "APPROVAL", "Approval above £10,000", "Orders above £10,000 require written approval from the budget holder before submission."],
  ] as const) {
    const b = await prisma.contentBlock.create({ data: { orgId: org.id, key, kind, title, body } });
    await prisma.contentBlockVersion.create({ data: { blockId: b.id, version: 1, title, body, changedById: users.ada.id } });
  }
  return { org, sites, users, teams };
}

const img = async (ctxU: { orgId: string; userId: string }, opts: Parameters<typeof mockScreenshot>[0]) => {
  const s = await mockScreenshot(opts);
  const a = await storeAsset(ctxU, { buffer: s.buf, filename: "screenshot.png", purpose: "CONTENT", allow: ["png"] });
  return { assetId: a.id, button: s.button };
};

const action = (title: string, text: string, image?: { assetId: string; alt: string; box?: { x: number; y: number; w: number; h: number } }): Step =>
  newStep("action", {
    title, text,
    ...(image ? { image: { assetId: image.assetId, alt: image.alt, annotations: image.box ? [{ id: newId("a"), kind: "box" as const, ...image.box }] : [] } } : {}),
  });

/** Run a guide through the genuine workflow: author edits -> review -> approval -> publication. */
export async function publishThroughWorkflow(ids: { author: string; reviewer: string; approvers: string[]; publisher: string; owner?: string }, versionId: string) {
  const author = await ctxForUserId(ids.author);
  await submitForReview(author, versionId);
  await reviewDecision(await ctxForUserId(ids.reviewer), versionId, { decision: "APPROVE", comment: "Reviewed for accuracy." });
  for (const a of ids.approvers) await approvalDecision(await ctxForUserId(a), versionId, { decision: "APPROVE", comment: "Approved." });
  await publishVersion(await ctxForUserId(ids.publisher), versionId);
}

export async function seedDemo(slug = "contoso") {
  const base = await seedBase(slug);
  const { users, sites } = base;
  const site = (c: string) => sites.find((s) => s.code === c)!;
  const alice = await ctxForUserId(users.alice.id);
  const arun = await ctxForUserId(users.arun.id);
  const actors = { author: users.alice.id, reviewer: users.rita.id, approvers: [users.alan.id], publisher: users.pat.id };
  const common = { ownerId: users.olivia.id, backupOwnerId: users.bob.id, escalationUserId: users.alan.id, escalationPath: "Contact the Operations manager, then the COO office.", reviewFrequencyDays: 365 };
  const ss = { orgId: base.org.id, userId: users.alice.id };

  // 1. SAP purchase order
  {
    const a1 = await img(ss, { app: "SAP Easy Access", screen: "Command field", button: "Enter", fields: ["Command field"] });
    const a2 = await img(ss, { app: "SAP  Create Purchase Order (ME21N)", screen: "Header", button: "Save", fields: ["Document type", "Vendor", "Purchasing group"] });
    const { version, guide } = await createGuide(alice, {
      title: "Create a purchase order in SAP (ME21N)", templateKey: "sap",
      metadata: { ...common, siteId: site("MAN").id, systems: ["SAP S/4HANA"], applications: ["SAP GUI"], sapTransactions: ["ME21N"], processCode: "P2P", functionCode: "PROC", department: "Procurement", categories: ["Systems"], businessRoles: ["Buyer"], websites: ["sap.contoso.example"], urlPatterns: ["https://sap.contoso.example/*"] },
    });
    const content: GuideContent = {
      ...(await getVersionDetail(alice, version.id)).content,
      purpose: "Create an approved purchase order (PO) so goods or services can be ordered from a vendor.",
      scope: "Standard POs for vendors already set up in SAP. Does not cover framework agreements or new vendor creation.",
      audience: "Buyers in Procurement",
      prerequisites: ["An approved purchase requisition or written approval", "Vendor number and purchasing group"],
      permissions: ["SAP role Z_BUYER"],
      expectedResult: "SAP confirms the PO is created and shows the PO number.",
      validationChecks: ["The PO number is displayed in the status bar", "The PO appears in ME23N with status 'Created'"],
      acronyms: [{ term: "PO", expansion: "Purchase order" }],
      troubleshooting: [{ problem: "Vendor is blocked for posting", resolution: "Contact Vendor Master Data and quote the vendor number." }],
      steps: [
        action("Open the purchase order transaction", "Type **ME21N** in the command field and press **Enter**.", { assetId: a1.assetId, alt: "SAP command field with ME21N typed in", box: a1.button }),
        action("Choose the document type", "Select **Standard PO** from the document type list."),
        action("Enter the vendor", "Enter the vendor number and press **Enter** to load vendor details.", { assetId: a2.assetId, alt: "Purchase order header with vendor field", box: a2.button }),
        newStep("decision", { title: "Check the order value", text: "", decision: { question: "Is the order value more than £10,000?", branches: [
          { id: newId("b"), label: "Yes", steps: [newStep("warning", { title: "Approval needed", text: "Attach the signed approval form before saving. Orders above £10,000 need budget-holder approval." }), action("Attach approval", "Use **Services for object** to attach the signed approval form.")] },
          { id: newId("b"), label: "No", steps: [action("Continue", "Continue with the next step.")] },
        ] } }),
        action("Save the purchase order", "Click **Save**. Note the PO number shown in the status bar."),
        newStep("expected", { title: "Expected result", text: "The status bar shows 'Standard PO created under the number 45…'." }),
      ],
    };
    await saveContent(alice, version.id, content, 1);
    await publishThroughWorkflow(actors, version.id);
    void guide;
  }

  // 2. Expense claim (will be overdue for review)
  let expenseGuideId = "";
  {
    const a1 = await img(ss, { app: "Contoso Expenses", screen: "New claim", button: "Submit claim", fields: ["Description", "Amount", "Category"] });
    const { version, guide } = await createGuide(alice, { title: "Submit an expense claim", templateKey: "admin", metadata: { ...common, siteId: site("MAN").id, systems: ["Contoso Expenses"], applications: ["Contoso Expenses"], processCode: "H2R", functionCode: "FIN", department: "Finance", categories: ["Systems"], websites: ["expenses.contoso.example"], businessRoles: ["Employee"] } });
    expenseGuideId = guide.id;
    const c = (await getVersionDetail(alice, version.id)).content;
    await saveContent(alice, version.id, {
      ...c, purpose: "Claim back business expenses you have paid for personally.", scope: "All employees. Excludes corporate card spend.", audience: "All employees",
      responsibilities: [{ role: "Employee", responsibility: "Submit accurate claims within 30 days" }, { role: "Line manager", responsibility: "Approve claims" }],
      expectedResult: "Your claim shows as 'Submitted' and your manager is notified.",
      steps: [
        action("Open Contoso Expenses", "Go to the expenses site and log in with your company account."),
        action("Start a new claim", "Click **New claim** and enter a short description.", { assetId: a1.assetId, alt: "New claim form with description, amount and category fields", box: { x: 0.27, y: 0.24, w: 0.44, h: 0.07 } }),
        action("Add each expense", "Enter the amount and category, and attach the receipt image."),
        newStep("warning", { title: "Receipts", text: "Claims without a receipt will be rejected." }),
        action("Submit the claim", "Click **Submit claim**.", { assetId: a1.assetId, alt: "Submit claim button", box: a1.button }),
      ],
    }, 1);
    await publishThroughWorkflow(actors, version.id);
    // make the review overdue (review date is governed metadata; content is untouched)
    await prisma.guideVersion.update({ where: { id: version.id }, data: { reviewDate: new Date(Date.now() - 40 * 86400_000) } });
  }

  // 3. Safety instruction
  {
    const { version } = await createGuide(arun, { title: "Lock out and tag out a conveyor before servicing", templateKey: "safety", metadata: { ...common, ownerId: users.bob.id, backupOwnerId: users.olivia.id, siteId: site("LDS").id, classification: "INTERNAL", criticality: "CRITICAL", systems: [], categories: ["Safety"], processCode: "MAINT", functionCode: undefined, department: "Operations" } });
    const c = (await getVersionDetail(arun, version.id)).content;
    await saveContent(arun, version.id, {
      ...c, purpose: "Prevent accidental start-up of the conveyor while it is being serviced.", scope: "Conveyor lines 1–4 at the Leeds Plant.", audience: "Maintenance technicians",
      ppe: ["Safety glasses", "Steel-toe boots", "Cut-resistant gloves"], hazards: ["Stored mechanical energy", "Entanglement in moving belts"], training: ["LOTO awareness (annual)"],
      equipment: ["Personal padlock", "Danger tag"], expectedResult: "The conveyor cannot be started and every energy source is verified isolated.",
      competency: { acknowledgementRequired: true, quizRequired: true, checklistRequired: true, reassessmentMonths: 12, quiz: [{ question: "Who may remove your lock?", options: ["Any supervisor", "Only you", "Anyone with a key"], correctIndex: 1 }], checklist: ["Demonstrates isolation of all energy sources", "Verifies zero energy before work"] },
      steps: [
        newStep("warning", { title: "Isolation", text: "Never rely on the stop button alone. Lock out every energy source." }),
        newStep("physical", { title: "Notify affected staff", text: "Tell the line supervisor and nearby operators that the conveyor is being locked out.", physical: { location: "Line control station" } }),
        newStep("physical", { title: "Switch off and isolate", text: "Turn the isolator to **OFF** and apply your personal padlock and danger tag.", physical: { location: "Conveyor isolator panel", equipment: "Padlock, tag" } }),
        newStep("physical", { title: "Verify zero energy", text: "Try to start the conveyor from the control station. It must not move.", physical: { location: "Control station" } }),
        newStep("control", { title: "Hold point", text: "A second technician must confirm isolation before work starts." }),
        newStep("expected", { title: "Expected result", text: "The conveyor cannot start; the lock and tag are visible on the isolator." }),
      ],
    }, 1);
    await publishThroughWorkflow({ ...actors, author: users.arun.id }, version.id);
  }

  // 4. Legacy-style guide referencing retired items (will show health warnings)
  {
    const { version } = await createGuide(alice, { title: "Raise a purchase requisition using ME21 (legacy)", templateKey: "sap", metadata: { ...common, siteId: site("MAN").id, systems: ["SAP R/3", "Lotus Notes"], sapTransactions: ["ME21"], processCode: "P2P", department: "Procurement" } });
    const c = (await getVersionDetail(alice, version.id)).content;
    await saveContent(alice, version.id, {
      ...c, purpose: "Raise a purchase order request.", scope: "Buyers.", prerequisites: ["SAP access"], permissions: ["Buyer role"], validationChecks: ["PO saved"], expectedResult: "PO saved.",
      steps: [action("Start ME21", "Run transaction **ME21** and complete the header."), action("Notify by email", "Send the PO number to the requester via Lotus Notes."), action("Save", "Click **Save**.")],
    }, 1);
    await publishThroughWorkflow(actors, version.id);
  }

  // 5. Guide whose owner later became inactive (orphaned)
  {
    const { version } = await createGuide(alice, { title: "Reset a user password in the IT portal", templateKey: "general", metadata: { ...common, ownerId: users.ivan.id, backupOwnerId: users.bob.id, siteId: site("MAN").id, systems: ["IT Portal"], department: "IT", functionCode: "IT", websites: ["itportal.contoso.example"] } });
    // Ivan is inactive in the seed but was active when this was authored: temporarily reactivate to pass owner validation
    const c = (await getVersionDetail(alice, version.id)).content;
    await saveContent(alice, version.id, {
      ...c, purpose: "Reset a locked-out user's password.", scope: "Staff accounts. Not privileged accounts.", expectedResult: "The user can sign in with a temporary password and is prompted to change it.",
      steps: [action("Verify identity", "Confirm the caller's identity using two security questions."), action("Reset the password", "Open the user in the IT portal and click **Reset password**."), action("Tell the user", "Give the temporary password by phone. Never send it by email.")],
    }, 1);
    await publishThroughWorkflow(actors, version.id);
  }

  // 6. A guide currently in review + a draft (workspace demo)
  {
    const { version } = await createGuide(alice, { title: "Onboard a new supplier", templateKey: "admin", metadata: { ...common, siteId: site("MAN").id, department: "Procurement", processCode: "P2P" } });
    const c = (await getVersionDetail(alice, version.id)).content;
    await saveContent(alice, version.id, { ...c, purpose: "Register a new supplier safely.", scope: "New suppliers.", responsibilities: [{ role: "Buyer", responsibility: "Collect supplier details" }], expectedResult: "Supplier is registered and can be used in purchase orders.", steps: [action("Collect details", "Request the supplier's registration form."), action("Submit to vendor master data", "Send the completed form to Vendor Master Data.")] }, 1);
    await submitForReview(alice, version.id);
    await createGuide(alice, { title: "Receive goods against a purchase order (draft)", templateKey: "sap", metadata: { ...common, siteId: site("MAN").id, sapTransactions: ["MIGO"], systems: ["SAP S/4HANA"] } });
  }
  // Ivan leaves the company after his guide is published -> orphaned-guide demonstration
  await prisma.user.update({ where: { id: users.ivan.id }, data: { active: false, deactivatedAt: new Date() } });
  void expenseGuideId;
  return base;
}
