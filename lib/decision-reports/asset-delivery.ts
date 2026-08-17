export const REPORT_ASSET_SIGNED_URL_TTL_SECONDS = 60;

export type ReportAssetDeliveryStore = {
  findAttachedAsset(input: {
    assetId: string;
    workspaceId: string;
  }): Promise<{ objectPath: string; contentHash: string } | null>;
  createSignedUrl(objectPath: string, expiresIn: number): Promise<string | null>;
};

type ReportAssetDeliveryDependencies = {
  isValidAssetId(assetId: string): boolean;
  getSession(): Promise<{ workspaceId: string; userId: string | null }>;
  isLocalDemo(): boolean;
  getStore(): Promise<ReportAssetDeliveryStore>;
};

type ReportAssetRouteContext = {
  params: Promise<{ assetId: string }>;
};

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

export function createReportAssetGetHandler(dependencies: ReportAssetDeliveryDependencies) {
  return async function getReportAsset(
    request: Request,
    context: ReportAssetRouteContext,
  ): Promise<Response> {
    const { assetId } = await context.params;
    if (!dependencies.isValidAssetId(assetId)) return notFound();

    const session = await dependencies.getSession();
    if (!dependencies.isLocalDemo() && !session.userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const store = await dependencies.getStore();
    const asset = await store.findAttachedAsset({
      assetId,
      workspaceId: session.workspaceId,
    });
    if (!asset) return notFound();

    const requestedVersion = new URL(request.url).searchParams.get("v");
    if (requestedVersion && requestedVersion !== asset.contentHash) return notFound();

    const signedUrl = await store.createSignedUrl(
      asset.objectPath,
      REPORT_ASSET_SIGNED_URL_TTL_SECONDS,
    );
    if (!signedUrl) return notFound();

    return new Response(null, {
      status: 307,
      headers: {
        Location: signedUrl,
        "Cache-Control": "private, no-store",
        ETag: `"${asset.contentHash}"`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  };
}
