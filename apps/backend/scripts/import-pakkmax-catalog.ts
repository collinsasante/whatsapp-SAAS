/**
 * One-time catalog import: Pakkmax's real product catalog (Airtable) -> our Commerce
 * `Product` table, for the single Pakkmax pilot tenant.
 *
 * This script does NOT talk to Airtable. It reads Airtable's raw REST-shaped JSON
 * pages that were already fetched out-of-band via the Airtable MCP tools (list_records_for_table)
 * and saved to disk one page per file (schema: `{ records: [...], metadata, nextCursor }`,
 * `records[].cellValuesByFieldId` keyed by Airtable field ID). Point it at those directories
 * via env vars -- there is no default inside the repo, on purpose, so bulk catalog data can
 * never accidentally end up committed.
 *
 * Usage:
 *   PAKKMAX_PRODUCTS_DIR=/path/to/products \
 *   PAKKMAX_VARIANTS_DIR=/path/to/variants \
 *   DATABASE_URL=postgresql://... \
 *   pnpm --filter @whatsapp-platform/backend exec ts-node scripts/import-pakkmax-catalog.ts --confirm
 *
 * Omit --confirm to do a dry run: builds the full mapping and writes the summary report
 * (apps/backend/scripts/.pakkmax-import-report.json by default, override with
 * PAKKMAX_REPORT_PATH) WITHOUT touching the database at all. Always dry-run first and read
 * the report before adding --confirm.
 *
 * Idempotent: re-running with --confirm upserts by (tenantId, sku) when the Airtable record
 * has a Product ID Number, falling back to matching on metadata.airtableRecordId otherwise --
 * safe to re-run after fixing bad source data instead of leaving duplicates.
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// Confirmed against the live DB by the operator ahead of time -- never derive or guess this.
const PAKKMAX_TENANT_ID = '514b3175-54fc-4047-9550-0c677204ce2e';

// Airtable field IDs (Products table: tbl87FioSDc1liUvv)
const F_PRODUCT_NAME = 'fldUqIQv9ILVHZOGs';
const F_DESCRIPTION = 'fldBpufCYvsg30KPJ';
const F_CATEGORY = 'fldWFdNg0ZPBWAC9E';
const F_GHANA_PRICE = 'fldymitTD2GwiJpbh';
const F_MOQ = 'fldcE1YNaUVO7yRoE';
const F_UNIT = 'fldlBLifHUjlxMkbC';
const F_STATUS = 'fldmZrdnJzT561R2K';
const F_IMAGES = 'fldi8bnDWdeGZr2Pf';
const F_VARIANTS_LINK = 'fldBlaM35Im8qL01k';
const F_ID_NUMBER = 'fldxBLkd8uH2eYwCk';
const F_TAGS = 'fldkxAkZVLmiCndyL';

// Airtable field IDs (Product Variants table: tblAbTcRB5fyJmD9t)
const F_VARIANT_NAME = 'fldzU9LWikidAHacY';
const F_VARIANT_PRICE = 'fldzOnkZiEeVngpRY';
const F_VARIANT_PARENT_LINK = 'fld7Y83Hy2sz9J9i8';

interface AirtableAttachment {
  id: string;
  url: string;
  filename?: string;
}
interface AirtableLink {
  id: string;
  name: string;
}
interface AirtableChoice {
  id: string;
  name: string;
}
interface AirtableRecord {
  id: string;
  createdTime: string;
  cellValuesByFieldId: Record<string, unknown>;
}
interface AirtablePage {
  records: AirtableRecord[];
  metadata?: { totalRecordCount: number };
  nextCursor?: string | null;
}

interface MappedVariant {
  name: string;
  priceDeltaMajorUnits: number;
  stockQuantity: null;
  sku: null;
}

interface MappedProduct {
  tenantId: string;
  name: string;
  description: string | null;
  sku: string | null;
  priceMajorUnits: number;
  currency: 'GHS';
  isActive: true;
  imageUrl: string | null;
  stockQuantity: null;
  minOrderQuantity: number | null;
  variants: MappedVariant[] | null;
  metadata: {
    airtableRecordId: string;
    airtableProductIdNumber: number | null;
    category: string | null;
    unit: string | null;
    tags: string | null;
  };
}

interface DataQualityIssue {
  airtableRecordId: string;
  productName: string | null;
  issue: string;
}

function readAllPages(dir: string): AirtableRecord[] {
  if (!fs.existsSync(dir)) {
    throw new Error(`Directory does not exist: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .json page files found in ${dir}`);
  }
  const records: AirtableRecord[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    const page = JSON.parse(raw) as AirtablePage;
    if (!Array.isArray(page.records)) {
      throw new Error(`${file}: missing/invalid "records" array -- refusing to guess past malformed source data`);
    }
    records.push(...page.records);
  }
  return records;
}

/** Airtable's richText comes back as a plain string with light markdown-ish formatting -- strip to clean plain text. */
function cleanDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let text = raw;
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/^#{1,6}\s+/gm, ''); // headings
  text = text.replace(/\*\*(.*?)\*\*/g, '$1'); // bold
  text = text.replace(/\*(.*?)\*/g, '$1'); // italic
  text = text.replace(/`{1,3}([^`]*)`{1,3}/g, '$1'); // inline/code
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links -> label text
  text = text.replace(/^[-*+]\s+/gm, '- '); // normalize bullet markers
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text.length > 0 ? text : null;
}

function getSingleLineText(v: unknown): string | null {
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

function getNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function getChoiceName(v: unknown): string | null {
  if (v && typeof v === 'object' && 'name' in (v as object)) {
    const name = (v as AirtableChoice).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function getFirstAttachmentUrl(v: unknown): string | null {
  if (Array.isArray(v) && v.length > 0) {
    const first = v[0] as AirtableAttachment;
    return typeof first?.url === 'string' ? first.url : null;
  }
  return null;
}

function getLinkedIds(v: unknown): string[] {
  if (Array.isArray(v)) {
    return (v as AirtableLink[]).filter((l) => l && typeof l.id === 'string').map((l) => l.id);
  }
  return [];
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  const confirm = process.argv.includes('--confirm');

  const productsDir = process.env.PAKKMAX_PRODUCTS_DIR;
  const variantsDir = process.env.PAKKMAX_VARIANTS_DIR;
  if (!productsDir || !variantsDir) {
    throw new Error(
      'Set PAKKMAX_PRODUCTS_DIR and PAKKMAX_VARIANTS_DIR to the directories holding the fetched Airtable page JSON files.',
    );
  }
  const reportPath = process.env.PAKKMAX_REPORT_PATH ?? path.join(__dirname, '.pakkmax-import-report.json');

  console.log(`Reading product pages from ${productsDir}`);
  const productRecords = readAllPages(productsDir);
  console.log(`Reading variant pages from ${variantsDir}`);
  const variantRecords = readAllPages(variantsDir);
  console.log(`Loaded ${productRecords.length} product records, ${variantRecords.length} variant records.`);

  // --- Build variant map: parent product Airtable record ID -> variant records ---
  const variantsByParentId = new Map<string, AirtableRecord[]>();
  let variantsWithNoParent = 0;
  let variantsWithMultipleParents = 0;
  for (const v of variantRecords) {
    const parentIds = getLinkedIds(v.cellValuesByFieldId[F_VARIANT_PARENT_LINK]);
    if (parentIds.length === 0) {
      variantsWithNoParent++;
      continue;
    }
    if (parentIds.length > 1) variantsWithMultipleParents++;
    for (const pid of parentIds) {
      const arr = variantsByParentId.get(pid) ?? [];
      arr.push(v);
      variantsByParentId.set(pid, arr);
    }
  }

  const dataQualityIssues: DataQualityIssue[] = [];
  const seenNames = new Map<string, number>();
  const mapped: MappedProduct[] = [];
  let skippedMissingName = 0;
  let skippedMissingPrice = 0;
  let totalVariantsMatched = 0;
  let crossCheckMismatches = 0;

  for (const rec of productRecords) {
    const cv = rec.cellValuesByFieldId;
    const name = getSingleLineText(cv[F_PRODUCT_NAME]);
    const idNumber = getNumber(cv[F_ID_NUMBER]);

    if (!name) {
      skippedMissingName++;
      dataQualityIssues.push({ airtableRecordId: rec.id, productName: null, issue: 'Missing Product Name -- skipped' });
      continue;
    }

    const ghanaPrice = getNumber(cv[F_GHANA_PRICE]);
    if (ghanaPrice === null) {
      skippedMissingPrice++;
      dataQualityIssues.push({ airtableRecordId: rec.id, productName: name, issue: 'Missing/null Ghana Price -- skipped' });
      continue;
    }
    if (ghanaPrice === 0) {
      dataQualityIssues.push({ airtableRecordId: rec.id, productName: name, issue: 'Ghana Price is exactly 0' });
    }

    const imageUrl = getFirstAttachmentUrl(cv[F_IMAGES]);
    if (!imageUrl) {
      dataQualityIssues.push({ airtableRecordId: rec.id, productName: name, issue: 'No image' });
    }

    const key = name.trim().toLowerCase();
    seenNames.set(key, (seenNames.get(key) ?? 0) + 1);

    // Cross-check variant linkage: reverse link (variant -> product) is the source of truth;
    // forward link (product -> variant, F_VARIANTS_LINK) is used only to sanity-check it agrees.
    const matchedVariants = variantsByParentId.get(rec.id) ?? [];
    const forwardVariantIds = new Set(getLinkedIds(cv[F_VARIANTS_LINK]));
    const reverseVariantIds = new Set(matchedVariants.map((v) => v.id));
    const linksAgree =
      forwardVariantIds.size === reverseVariantIds.size && [...forwardVariantIds].every((id) => reverseVariantIds.has(id));
    if (!linksAgree) {
      crossCheckMismatches++;
      dataQualityIssues.push({
        airtableRecordId: rec.id,
        productName: name,
        issue: `Variant link mismatch: product->variant link has ${forwardVariantIds.size}, variant->product reverse link has ${reverseVariantIds.size}`,
      });
    }

    let mappedVariants: MappedVariant[] | null = null;
    if (matchedVariants.length > 0) {
      mappedVariants = matchedVariants.map((v) => {
        const vName = getSingleLineText(v.cellValuesByFieldId[F_VARIANT_NAME]) ?? name;
        let vPrice = getNumber(v.cellValuesByFieldId[F_VARIANT_PRICE]);
        if (vPrice === null) {
          dataQualityIssues.push({
            airtableRecordId: v.id,
            productName: name,
            issue: `Variant "${vName}" missing Ghana Cedis Price -- defaulted delta to 0`,
          });
          vPrice = ghanaPrice;
        }
        totalVariantsMatched++;
        return {
          name: vName,
          priceDeltaMajorUnits: roundMoney(vPrice - ghanaPrice),
          stockQuantity: null,
          sku: null,
        };
      });
    }

    const moq = getNumber(cv[F_MOQ]);

    mapped.push({
      tenantId: PAKKMAX_TENANT_ID,
      name,
      description: cleanDescription(cv[F_DESCRIPTION]),
      sku: idNumber !== null ? `PKX-${idNumber}` : null,
      priceMajorUnits: roundMoney(ghanaPrice),
      currency: 'GHS',
      isActive: true,
      imageUrl,
      stockQuantity: null,
      minOrderQuantity: moq !== null && moq > 1 ? Math.trunc(moq) : null,
      variants: mappedVariants,
      metadata: {
        airtableRecordId: rec.id,
        airtableProductIdNumber: idNumber,
        category: getChoiceName(cv[F_CATEGORY]),
        unit: getChoiceName(cv[F_UNIT]),
        tags: getSingleLineText(cv[F_TAGS]),
      },
    });
  }

  const duplicateNames = [...seenNames.entries()].filter(([, count]) => count > 1);
  for (const [nameKey, count] of duplicateNames) {
    dataQualityIssues.push({ airtableRecordId: '(multiple)', productName: nameKey, issue: `Duplicate product name appears ${count} times` });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    totalsFromAirtable: { activeProductRecords: productRecords.length, variantRecords: variantRecords.length },
    mapping: {
      totalMapped: mapped.length,
      skippedMissingName,
      skippedMissingPrice,
      totalSkipped: skippedMissingName + skippedMissingPrice,
      totalVariantsMatched,
      productsWithVariants: mapped.filter((p) => p.variants && p.variants.length > 0).length,
      variantsWithNoParent,
      variantsWithMultipleParents,
      crossCheckMismatches,
      duplicateNameGroups: duplicateNames.length,
    },
    sampleMappedRecords: mapped.slice(0, 5),
    dataQualityIssues,
  };

  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Wrote summary report to ${reportPath}`);
  console.log(
    `Mapped ${mapped.length} products (skipped ${summary.mapping.totalSkipped}: ${skippedMissingName} missing name, ${skippedMissingPrice} missing price). ` +
      `${totalVariantsMatched} variants matched across ${summary.mapping.productsWithVariants} products. ` +
      `${dataQualityIssues.length} data-quality issues logged.`,
  );

  if (!confirm) {
    console.log('Dry run only (pass --confirm to write to the database). No database was touched.');
    return;
  }

  const dbUrl = process.env.DATABASE_URL ?? '';
  const redacted = dbUrl.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
  console.log(`--confirm passed. About to write ${mapped.length} products for tenant ${PAKKMAX_TENANT_ID} to: ${redacted}`);

  const prisma = new PrismaClient();
  try {
    let created = 0;
    let updated = 0;
    for (const p of mapped) {
      const existing = p.sku
        ? await prisma.product.findFirst({ where: { tenantId: p.tenantId, sku: p.sku } })
        : await prisma.product.findFirst({
            where: { tenantId: p.tenantId, metadata: { path: ['airtableRecordId'], equals: p.metadata.airtableRecordId } },
          });

      const data = {
        tenantId: p.tenantId,
        name: p.name,
        description: p.description,
        sku: p.sku,
        priceMajorUnits: p.priceMajorUnits,
        currency: p.currency,
        isActive: p.isActive,
        imageUrl: p.imageUrl,
        stockQuantity: p.stockQuantity,
        minOrderQuantity: p.minOrderQuantity,
        variants: p.variants as never,
        metadata: p.metadata as never,
      };

      if (existing) {
        await prisma.product.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.product.create({ data });
        created++;
      }
    }
    console.log(`Import complete: ${created} created, ${updated} updated (${created + updated} total rows written).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
