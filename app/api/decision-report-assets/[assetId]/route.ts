import { getSession } from "@/lib/auth/session";
import {
  createReportAssetGetHandler,
  type ReportAssetDeliveryStore,
} from "@/lib/decision-reports/asset-delivery";
import { REPORT_ASSET_BUCKET } from "@/lib/decision-reports/assets";
import { UUID_PATTERN } from "@/lib/decision-reports/persistence";
import { getServerSupabase, isLocalDemo } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const getReportAsset = createReportAssetGetHandler({
  isValidAssetId: (assetId) => UUID_PATTERN.test(assetId),
  getSession,
  isLocalDemo,
  async getStore(): Promise<ReportAssetDeliveryStore> {
    const sb = await getServerSupabase();
    return {
      async findAttachedAsset({ assetId, workspaceId }) {
        const metadata = await sb.from("report_assets")
          .select("object_path, media_type, content_hash")
          .eq("asset_id", assetId)
          .eq("scope_id", workspaceId)
          .eq("status", "attached")
          .maybeSingle();
        if (metadata.error || !metadata.data) return null;
        const row = metadata.data as {
          object_path: string;
          media_type: string;
          content_hash: string;
        };
        return { objectPath: row.object_path, contentHash: row.content_hash };
      },
      async createSignedUrl(objectPath, expiresIn) {
        // The exact attached path is server-owned and RLS checked above. Let
        // Supabase Storage/CDN deliver the bytes directly instead of proxying
        // image egress and memory through the Next.js function.
        const signed = await sb.storage
          .from(REPORT_ASSET_BUCKET)
          .createSignedUrl(objectPath, expiresIn);
        if (signed.error || !signed.data?.signedUrl) return null;
        return signed.data.signedUrl;
      },
    };
  },
});

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  return getReportAsset(request, context);
}
