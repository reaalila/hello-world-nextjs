"use client";

import { useState, type ChangeEvent } from "react";
import { createClient } from "@/lib/supabase-browser";

type AvatarUploadProps = {
  initialAvatarUrl: string | null;
};

export default function AvatarUpload({
  initialAvatarUrl,
}: AvatarUploadProps) {
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setUploading(true);
    setMessage("");

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setMessage("Please sign in first.");
        return;
      }

      if (!file.type.startsWith("image/")) {
        setMessage("Please select an image.");
        return;
      }

      const extension = file.name.split(".").pop() || "png";
      const filePath = `${user.id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, {
          contentType: file.type,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", user.id)
        .select("id")
        .single();

      if (updateError) {
        throw updateError;
      }

      setAvatarUrl(data.publicUrl);
      setMessage("Photo uploaded successfully!");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Upload failed."
      );
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <section style={{ marginTop: "24px" }}>
      <h2>Profile Photo</h2>

      {avatarUrl && (
        <img
          src={avatarUrl}
          alt="Your profile photo"
          width={120}
          height={120}
          style={{ objectFit: "cover", borderRadius: "50%" }}
        />
      )}

      <div>
        <input
          type="file"
          accept="image/*"
          onChange={handleUpload}
          disabled={uploading}
        />
      </div>

      <p role="status">{uploading ? "Uploading..." : message}</p>
    </section>
  );
}
