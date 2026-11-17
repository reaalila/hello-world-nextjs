"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./community.module.css";

type SearchBarProps = {
  initialQuery: string;
  sort: "recent" | "top";
};

export default function SearchBar({
  initialQuery,
  sort,
}: SearchBarProps) {
  const router = useRouter();

  // Keep the user's typing independent from
  // incoming server-rendered search parameters.
  const [query, setQuery] = useState(initialQuery);

  const timer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  const latestQuery = useRef(initialQuery);

  // Always use the latest sorting option.
  const sortRef = useRef(sort);
  sortRef.current = sort;

  // Clean up pending searches when unmounting.
  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  // Update search results without scrolling
  // back to the top of the page.
  function navigateToSearch(value: string) {
    const trimmed = value.trim();

    const params = new URLSearchParams();

    if (trimmed) {
      params.set("q", trimmed);
    }

    if (sortRef.current === "top") {
      params.set("sort", "top");
    }

    const search = params.toString();

    router.replace(
      search
        ? `/community?${search}`
        : "/community",
      { scroll: false }
    );
  }

  function handleChange(value: string) {
    // Update the input immediately.
    setQuery(value);
    latestQuery.current = value;

    // Cancel the previous pending search.
    if (timer.current !== null) {
      clearTimeout(timer.current);
    }

    // Wait until typing pauses before
    // updating server-rendered results.
    timer.current = setTimeout(() => {
      navigateToSearch(latestQuery.current);
      timer.current = null;
    }, 600);
  }

  function handleEnter() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    navigateToSearch(latestQuery.current);
  }

  function clearSearch() {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }

    setQuery("");
    latestQuery.current = "";

    navigateToSearch("");
  }

  return (
    <div
      className={styles.searchContainer}
      role="search"
    >
      <svg
        className={styles.searchIcon}
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>

      <input
        type="search"
        value={query}
        onChange={(event) =>
          handleChange(event.target.value)
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleEnter();
          }
        }}
        placeholder="Search Sidequests..."
        aria-label="Search Sidequests"
        className={styles.searchInput}
        maxLength={80}
        autoComplete="off"
        spellCheck={false}
      />

      {query.length > 0 && (
        <button
          type="button"
          className={styles.clearSearch}
          onClick={clearSearch}
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}
