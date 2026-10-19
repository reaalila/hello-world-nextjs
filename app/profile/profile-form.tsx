"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";

type ProfileFormProps = {
  initialFirstName: string;
  initialLastName: string;
  isOnboarding: boolean;
};

export default function ProfileForm({
  initialFirstName,
  initialLastName,
  isOnboarding,
}: ProfileFormProps) {
  const router = useRouter();

  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();

    if (!cleanFirstName || !cleanLastName) {
      setMessage("Please enter your first and last name.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const supabase = createClient();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setMessage("Please log in first.");
        return;
      }

      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: cleanFirstName,
          last_name: cleanLastName,
        })
        .eq("id", user.id)
        .select("id")
        .single();

      if (error) {
        setMessage("Error: " + error.message);
        return;
      }

      if (isOnboarding) {
        router.replace("/captions");
        router.refresh();
      } else {
        setMessage("Profile updated successfully!");
        router.refresh();
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="firstName">First Name</label>
        <br />
        <input
          id="firstName"
          type="text"
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          required
          maxLength={100}
        />
      </div>

      <div>
        <label htmlFor="lastName">Last Name</label>
        <br />
        <input
          id="lastName"
          type="text"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          required
          maxLength={100}
        />
      </div>

      <button type="submit" disabled={saving}>
        {saving
          ? "Saving..."
          : isOnboarding
            ? "Save & Continue"
            : "Save Changes"}
      </button>

      <p role="status">{message}</p>
    </form>
  );
}
