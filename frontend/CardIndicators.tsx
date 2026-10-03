"use client";

import { fetchJSON } from "@/lib/api";
import { createFileMetadataStore } from "@/lib/fileMetadataStore";
import { MediaIndicator, type MediaStatus } from "@/components/MediaIndicator";

interface Metadata { transcript: MediaStatus; summary: MediaStatus }
const useMetadata = createFileMetadataStore<Metadata>((drive, ids) => fetchJSON(
  "/api/addons/intelligence/files/card-metadata",
  { method: "POST", headers: { "Content-Type": "application/json", "X-Lit-Drive": encodeURIComponent(drive) }, body: JSON.stringify({ file_ids: ids }) },
));

type Props = { fileId: string; drive: string; filename: string; fileType?: string };

export default function CardIndicators(props: Props) {
  if (props.fileType !== "video" && !props.filename.toLowerCase().endsWith(".loft")) return null;
  return <Indicators {...props} />;
}

function Indicators({ fileId, drive }: Props) {
  const data = useMetadata(fileId, drive);
  return <>
    <MediaIndicator kind="transcript" status={data?.transcript ?? "unknown"} />
    <MediaIndicator kind="summary" status={data?.summary ?? "unknown"} />
  </>;
}
