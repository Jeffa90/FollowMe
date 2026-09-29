export type BlockType = "heading" | "paragraph" | "list_item" | "table" | "image" | "header_footer";
export interface ExtractedBlock {
  id: string;
  type: BlockType;
  order: number;
  level?: number; // heading level 1-6 / list nesting depth
  text: string;
  page?: number;
  listNumber?: string; // number as written in the source ("3", "3.1", "a")
  ordered?: boolean;
  rows?: string[][]; // tables
  imageId?: string;
  ocr?: boolean;
  fontScale?: number; // PDF: relative font size (1 = body)
}
export interface ExtractedImageMeta {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  page?: number;
  order: number; // document order among blocks
  alt?: string;
  assetId?: string; // set once stored as IMPORT_IMAGE evidence
}
export interface ExtractedDocument {
  kind: string;
  blocks: ExtractedBlock[];
  images: ExtractedImageMeta[];
  metadata: { title?: string; author?: string; created?: string; modified?: string; pages?: number; producer?: string };
  docControl: Record<string, string>;
  warnings: string[];
  ocrUsed: boolean;
  pageImageAssetIds?: string[]; // rendered PDF pages kept as visual evidence
}
export interface ExtractResult { doc: ExtractedDocument; imageBuffers: Map<string, Buffer>; pageImages?: { page: number; buffer: Buffer }[] }

export interface ConversionFlag { code: string; message: string; severity: "info" | "warn" | "error"; blockIds?: string[]; stepId?: string }
export type Outcome = "retained" | "rewritten" | "removed" | "uncertain";
export interface ChangeSummaryBlock { blockId: string; outcome: Outcome; reason: string; into?: string }
