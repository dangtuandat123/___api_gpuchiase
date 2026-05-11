import { NextRequest, NextResponse } from "next/server";
import { decryptUrl } from "@/lib/cipher";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return new NextResponse("Missing id", { status: 400 });
  }

  const runwareUrl = decryptUrl(id);
  if (!runwareUrl || !runwareUrl.startsWith("https://im.runware.ai/")) {
    return new NextResponse("Invalid or expired image ID", { status: 400 });
  }

  try {
    const response = await fetch(runwareUrl);
    if (!response.ok) {
      throw new Error(`Upstream fetch failed: ${response.status}`);
    }

    // Proxy the image stream directly
    return new NextResponse(response.body, {
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    console.error("[image-proxy] Failed to load image:", e);
    return new NextResponse("Failed to load image", { status: 502 });
  }
}
