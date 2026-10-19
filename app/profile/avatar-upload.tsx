"use client";

import { useRef, useState, type ChangeEvent } from "react";
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
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = uploading || removing;

  function getPhotoPath(url: string, userId: string) {
    try {
      const marker = "/storage/v1/object/public/avatars/";
      const pathname = new URL(url).pathname;

      if (!pathname.includes(marker)) return null;

      const path = decodeURIComponent(
        pathname.split(marker)[1]
      );

      if (!path.startsWith(`${userId}/`)) return null;

      return path;
    } catch {
      return null;
    }
  }

  async function handleUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
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
        throw new Error("Please sign in first.");
      }

      if (!file.type.startsWith("image/")) {
        throw new Error("Please select an image.");
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error("The photo must be smaller than 5 MB.");
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
        await supabase.storage.from("avatars").remove([filePath]);
        throw updateError;
      }

      const previousUrl = avatarUrl;
      setAvatarUrl(data.publicUrl);
      setMessage("Photo uploaded successfully!");

      // Clean up the previous photo when replacing it.
      if (previousUrl) {
        const oldPath = getPhotoPath(previousUrl, user.id);

        if (oldPath && oldPath !== filePath) {
          const { error: cleanupError } = await supabase.storage
            .from("avatars")
            .remove([oldPath]);

          if (cleanupError) {
            console.error("Old photo cleanup failed:", cleanupError);
          }
        }
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Upload failed."
      );
    } finally {
      setUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleRemove() {
    if (!avatarUrl || busy) return;

    setRemoving(true);
    setMessage("");

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Please sign in first.");
      }

      const photoPath = getPhotoPath(avatarUrl, user.id);

      if (!photoPath) {
        throw new Error("Could not locate your photo.");
      }

      // Delete the image from Supabase Storage.
      const { error: deleteError } = await supabase.storage
        .from("avatars")
        .remove([photoPath]);

      if (deleteError) {
        throw deleteError;
      }

      // Remove the saved photo URL from the profile.
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", user.id)
        .select("id")
        .single();

      if (updateError) {
        throw updateError;
      }

      setAvatarUrl(null);
      setMessage("Photo removed successfully!");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not remove the photo."
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="profile-photo-section">
      <h2>Profile Photo</h2>

      <div className="profile-photo-row">
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt="Your profile photo"
            width={76}
            height={76}
          />
        )}

        <div className="profile-photo-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleUpload}
            disabled={busy}
            className="profile-photo-input"
            aria-label="Upload profile photo"
          />

          <button
            type="button"
            className="profile-photo-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            {uploading
              ? "Uploading..."
              : avatarUrl
              ? "Change Photo"
              : "Choose Photo"}
          </button>

          {avatarUrl && (
            <button
              type="button"
              className="profile-photo-button profile-photo-remove"
              onClick={handleRemove}
              disabled={busy}
            >
              {removing ? "Removing..." : "Remove Photo"}
            </button>
          )}
        </div>
      </div>

      {message && (
        <p className="profile-photo-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
