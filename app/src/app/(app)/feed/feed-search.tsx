"use client";

import { useState, useEffect } from "react";

export function FeedSearch() {
  const [q, setQ] = useState("");

  useEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>("[data-feed-name]");
    const lower = q.toLowerCase().trim();
    cards.forEach((el) => {
      el.style.display = !lower || el.dataset.feedName!.includes(lower) ? "" : "none";
    });
  }, [q]);

  return (
    <input
      type="text"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search by name…"
      className="border border-[#ece8e1] rounded-lg px-3 py-1.5 text-sm text-[#2c2925] bg-white focus:outline-none focus:ring-2 focus:ring-[#e0533a55] w-56"
    />
  );
}
